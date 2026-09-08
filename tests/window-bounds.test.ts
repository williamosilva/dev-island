import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeButtonsFile } from '../src/core/buttons-config';
import { normalizeProjectPath, projectButtonsFile, windowStateFile } from '../src/core/paths';
import type { Anchor } from '../src/main/visibility';
import {
  clampPanelHeight,
  computeLayoutLimits,
  manualWidthCeiling,
  MIN_WIDTH,
  resolveWindowWidth,
} from '../src/main/window-geometry';
import { WindowPlacement, type BoundsDirection } from '../src/main/window-placement';
import { WindowStateStore } from '../src/main/window-state';
import { resetStubDisplays, setStubDisplays } from './stubs/electron';
import { makeTempDir, readFile, removeTempDirs, writePackageJson } from './helpers';

afterEach(() => {
  removeTempDirs();
  resetStubDisplays();
});

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const VS_CODE: Anchor = { x: 100, y: 60, width: 1600, height: 900 };

beforeEach(() => setStubDisplays([{ id: 1, workArea: PRIMARY }]));

function fakeWindow(bounds = { x: 400, y: 200, width: 880, height: 400 }) {
  const state = { ...bounds };
  return {
    state,
    window: {
      isDestroyed: () => false,
      getBounds: () => ({ ...state }),
      setPosition: (x: number, y: number) => Object.assign(state, { x, y }),
      setBounds: (next: { x: number; y: number; width: number; height: number }) =>
        Object.assign(state, next),
    },
  };
}

/** One project stands in for "the project the capsule is showing". */
const TEST_PROJECT = 'C:/projetos/exemplo';

function setup(dataDir = makeTempDir('dev-island-bounds-'), bounds?: Parameters<typeof fakeWindow>[0]) {
  const store = new WindowStateStore(dataDir, { debounceMs: 0 });
  store.setProject(TEST_PROJECT);
  const view = fakeWindow(bounds);
  const clock = { value: 1_000_000 };
  const placement = new WindowPlacement(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => view.window as any,
    store,
    { now: () => clock.value },
  );
  placement.setAnchor(VS_CODE);

  /** One gesture: exactly what the renderer sends for a given drag. */
  const drag = (direction: BoundsDirection, dx: number, dy: number): void => {
    const start = { ...view.state };
    const west = direction.includes('w');
    const north = direction.includes('n');
    const east = direction.includes('e');
    const south = direction.includes('s');
    placement.applyManualBounds(
      direction === 'move'
        ? { x: start.x + dx, y: start.y + dy, width: start.width, height: start.height }
        : {
            x: west ? start.x + dx : start.x,
            y: north ? start.y + dy : start.y,
            width: east ? start.width + dx : west ? start.width - dx : start.width,
            height: south ? start.height + dy : north ? start.height - dy : start.height,
          },
      direction,
    );
    placement.commitManualBounds();
  };

  const right = (): number => view.state.x + view.state.width;
  const bottom = (): number => view.state.y + view.state.height;

  return { dataDir, store, view, placement, drag, right, bottom, advance: (ms: number) => (clock.value += ms) };
}

describe('the eight directions', () => {
  it('east grows the width and leaves x alone', () => {
    const { view, drag } = setup();
    drag('e', 120, 0);
    expect(view.state).toMatchObject({ x: 400, y: 200, width: 1000, height: 400 });
  });

  it('west moves x and keeps the right edge', () => {
    const { view, drag, right } = setup();
    const before = right();
    drag('w', -80, 0);
    expect(view.state).toMatchObject({ x: 320, width: 960, y: 200 });
    expect(right()).toBe(before);
  });

  it('south grows the height and leaves y alone', () => {
    const { view, drag } = setup();
    drag('s', 0, 90);
    expect(view.state).toMatchObject({ y: 200, height: 490, width: 880 });
  });

  it('north moves y and keeps the bottom edge', () => {
    const { view, drag, bottom } = setup();
    const before = bottom();
    drag('n', 0, -70);
    expect(view.state).toMatchObject({ y: 130, height: 470 });
    expect(bottom()).toBe(before);
  });

  it('the four corners combine both axes', () => {
    const se = setup();
    se.drag('se', 40, 30);
    expect(se.view.state).toMatchObject({ x: 400, y: 200, width: 920, height: 430 });

    const sw = setup();
    const swRight = sw.right();
    sw.drag('sw', -40, 30);
    expect(sw.view.state).toMatchObject({ x: 360, y: 200, width: 920, height: 430 });
    expect(sw.right()).toBe(swRight);

    const ne = setup();
    const neBottom = ne.bottom();
    ne.drag('ne', 40, -30);
    expect(ne.view.state).toMatchObject({ x: 400, y: 170, width: 920, height: 430 });
    expect(ne.bottom()).toBe(neBottom);

    const nw = setup();
    const nwRight = nw.right();
    const nwBottom = nw.bottom();
    nw.drag('nw', -40, -30);
    expect(nw.view.state).toMatchObject({ x: 360, y: 170, width: 920, height: 430 });
    expect(nw.right()).toBe(nwRight);
    expect(nw.bottom()).toBe(nwBottom);
  });
});

describe('minimum size preserves the opposite edge', () => {
  it('stops at the minimum width instead of sliding the window', () => {
    const { view, drag, right } = setup();
    const before = right();
    // Pull the left edge far past the right one.
    drag('w', 4000, 0);
    expect(view.state.width).toBe(MIN_WIDTH);
    expect(right()).toBe(before);
    expect(view.state.width).toBeGreaterThan(0);
  });

  it('stops at the minimum height instead of sliding the window', () => {
    const { view, drag, bottom } = setup();
    const before = bottom();
    drag('n', 0, 4000);
    expect(view.state.height).toBeGreaterThan(0);
    expect(bottom()).toBe(before);
  });

  it('never produces a negative size from a wild drag', () => {
    const { view, drag } = setup();
    for (const direction of ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
      drag(direction, -9000, -9000);
      expect(view.state.width).toBeGreaterThanOrEqual(MIN_WIDTH);
      expect(view.state.height).toBeGreaterThan(0);
    }
  });

  it('clamps to the work area on the axis that left it', () => {
    const { view, drag } = setup(undefined, { x: 1500, y: 900, width: 400, height: 120 });
    drag('e', 2000, 0);
    expect(view.state.x + view.state.width).toBeLessThanOrEqual(PRIMARY.x + PRIMARY.width);
    expect(view.state.y).toBe(900);
  });
});

describe('resizing from north or west persists the new position', () => {
  it('stores the moved corner as the placement', () => {
    const { drag, store, view } = setup();
    drag('nw', -60, -40);
    expect(store.get()).toMatchObject({ absoluteX: view.state.x, absoluteY: view.state.y });
    expect(store.get()?.relativeX).toBe(view.state.x - VS_CODE.x);
    expect(store.get()?.relativeY).toBe(view.state.y - VS_CODE.y);
    expect(store.getSize()).toMatchObject({ sizeMode: 'manual', manualWidth: view.state.width });
  });

  it('writes the placement once, at the end of the gesture', () => {
    const { placement, view, dataDir } = setup();
    for (let step = 1; step <= 10; step += 1) {
      placement.applyManualBounds(
        { x: view.state.x, y: view.state.y, width: 880 + step * 5, height: view.state.height },
        'e',
      );
    }
    // The position is only recorded when the gesture ends.
    expect(JSON.parse(readFile(windowStateFile(dataDir))).projects).toBeUndefined();

    placement.commitManualBounds();
    const stored = JSON.parse(readFile(windowStateFile(dataDir)));
    // Stored under the project it belongs to, never as a global position.
    expect(stored.version).toBe(2);
    expect(stored.projects[normalizeProjectPath(TEST_PROJECT)]).toMatchObject({
      absoluteX: view.state.x,
      absoluteY: view.state.y,
    });
    expect(stored.manualWidth).toBe(view.state.width);
  });
});

describe('the compact capsule does not stretch vertically', () => {
  it('only the horizontal handles exist while compact', async () => {
    const source = fs.readFileSync('src/renderer/components/ResizeHandles.tsx', 'utf8');
    // The vertical ones are filtered out when no panel is open.
    expect(source).toContain('resizableHeight ? HANDLES : HANDLES.filter((spec) => !spec.vertical)');
    expect(source).toContain("{ direction: 'e'");
    expect(source).toContain("{ direction: 'w'");
    await Promise.resolve();
  });

  it('a horizontal drag never changes the height', () => {
    const { view, drag } = setup(undefined, { x: 400, y: 200, width: 880, height: 44 });
    drag('e', 200, 0);
    expect(view.state.height).toBe(44);
    drag('w', -150, 0);
    expect(view.state.height).toBe(44);
  });
});

describe('manual width rules', () => {
  it('a resize switches the mode to manual', () => {
    const { placement, drag, store } = setup();
    expect(placement.limits.sizeMode).toBe('auto');
    drag('e', 100, 0);
    expect(placement.limits.sizeMode).toBe('manual');
    expect(store.getSize().sizeMode).toBe('manual');
  });

  it('allows more than the automatic ceiling, up to 95% of VS Code', () => {
    expect(computeLayoutLimits(VS_CODE, PRIMARY).maxWidth).toBe(900);
    expect(manualWidthCeiling(VS_CODE, PRIMARY)).toBe(1520);

    const { placement, view, drag } = setup();
    drag('e', 400, 0);
    expect(view.state.width).toBe(1280);
    expect(placement.limits.maxWidth).toBeGreaterThan(900);

    drag('e', 4000, 0);
    expect(view.state.width).toBe(1520);
  });

  it('the measured width never overrides the manual one', () => {
    const { placement, drag } = setup();
    drag('e', 100, 0);
    for (const measured of [300, 880, 2000]) {
      expect(resolveWindowWidth(measured, placement.limits)).toBe(980);
    }
  });

  it('opening panels only changes the height', () => {
    const { placement, view, drag } = setup();
    drag('e', 100, 0);
    for (const height of [201, 371, 468, 44]) {
      placement.applyContentSize(500, height);
      expect(view.state.width).toBe(980);
      expect(view.state).toMatchObject({ x: 400, y: 200 });
    }
  });

  it('a programmatic resize is never taken for a manual one', () => {
    const { placement, store } = setup();
    placement.applyContentSize(880, 44);
    expect(store.getSize()).toMatchObject({ sizeMode: 'auto', manualWidth: null });

    placement.runProgrammatic(() => undefined);
    placement.handleMoved();
    expect(store.get()).toBeNull();
  });

  it('a horizontal gesture leaves the compact height untouched', () => {
    const { view, drag } = setup(undefined, { x: 400, y: 200, width: 880, height: 44 });
    drag('e', 300, 0);
    expect(view.state.height).toBe(44);
  });

  it('a vertical gesture grows the panel body', () => {
    const { placement, drag } = setup();
    const before = placement.limits.panelHeight;
    drag('s', 0, 120);
    expect(placement.limits.panelHeight).toBe(clampPanelHeight(before + 120));
  });
});

describe('a manual size survives what comes after it', () => {
  it('repeated content updates never shrink a manual window', () => {
    const { placement, view, drag } = setup();
    drag('e', 300, 0);
    const width = view.state.width;
    for (let round = 0; round < 20; round += 1) {
      placement.applyContentSize(view.state.width, view.state.height);
      expect(view.state.width).toBe(width);
    }
  });

  it('a window-state file from before per-project positions is kept, not applied', () => {
    const dataDir = makeTempDir('dev-island-old-');
    const legacy = { relativeX: 100, relativeY: 180, absoluteX: 200, absoluteY: 240 };
    fs.writeFileSync(
      windowStateFile(dataDir),
      JSON.stringify({ version: 1, placement: legacy }),
      'utf8',
    );

    const store = new WindowStateStore(dataDir, { debounceMs: 0 });
    store.setProject(TEST_PROJECT);
    // That position belonged to whichever project was open when it was
    // written, which cannot be known now — so no project inherits it.
    expect(store.get()).toBeNull();
    expect(store.getLegacy()).toEqual(legacy);
    expect(store.getSize()).toEqual({ sizeMode: 'auto', manualWidth: null, panelHeight: null });

    // It survives the upgrade rather than being thrown away.
    store.saveSize({ panelHeight: 300 });
    store.flush();
    const stored = JSON.parse(readFile(windowStateFile(dataDir)));
    expect(stored.version).toBe(2);
    expect(stored.legacy).toEqual(legacy);
    expect(stored.projects).toBeUndefined();
  });

  it('discards sizes that make no sense', () => {
    const dataDir = makeTempDir('dev-island-bad-');
    fs.writeFileSync(
      windowStateFile(dataDir),
      JSON.stringify({ version: 1, sizeMode: 'manual', manualWidth: -50, panelHeight: 99999 }),
      'utf8',
    );
    expect(new WindowStateStore(dataDir, { debounceMs: 0 }).getSize()).toEqual({
      sizeMode: 'auto',
      manualWidth: null,
      panelHeight: null,
    });
    expect(clampPanelHeight(99999)).toBeLessThanOrEqual(900);
  });

  it('a stored width wider than the screen is brought back in', () => {
    const dataDir = makeTempDir('dev-island-wide-');
    new WindowStateStore(dataDir, { debounceMs: 0 }).saveSize({
      sizeMode: 'manual',
      manualWidth: 3000,
    });
    const small = { x: 0, y: 0, width: 1280, height: 720 };
    const limits = computeLayoutLimits(
      { x: 0, y: 0, width: 1000, height: 700 },
      small,
      new WindowStateStore(dataDir, { debounceMs: 0 }).getSize(),
    );
    expect(limits.maxWidth).toBe(950);
    expect(limits.maxWidth).toBeLessThanOrEqual(small.width);
  });

  it('never touches the project config', () => {
    const projectDir = makeTempDir('dev-island-project-');
    writePackageJson(projectDir, { name: 'demo', scripts: { dev: 'vite' } });
    writeButtonsFile(projectDir, { buttons: [{ name: 'Dev', script: 'npm run dev' }] });
    const before = readFile(projectButtonsFile(projectDir));
    const beforeMtime = fs.statSync(projectButtonsFile(projectDir)).mtimeMs;

    const { drag, placement } = setup();
    drag('nw', -60, -40);
    drag('se', 80, 60);
    placement.resetToAutoSize();

    expect(readFile(projectButtonsFile(projectDir))).toBe(before);
    expect(fs.statSync(projectButtonsFile(projectDir)).mtimeMs).toBe(beforeMtime);
  });
});

describe('drag and auto reset', () => {
  it('the grip move keeps the size and stores the position', () => {
    const { view, drag, store } = setup();
    drag('move', 120, 80);
    expect(view.state).toMatchObject({ x: 520, y: 280, width: 880, height: 400 });
    expect(store.get()).toMatchObject({ absoluteX: 520, absoluteY: 280 });
  });

  it('a double click goes back to the automatic width', () => {
    const { placement, drag, store, view } = setup();
    drag('e', 300, 0);
    expect(placement.limits.sizeMode).toBe('manual');

    placement.resetToAutoSize();
    expect(placement.limits.sizeMode).toBe('auto');
    expect(store.getSize()).toMatchObject({ sizeMode: 'auto', manualWidth: null });

    placement.applyContentSize(889, 44);
    expect(view.state).toMatchObject({ x: 400, width: 889 });
  });
});
