import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { windowStateFile } from '../src/core/paths';
import type { Anchor } from '../src/main/visibility';
import { WindowPlacement } from '../src/main/window-placement';
import { WindowStateStore } from '../src/main/window-state';
import {
  clampToArea,
  computeLayoutLimits,
  DEFAULT_TOP_OFFSET,
  defaultPosition,
  resolvePosition,
  toPlacement,
} from '../src/main/window-geometry';
import { resetStubDisplays, setStubDisplays } from './stubs/electron';
import { makeTempDir, removeTempDirs } from './helpers';

afterEach(() => {
  removeTempDirs();
  resetStubDisplays();
});

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };

/** A window that behaves like a BrowserWindow for placement purposes. */
function fakeWindow(bounds = { x: 0, y: 0, width: 400, height: 46 }) {
  const state = { ...bounds };
  return {
    state,
    window: {
      isDestroyed: () => false,
      getBounds: () => ({ ...state }),
      setPosition: (x: number, y: number) => {
        state.x = x;
        state.y = y;
      },
      setBounds: (next: { x: number; y: number; width: number; height: number }) => {
        Object.assign(state, next);
      },
    },
  };
}

/** One project stands in for "the project the capsule is showing". */
const TEST_PROJECT = 'C:/projetos/exemplo';

function setup(bounds?: { x: number; y: number; width: number; height: number }) {
  const dataDir = makeTempDir('dev-island-window-');
  const store = new WindowStateStore(dataDir, { debounceMs: 0 });
  // Positions are per project, so the store needs to know whose they are.
  store.setProject(TEST_PROJECT);
  const view = fakeWindow(bounds);
  const clock = { value: 1_000_000 };
  const placement = new WindowPlacement(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => view.window as any,
    store,
    { now: () => clock.value },
  );
  /** Simulates time passing, so a later drag is no longer inside the grace period. */
  const advance = (ms: number): void => {
    clock.value += ms;
  };
  return { dataDir, store, view, placement, advance };
}

const vsCode = (x: number, y: number, width = 1600, height = 900): Anchor => ({ x, y, width, height });

beforeEach(() => setStubDisplays([{ id: 1, workArea: PRIMARY }]));

describe('drag, hide and show restores the position', () => {
  it('keeps the offset the user chose instead of re-centring', () => {
    const { placement, view, store, advance } = setup();
    const anchor = vsCode(100, 60);

    placement.setAnchor(anchor);
    placement.applyPosition(anchor);
    const centred = { ...view.state };
    expect(centred.x).toBe(defaultPosition(view.state, anchor, PRIMARY).x);

    // The user drags it far to the left, well after our own move.
    advance(1000);
    view.state.x = 220;
    view.state.y = 400;
    placement.handleMoved();
    expect(store.get()).toEqual({ relativeX: 120, relativeY: 340, absoluteX: 220, absoluteY: 400 });

    // Hiding and showing again is programmatic: it must not record a move.
    placement.runProgrammatic(() => undefined);
    placement.handleMoved();
    expect(store.get()?.relativeX).toBe(120);

    // Re-anchoring on the same VS Code window puts it back where the user left it.
    advance(1000);
    view.state.x = 0;
    view.state.y = 0;
    placement.applyPosition(anchor);
    expect(view.state).toMatchObject({ x: 220, y: 400 });
  });
});

describe('restarting the app restores the position', () => {
  it('reads the placement back from its own file', () => {
    const first = setup();
    const anchor = vsCode(100, 60);
    first.placement.setAnchor(anchor);
    first.advance(1000);
    first.view.state.x = 500;
    first.view.state.y = 300;
    first.placement.handleMoved();

    // A fresh process over the same user data directory.
    const store = new WindowStateStore(first.dataDir, { debounceMs: 0 });
    store.setProject(TEST_PROJECT);
    const view = fakeWindow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const placement = new WindowPlacement(() => view.window as any, store);

    placement.applyPosition(anchor);
    expect(view.state).toMatchObject({ x: 500, y: 300 });
    expect(windowStateFile(first.dataDir).endsWith('window-state.json')).toBe(true);
  });
});

describe('programmatic moves never overwrite the manual position', () => {
  it('ignores moves made inside runProgrammatic', () => {
    const { placement, store, view } = setup();
    placement.setAnchor(vsCode(0, 0));

    placement.runProgrammatic(() => {
      view.state.x = 999;
      view.state.y = 999;
    });
    placement.handleMoved();
    expect(store.get()).toBeNull();
  });

  it('does not record the move made by applyPosition or applyContentSize', () => {
    const { placement, store, view } = setup();
    const anchor = vsCode(50, 50);
    placement.setAnchor(anchor);

    placement.applyPosition(anchor);
    placement.handleMoved();
    expect(store.get()).toBeNull();

    placement.applyContentSize(700, 420);
    placement.handleMoved();
    expect(store.get()).toBeNull();
    expect(view.state.width).toBe(700);
  });

  it('keeps x/y while only the height changes, and keeps the saved placement', () => {
    const { placement, view, store, advance } = setup({ x: 420, y: 310, width: 860, height: 42 });
    placement.setAnchor(vsCode(100, 60));
    advance(1000);
    placement.handleMoved();
    const saved = store.get();

    // compact -> theme -> add -> more -> terminal -> compact
    for (const height of [155, 198, 388, 465, 42]) {
      placement.applyContentSize(860, height);
      expect(view.state).toMatchObject({ x: 420, y: 310, width: 860 });
      expect(view.state.height).toBe(height);
      placement.handleMoved();
    }
    expect(store.get()).toEqual(saved);
  });

  it('keeps the top-left corner when a placed window expands', () => {
    const { placement, view, store, advance } = setup({ x: 300, y: 200, width: 400, height: 46 });
    placement.setAnchor(vsCode(0, 0));
    advance(1000);
    placement.handleMoved();
    expect(store.get()).not.toBeNull();

    placement.applyContentSize(760, 460);
    expect(view.state).toMatchObject({ x: 300, y: 200, width: 760, height: 460 });
  });
});

describe('an off-screen position is nudged, not reset', () => {
  it('clamps into the work area and keeps the rest of the offset', () => {
    const size = { width: 400, height: 46 };
    const saved = { relativeX: 5000, relativeY: 4000, absoluteX: 5000, absoluteY: 4000 };

    const position = resolvePosition(saved, size, vsCode(0, 0), PRIMARY);
    expect(position).toEqual({ x: PRIMARY.width - size.width, y: PRIMARY.height - size.height });
    // Not the default top-centre.
    expect(position).not.toEqual(defaultPosition(size, vsCode(0, 0), PRIMARY));
  });

  it('only moves the axis that is off screen', () => {
    const size = { width: 400, height: 46 };
    const saved = { relativeX: 300, relativeY: -900, absoluteX: 300, absoluteY: -900 };
    expect(resolvePosition(saved, size, vsCode(0, 0), PRIMARY)).toEqual({ x: 300, y: 0 });
  });

  it('clampToArea leaves a position that already fits untouched', () => {
    expect(clampToArea({ x: 200, y: 100 }, { width: 400, height: 46 }, PRIMARY)).toEqual({
      x: 200,
      y: 100,
    });
  });
});

describe('moving VS Code preserves the relative offset', () => {
  it('follows the window to another monitor', () => {
    setStubDisplays([
      { id: 1, workArea: PRIMARY },
      { id: 2, workArea: SECOND },
    ]);
    const { placement, view, store, advance } = setup();

    const onPrimary = vsCode(100, 60);
    placement.setAnchor(onPrimary);
    advance(1000);
    view.state.x = 340;
    view.state.y = 260;
    placement.handleMoved();
    expect(store.get()).toMatchObject({ relativeX: 240, relativeY: 200 });

    // The user drags VS Code to the second monitor.
    const onSecond = vsCode(2000, 120);
    placement.setAnchor(onSecond);
    placement.applyPosition(onSecond);
    expect(view.state).toMatchObject({ x: 2240, y: 320 });
  });

  it('survives a resolution change by clamping to the new work area', () => {
    const size = { width: 400, height: 46 };
    const saved = { relativeX: 240, relativeY: 200, absoluteX: 340, absoluteY: 260 };
    const small = { x: 0, y: 0, width: 1280, height: 720 };
    expect(resolvePosition(saved, size, vsCode(1100, 600), small)).toEqual({
      x: small.width - size.width,
      y: small.height - size.height,
    });
  });

  it('falls back to the absolute point when no VS Code window is known', () => {
    const size = { width: 400, height: 46 };
    const saved = { relativeX: 240, relativeY: 200, absoluteX: 340, absoluteY: 260 };
    expect(resolvePosition(saved, size, null, PRIMARY)).toEqual({ x: 340, y: 260 });
  });

  it('uses the default top-centre only when nothing was ever saved', () => {
    const size = { width: 400, height: 46 };
    expect(resolvePosition(null, size, vsCode(100, 60), PRIMARY)).toEqual(
      defaultPosition(size, vsCode(100, 60), PRIMARY),
    );
    // Centred on the VS Code window, DEFAULT_TOP_OFFSET below its top edge.
    expect(resolvePosition(null, size, vsCode(100, 60), PRIMARY)).toEqual({
      x: 700,
      y: 60 + DEFAULT_TOP_OFFSET,
    });
  });
});

describe('toPlacement', () => {
  it('records both the offset and the absolute point', () => {
    expect(toPlacement({ x: 340, y: 260 }, { x: 100, y: 60 })).toEqual({
      relativeX: 240,
      relativeY: 200,
      absoluteX: 340,
      absoluteY: 260,
    });
  });
});

describe('panels stay inside the usable area', () => {
  it('caps the capsule at 900px and at 80% of the VS Code window', () => {
    expect(computeLayoutLimits(vsCode(0, 0, 1600, 900), PRIMARY).maxWidth).toBe(900);
    expect(computeLayoutLimits(vsCode(0, 0, 800, 600), PRIMARY).maxWidth).toBe(640);
    expect(computeLayoutLimits(vsCode(0, 0, 800, 600), PRIMARY).maxHeight).toBe(480);
  });

  it('never goes below the minimum usable size', () => {
    const limits = computeLayoutLimits(vsCode(0, 0, 120, 80), PRIMARY);
    expect(limits.maxWidth).toBeGreaterThanOrEqual(260);
    expect(limits.maxHeight).toBeGreaterThanOrEqual(40);
  });

  it('clamps a window that asks for more than the limits allow', () => {
    const { placement, view } = setup();
    placement.setAnchor(vsCode(0, 0, 1000, 700));
    placement.applyContentSize(5000, 5000);
    expect(view.state.width).toBe(800);
    expect(view.state.height).toBe(560);
    expect(view.state.x).toBeGreaterThanOrEqual(PRIMARY.x);
    expect(view.state.x + view.state.width).toBeLessThanOrEqual(PRIMARY.x + PRIMARY.width);
  });

  it('falls back to the work area when no VS Code window is known', () => {
    expect(computeLayoutLimits(null, PRIMARY).maxWidth).toBe(900);
    expect(computeLayoutLimits(null, { x: 0, y: 0, width: 800, height: 600 }).maxWidth).toBe(640);
  });
});
