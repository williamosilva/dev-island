import * as fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buttonId } from '../src/core/button-id';
import {
  readButtonsFile,
  reorderButtons,
  syncButtons,
  writeButtonsFile,
} from '../src/core/buttons-config';
import { projectButtonsFile } from '../src/core/paths';
import { discoverProject } from '../src/core/discovery';
import { ProjectRegistry } from '../src/core/registry';
import { PtyManager } from '../src/main/pty-manager';
import { WidgetState } from '../src/main/widget-state';
import type { ButtonConfig } from '../src/shared/types';
import { makeTempDir, readFile, removeTempDirs, writePackageJson } from './helpers';

afterEach(removeTempDirs);

const BUTTONS: ButtonConfig[] = [
  { name: 'Build', script: 'npm run build' },
  { name: 'Build:gateway', script: 'npm run build:gateway' },
  { name: 'Postinstall', script: 'npm run postinstall' },
  { name: 'Dev', script: 'npm run dev' },
];

const ids = (buttons: readonly ButtonConfig[]): string[] => buttons.map(buttonId);

describe('reorderButtons', () => {
  it('applies a permutation of the stable ids', () => {
    const wanted = [ids(BUTTONS)[3]!, ...ids(BUTTONS).slice(0, 3)];
    const next = reorderButtons(BUTTONS, wanted);
    expect(next?.map((button) => button.name)).toEqual([
      'Dev',
      'Build',
      'Build:gateway',
      'Postinstall',
    ]);
  });

  it('preserves every property untouched', () => {
    const next = reorderButtons(BUTTONS, [...ids(BUTTONS)].reverse())!;
    expect([...next].reverse()).toEqual(BUTTONS);
    for (const button of next) expect(Object.keys(button)).toEqual(['name', 'script']);
  });

  it('refuses anything that is not an exact permutation', () => {
    expect(reorderButtons(BUTTONS, ids(BUTTONS).slice(0, 3))).toBeNull();
    expect(reorderButtons(BUTTONS, [...ids(BUTTONS), 'inventado'])).toBeNull();
    const duplicated = ids(BUTTONS);
    duplicated[1] = duplicated[0]!;
    expect(reorderButtons(BUTTONS, duplicated)).toBeNull();
  });
});

describe('persisting the order through the widget state', () => {
  function project() {
    const dataDir = makeTempDir('dev-island-data-');
    const dir = makeTempDir('dev-island-projeto-');
    writePackageJson(dir, {
      name: 'demo',
      scripts: { build: 'x', 'build:gateway': 'x', postinstall: 'x', dev: 'x' },
    });
    writeButtonsFile(dir, { buttons: BUTTONS });
    const registry = new ProjectRegistry(dataDir);
    registry.authorize(dir, 'demo');
    const pty = new PtyManager();
    const state = new WidgetState(registry, pty);
    state.activate(dir);
    return { dir, pty, state };
  }

  it('writes the new order into the existing array', () => {
    const { dir, state } = project();
    const order = state.getState().buttons.map((button) => button.id);

    expect(state.reorderButtons([order[3], order[0], order[1], order[2]])).toEqual({ ok: true });

    const stored = JSON.parse(readFile(projectButtonsFile(dir)));
    expect(stored.buttons.map((b: ButtonConfig) => b.name)).toEqual([
      'Dev',
      'Build',
      'Build:gateway',
      'Postinstall',
    ]);
    // Only the order changed: same objects, same shape, no extra field.
    expect(Object.keys(stored)).toEqual(['buttons']);
    expect(stored.buttons.every((b: ButtonConfig) => Object.keys(b).length === 2)).toBe(true);
  });

  it('writes once per reorder, and not at all when nothing moved', () => {
    const { dir, state } = project();
    const order = state.getState().buttons.map((button) => button.id);
    const file = projectButtonsFile(dir);

    const before = fs.statSync(file).mtimeMs;
    expect(state.reorderButtons(order)).toEqual({ ok: true });
    expect(fs.statSync(file).mtimeMs).toBe(before);

    const stored = readFile(file);
    expect(state.reorderButtons([order[1], order[0], order[2], order[3]])).toEqual({ ok: true });
    expect(readFile(file)).not.toBe(stored);
  });

  it('a reordered button keeps its session key, so its PTY survives', () => {
    const { pty, state } = project();
    const dev = state.getState().buttons.find((button) => button.name === 'Dev')!;
    const keyBefore = state.sessionKey(dev.id);
    const stop = vi.spyOn(pty, 'stop');
    const dispose = vi.spyOn(pty, 'disposeAll');

    const order = state.getState().buttons.map((button) => button.id);
    state.reorderButtons([order[3], order[0], order[1], order[2]]);

    const moved = state.getState().buttons.find((button) => button.name === 'Dev')!;
    expect(moved.id).toBe(dev.id);
    expect(state.sessionKey(moved.id)).toBe(keyBefore);
    expect(stop).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('rejects an order that does not match the project', () => {
    const { state } = project();
    expect(state.reorderButtons(['a', 'b']).ok).toBe(false);
    expect(state.reorderButtons('nao-uma-lista').ok).toBe(false);
    expect(state.reorderButtons([1, 2, 3, 4]).ok).toBe(false);
  });
});

describe('the order outlives the session', () => {
  function projectAt(name: string, scripts: Record<string, string>) {
    const dir = makeTempDir(`dev-island-${name}-`);
    writePackageJson(dir, { name, scripts });
    return dir;
  }

  it('a fresh read gets the stored order back', () => {
    const dir = projectAt('demo', { build: 'x', dev: 'x' });
    writeButtonsFile(dir, {
      buttons: [
        { name: 'Dev', script: 'npm run dev' },
        { name: 'Build', script: 'npm run build' },
      ],
    });

    // A brand new process reads the same file.
    expect(readButtonsFile(dir)?.buttons.map((button) => button.name)).toEqual(['Dev', 'Build']);
  });

  it('each project keeps its own order', () => {
    const dataDir = makeTempDir('dev-island-data-');
    const first = projectAt('um', { a: 'x', b: 'x' });
    const second = projectAt('dois', { a: 'x', b: 'x' });
    writeButtonsFile(first, {
      buttons: [
        { name: 'B', script: 'npm run b' },
        { name: 'A', script: 'npm run a' },
      ],
    });
    writeButtonsFile(second, {
      buttons: [
        { name: 'A', script: 'npm run a' },
        { name: 'B', script: 'npm run b' },
      ],
    });

    const registry = new ProjectRegistry(dataDir);
    registry.authorize(first, 'um');
    registry.authorize(second, 'dois');
    const state = new WidgetState(registry, new PtyManager());

    state.activate(first);
    expect(state.getState().buttons.map((b) => b.name)).toEqual(['B', 'A']);
    state.activate(second);
    expect(state.getState().buttons.map((b) => b.name)).toEqual(['A', 'B']);
    // Going back finds the first project's order intact.
    state.activate(first);
    expect(state.getState().buttons.map((b) => b.name)).toEqual(['B', 'A']);
  });

  it('a new script is appended without disturbing the chosen order', () => {
    const existing: ButtonConfig[] = [
      { name: 'Dev', script: 'npm run dev' },
      { name: 'Build', script: 'npm run build' },
    ];
    // package.json still lists build before dev; the file's order wins.
    const { buttons, added } = syncButtons(existing, ['build', 'dev', 'test'], 'npm');

    expect(buttons.map((button) => button.name)).toEqual(['Dev', 'Build', 'Test']);
    expect(added).toEqual([{ name: 'Test', script: 'npm run test' }]);
  });

  it('automatic discovery also appends at the end', () => {
    const dir = projectAt('demo', { build: 'x', dev: 'x' });
    writeButtonsFile(dir, {
      buttons: [
        { name: 'Dev', script: 'npm run dev' },
        { name: 'Build', script: 'npm run build' },
      ],
    });

    writePackageJson(dir, { name: 'demo', scripts: { build: 'x', dev: 'x', lint: 'x' } });
    const outcome = discoverProject(dir, { isAuthorized: () => true });

    expect(outcome.kind).toBe('synced');
    expect(JSON.parse(readFile(projectButtonsFile(dir))).buttons.map((b: ButtonConfig) => b.name)).toEqual([
      'Dev',
      'Build',
      'Lint',
    ]);
  });
});

describe('the order decides what the topbar shows', () => {
  it('the first buttons that fit are the visible ones', async () => {
    const { fitButtons, splitButtons, BAR_CHROME, BAR_GAP } = await import('../src/renderer/fit');
    const names = ['Compile', 'Watch', 'Typecheck', 'Test', 'Check', 'Dev'];
    const widths = names.map((name) => name.length * 7 + 20);

    // 520px leaves room for a few of the six scripts once the chrome, the
    // project label, the fixed controls and the reserved drag strip are paid
    // for, so both sides of the split are non-empty.
    const input = {
      maxWidth: 520,
      projectWidth: 125,
      controlsWidth: 98,
      moreWidth: 70,
      buttonWidths: widths,
      gap: BAR_GAP,
      chrome: BAR_CHROME,
    };
    const fit = fitButtons(input);
    expect(fit.visibleCount).toBeGreaterThan(0);
    expect(fit.hiddenCount).toBeGreaterThan(0);
    expect(fit.hiddenCount).toBe(names.length - fit.visibleCount);

    // Move the last script to the front: it becomes visible, and whatever it
    // displaced moves into "More".
    const reordered = [names[5]!, ...names.slice(0, 5)];
    const reorderedWidths = [widths[5]!, ...widths.slice(0, 5)];
    const after = fitButtons({ ...input, buttonWidths: reorderedWidths });

    expect(splitButtons(reordered, after.visibleCount).visible[0]).toBe('Dev');
    expect(splitButtons(reordered, after.visibleCount).hidden).toHaveLength(after.hiddenCount);
    expect(after.visibleCount + after.hiddenCount).toBe(names.length);
  });
});
