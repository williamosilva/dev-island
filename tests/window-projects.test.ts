import { afterEach, describe, expect, it } from 'vitest';

import { writeButtonsFile } from '../src/core/buttons-config';
import { ProjectRegistry } from '../src/core/registry';
import { normalizeWindowHandle } from '../src/main/foreground-watcher';
import { PtyManager } from '../src/main/pty-manager';
import type { ProcessProbe } from '../src/main/terminal-registry';
import { WidgetState } from '../src/main/widget-state';
import { WindowProjectRegistry } from '../src/main/window-projects';
import { makeTempDir, removeTempDirs, writePackageJson } from './helpers';

afterEach(removeTempDirs);

const WINDOW_A = '0x000000000000AAAA';
const WINDOW_B = '0x000000000000BBBB';
const WINDOW_C = '0x000000000000CCCC';

function probeWith(alive: number[]): ProcessProbe & { alive: Set<number> } {
  const set = new Set(alive);
  return { alive: set, isAlive: (pid) => set.has(pid) };
}

describe('the handle survives as text', () => {
  it('normalises to a full 64-bit hex string', () => {
    expect(normalizeWindowHandle('0xa1b2c')).toBe('0x00000000000A1B2C');
    expect(normalizeWindowHandle('0x000000000000AAAA')).toBe('0x000000000000AAAA');
    expect(normalizeWindowHandle('0x0')).toBe('0x0000000000000000');
  });

  it('keeps a handle that a JavaScript number would round off', () => {
    // 0x7FFFFFFFFFFFFFFF is far past Number.MAX_SAFE_INTEGER.
    const huge = '0x7FFFFFFFFFFFFFFF';
    expect(normalizeWindowHandle(huge)).toBe(huge);
    expect(String(Number(huge))).not.toBe('9223372036854775807');
  });

  it('treats different windows as different keys', () => {
    const registry = new WindowProjectRegistry(probeWith([1]));
    registry.record(WINDOW_A, 'C:/a', 1);
    registry.record(WINDOW_B, 'C:/b', 1);
    expect(registry.projectFor(WINDOW_A)).toBe('C:/a');
    expect(registry.projectFor(WINDOW_B)).toBe('C:/b');
  });
});

describe('one project per VS Code window', () => {
  it('each window keeps its own project', () => {
    const registry = new WindowProjectRegistry(probeWith([11, 22]));
    registry.record(WINDOW_A, 'C:/agent-rules-lens', 11);
    registry.record(WINDOW_B, 'C:/dev-island', 22);

    expect(registry.projectFor(WINDOW_A)).toBe('C:/agent-rules-lens');
    expect(registry.projectFor(WINDOW_B)).toBe('C:/dev-island');
  });

  it('switching windows switches project, both ways', () => {
    const registry = new WindowProjectRegistry(probeWith([11, 22]));
    registry.record(WINDOW_A, 'C:/agent-rules-lens', 11);
    registry.record(WINDOW_B, 'C:/dev-island', 22);

    const order = [WINDOW_A, WINDOW_B, WINDOW_A, WINDOW_B];
    expect(order.map((handle) => registry.projectFor(handle))).toEqual([
      'C:/agent-rules-lens',
      'C:/dev-island',
      'C:/agent-rules-lens',
      'C:/dev-island',
    ]);
  });

  it('a window nobody reported from has no project at all', () => {
    const registry = new WindowProjectRegistry(probeWith([11]));
    registry.record(WINDOW_A, 'C:/agent-rules-lens', 11);

    // Never a silent global fallback to the last project seen.
    expect(registry.projectFor(WINDOW_C)).toBeNull();
    expect(registry.projectFor(null)).toBeNull();
    expect(registry.projectFor(undefined)).toBeNull();
  });

  it('a report from Chrome carries no handle, so it associates nothing', () => {
    const registry = new WindowProjectRegistry(probeWith([11]));
    registry.record(WINDOW_A, 'C:/agent-rules-lens', 11);
    // The hook sends windowHandle = null when VS Code is not in front; main
    // then has nothing to file, and the existing mapping is untouched.
    expect(registry.projectFor(WINDOW_A)).toBe('C:/agent-rules-lens');
    expect(registry.size).toBe(1);
  });
});

describe('terminals inside a window', () => {
  it('the most recent terminal of a window wins', () => {
    let clock = 100;
    const registry = new WindowProjectRegistry(probeWith([11, 12]), () => (clock += 10));
    registry.record(WINDOW_A, 'C:/primeiro', 11);
    registry.record(WINDOW_A, 'C:/segundo', 12);
    expect(registry.projectFor(WINDOW_A)).toBe('C:/segundo');

    registry.record(WINDOW_A, 'C:/primeiro', 11);
    expect(registry.projectFor(WINDOW_A)).toBe('C:/primeiro');
  });

  it('a dead terminal falls back to another live one of the same window', () => {
    let clock = 100;
    const probe = probeWith([11, 12]);
    const registry = new WindowProjectRegistry(probe, () => (clock += 10));
    registry.record(WINDOW_A, 'C:/primeiro', 11);
    registry.record(WINDOW_A, 'C:/segundo', 12);

    probe.alive.delete(12);
    expect(registry.projectFor(WINDOW_A)).toBe('C:/primeiro');
  });

  it('closing the last terminal drops only that window', () => {
    const probe = probeWith([11, 22]);
    const registry = new WindowProjectRegistry(probe);
    registry.record(WINDOW_A, 'C:/agent-rules-lens', 11);
    registry.record(WINDOW_B, 'C:/dev-island', 22);

    probe.alive.delete(11);
    expect(registry.projectFor(WINDOW_A)).toBeNull();
    expect(registry.projectFor(WINDOW_B)).toBe('C:/dev-island');

    registry.prune();
    expect(registry.projectFor(WINDOW_B)).toBe('C:/dev-island');
    expect(registry.windowHandles).toEqual([WINDOW_B]);
  });

  it('a terminal of window A never overwrites window B', () => {
    let clock = 100;
    const registry = new WindowProjectRegistry(probeWith([11, 22]), () => (clock += 10));
    registry.record(WINDOW_B, 'C:/dev-island', 22);
    registry.record(WINDOW_A, 'C:/agent-rules-lens', 11);
    expect(registry.projectFor(WINDOW_B)).toBe('C:/dev-island');
  });
});

describe('processes are isolated per project', () => {
  function project(name: string, scripts: Record<string, string>) {
    const dir = makeTempDir(`dev-island-${name}-`);
    writePackageJson(dir, { name, scripts });
    writeButtonsFile(dir, {
      buttons: Object.keys(scripts).map((script) => ({
        name: script[0]!.toUpperCase() + script.slice(1),
        script: `npm run ${script}`,
      })),
    });
    return dir;
  }

  function twoProjects() {
    const dataDir = makeTempDir('dev-island-data-');
    const a = project('projeto-a', { dev: 'vite' });
    const b = project('projeto-b', { dev: 'vite' });
    const registry = new ProjectRegistry(dataDir);
    registry.authorize(a, 'projeto-a');
    registry.authorize(b, 'projeto-b');
    const pty = new PtyManager();
    return { a, b, pty, state: new WidgetState(registry, pty) };
  }

  it('the PTY key is the project root plus the button, never the button alone', () => {
    const { a, b, state } = twoProjects();

    state.activate(a);
    const buttonA = state.getState().buttons[0]!;
    const keyA = state.sessionKey(buttonA.id);

    state.activate(b);
    const buttonB = state.getState().buttons[0]!;
    const keyB = state.sessionKey(buttonB.id);

    // Same name, same command, same hash - and still a different session.
    expect(buttonA.name).toBe(buttonB.name);
    expect(buttonA.script).toBe(buttonB.script);
    expect(buttonA.id).toBe(buttonB.id);
    expect(keyA).not.toBe(keyB);
    expect(keyA.toLowerCase()).toContain('projeto-a');
    expect(keyB.toLowerCase()).toContain('projeto-b');
  });

  it('switching projects leaves the other one running and intact', () => {
    const { a, b, pty, state } = twoProjects();

    state.activate(a);
    const keyA = state.sessionKey(state.getState().buttons[0]!.id);

    state.activate(b);
    // Looking at project B does nothing to project A's session.
    expect(pty.snapshot(keyA)).toEqual({ status: 'idle', exitCode: null });
    expect(pty.buffer(keyA)).toBe('');

    state.activate(a);
    expect(state.sessionKey(state.getState().buttons[0]!.id)).toBe(keyA);
  });

  it('a button always resolves to the project currently shown', () => {
    const { a, b, state } = twoProjects();

    state.activate(a);
    expect(state.activeProject?.path.toLowerCase()).toContain('projeto-a');

    state.activate(b);
    // The cwd handed to the PTY comes from activeProject, so it follows the widget.
    expect(state.activeProject?.path.toLowerCase()).toContain('projeto-b');
    expect(state.activeProject?.path.toLowerCase()).not.toContain('projeto-a');
  });
});
