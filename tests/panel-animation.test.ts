import * as fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  boundsAt,
  BoundsAnimator,
  BOUNDS_DURATION_MS,
  BOUNDS_EASING,
  BOUNDS_STEPS,
  cubicBezier,
  sameRect,
  type AnimationClock,
} from '../src/main/bounds-animation';
import type { Rect } from '../src/main/window-geometry';
import { WindowPlacement } from '../src/main/window-placement';
import { WindowStateStore } from '../src/main/window-state';
import { PANEL_CLOSE_MS, PANEL_OPEN_MS, phaseClass } from '../src/renderer/panel-motion';
import type { Anchor } from '../src/main/visibility';
import { makeTempDir, removeTempDirs } from './helpers';

afterEach(() => removeTempDirs());

const CSS = fs.readFileSync('src/renderer/styles.css', 'utf8');
const APP = fs.readFileSync('src/renderer/App.tsx', 'utf8');
const BAR = fs.readFileSync('src/renderer/components/CompactBar.tsx', 'utf8');
const PLACEMENT = fs.readFileSync('src/main/window-placement.ts', 'utf8');
const WINDOW = fs.readFileSync('src/main/widget-window.ts', 'utf8');
const RESIZE = fs.readFileSync('src/renderer/useAutoResize.ts', 'utf8');
const ANIMATION = fs.readFileSync('src/main/bounds-animation.ts', 'utf8');

const PROJECT = 'C:/projetos/animado';
const COMPACT: Rect = { x: 400, y: 152, width: 840, height: 46 };

function rule(selector: string): string {
  const start = CSS.indexOf(selector + ' {');
  expect(start, selector).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf('}', start));
}

function vsCode(x = 120, y = 80, width = 1500, height = 900): Anchor {
  return { x, y, width, height };
}

/** A clock whose timers only run when the test says so. */
function fakeClock() {
  let next = 1;
  const pending = new Map<number, () => void>();
  const clock: AnimationClock = {
    schedule: (action) => {
      const handle = next;
      next += 1;
      pending.set(handle, action);
      return handle;
    },
    cancel: (handle) => pending.delete(handle as number),
  };
  /** Run whatever is scheduled, up to `limit` ticks. */
  const run = (limit = 200): number => {
    let ticks = 0;
    while (pending.size > 0 && ticks < limit) {
      const [handle, action] = [...pending.entries()][0]!;
      pending.delete(handle);
      action();
      ticks += 1;
    }
    return ticks;
  };
  const step = (): boolean => {
    const entry = [...pending.entries()][0];
    if (!entry) return false;
    pending.delete(entry[0]);
    entry[1]();
    return true;
  };
  return { clock, run, step, get waiting() { return pending.size; } };
}

/** A window that records every size it was given. */
function fakeWindow(bounds: Rect = COMPACT) {
  const state = { ...bounds, visible: true };
  const frames: Rect[] = [];
  const window = {
    isDestroyed: () => false,
    isVisible: () => state.visible,
    getBounds: () => ({ x: state.x, y: state.y, width: state.width, height: state.height }),
    setBounds: (next: Partial<Rect>) => {
      Object.assign(state, next);
      frames.push({ x: state.x, y: state.y, width: state.width, height: state.height });
    },
    setPosition: (x: number, y: number) => {
      state.x = x;
      state.y = y;
      frames.push({ x, y, width: state.width, height: state.height });
    },
    showInactive: () => {
      state.visible = true;
    },
    hide: () => {
      state.visible = false;
    },
    setAlwaysOnTop: () => undefined,
  };
  return { window, state, frames };
}

function setup(bounds: Rect = COMPACT) {
  const dataDir = makeTempDir('dev-island-anim-');
  const store = new WindowStateStore(dataDir, { debounceMs: 0 });
  const view = fakeWindow(bounds);
  const timers = fakeClock();
  const clockValue = { value: 1_000_000 };
  const placement = new WindowPlacement(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => view.window as any,
    store,
    { now: () => clockValue.value, clock: timers.clock },
  );
  placement.setAnchor(vsCode());
  placement.setProject(PROJECT);
  // The first size is the one the window is shown at, never animated.
  placement.applyContentSize(bounds.width, bounds.height, true);
  view.frames.length = 0;
  /** Where the capsule settled once it was placed: the compact baseline. */
  const compact = view.window.getBounds();
  return { placement, store, view, timers, dataDir, clockValue, compact };
}

/** Open a panel: the content grew taller, and asks to be animated. */
function expand(context: ReturnType<typeof setup>, height = 420): void {
  context.placement.applyContentSize(COMPACT.width, height, true);
}

describe('an expansion is not a single jump', () => {
  it('opening a terminal steps the window through intermediate sizes', () => {
    const context = setup();
    expand(context, 480);
    context.timers.run();

    const heights = context.view.frames.map((frame) => frame.height);
    expect(heights.length).toBeGreaterThanOrEqual(10);
    expect(heights.length).toBeLessThanOrEqual(16);
    expect(new Set(heights).size).toBeGreaterThanOrEqual(6);
    expect(heights[0]).toBeGreaterThan(context.compact.height);
    expect(heights[0]).toBeLessThan(480);
    // Most of the way there is visible: the curve settles into the target
    // over the last frames rather than arriving in one.
    expect(heights.filter((height) => height < 480).length).toBeGreaterThanOrEqual(6);
    expect(heights.at(-1)).toBe(480);
  });

  it('the form and More grow the same way, whatever the height', () => {
    for (const height of [180, 300, 620]) {
      const context = setup();
      expand(context, height);
      context.timers.run();
      const frames = context.view.frames;
      expect(frames.length, `${height}px`).toBe(BOUNDS_STEPS);
      expect(frames.at(-1)?.height).toBe(height);
      for (let index = 1; index < frames.length; index += 1) {
        expect(frames[index]!.height).toBeGreaterThanOrEqual(frames[index - 1]!.height);
      }
    }
  });

  it('a theme change is a fade of the surface, not a jump', () => {
    // The theme control switches the palette in place — there is no panel to
    // open — so the surfaces cross-fade instead of snapping.
    const island = rule('.island');
    expect(island).toContain('background-color var(--di-panel-in) var(--di-ease)');
    expect(island).toContain('border-color var(--di-panel-in) var(--di-ease)');
    expect(BAR).toContain('onClick={onToggleTheme}');
  });

  it('closing steps back down and lands on the compact size', () => {
    const context = setup();
    expand(context, 480);
    context.timers.run();
    context.view.frames.length = 0;

    context.placement.applyContentSize(COMPACT.width, COMPACT.height, true);
    context.timers.run();
    const heights = context.view.frames.map((frame) => frame.height);
    expect(heights.length).toBe(BOUNDS_STEPS);
    for (let index = 1; index < heights.length; index += 1) {
      expect(heights[index]!).toBeLessThanOrEqual(heights[index - 1]!);
    }
    expect(heights.at(-1)).toBe(COMPACT.height);
  });

  it('and the renderer takes the content out before it can be cut', () => {
    // The panel leaves the flow at once, so the capsule measures compact and
    // the window starts shrinking; the panel fades over the space given back.
    const collapsing = CSS.slice(CSS.indexOf('.island--collapsing .panel'));
    expect(collapsing).toContain('position: absolute');
    expect(collapsing).toContain('pointer-events: none');
    expect(collapsing).toContain('animation: di-panel-out');
    expect(rule('.island--collapsing')).toContain('overflow: visible');
    // Faster than the window takes to shrink.
    expect(PANEL_CLOSE_MS).toBeLessThan(BOUNDS_DURATION_MS);
  });
});

describe('the geometry the animation is allowed to touch', () => {
  it('the first frame comes from the real bounds and the last is exact', () => {
    const context = setup();
    expand(context, 400);
    context.timers.run();
    const frames = context.view.frames;
    expect(frames[0]!.height).toBeGreaterThan(context.compact.height);
    expect(frames.at(-1)).toEqual({
      x: context.compact.x,
      y: context.compact.y,
      width: context.compact.width,
      height: 400,
    });
    for (const frame of frames) {
      for (const value of Object.values(frame)) expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('every step is computed from the start, so rounding cannot drift', () => {
    const from = { x: 0, y: 0, width: 100, height: 46 };
    const to = { x: 0, y: 0, width: 100, height: 411 };
    const forwards = [0.1, 0.3, 0.7, 1].map((p) => boundsAt(from, to, p).height);
    const backwards = [1, 0.7, 0.3, 0.1].map((p) => boundsAt(from, to, p).height).reverse();
    expect(forwards).toEqual(backwards);
    expect(boundsAt(from, to, 1)).toEqual(to);
    expect(boundsAt(from, to, 0)).toEqual(from);
    expect(ANIMATION).toContain('boundsAt(from, to, step / steps)');
  });

  it('the capsule keeps its anchor: a placed window does not re-centre', () => {
    const context = setup();
    // The user dragged it, so the left edge is theirs.
    context.clockValue.value += 10_000;
    context.view.window.setPosition(310, 300);
    context.placement.handleMoved();
    context.view.frames.length = 0;

    expand(context, 500);
    context.timers.run();
    for (const frame of context.view.frames) {
      expect(frame.x).toBe(310);
      expect(frame.y).toBe(300);
    }
  });

  it('the animation never rewrites the stored position', () => {
    const context = setup();
    context.clockValue.value += 10_000;
    context.view.window.setPosition(310, 300);
    context.placement.handleMoved();
    const saved = context.store.get();

    expand(context, 500);
    context.timers.run();
    context.placement.applyContentSize(COMPACT.width, COMPACT.height, true);
    context.timers.run();
    expect(context.store.get()).toEqual(saved);
  });

  it('and every step is flagged programmatic, so none reads as a drag', () => {
    const context = setup();
    expand(context, 500);
    // A `moved` event arriving between two steps must be ignored.
    context.timers.step();
    context.placement.handleMoved();
    context.timers.run();
    context.placement.handleMoved();
    expect(context.store.get()).toBeNull();
    expect(PLACEMENT).toContain('if (live) this.runProgrammatic(() => live.setBounds(next));');
  });
});

describe('interruptions leave nothing half done', () => {
  it('a second opening continues from where the window really is', () => {
    const context = setup();
    expand(context, 500);
    context.timers.step();
    context.timers.step();
    const midway = context.view.window.getBounds().height;
    expect(midway).toBeGreaterThan(COMPACT.height);
    expect(midway).toBeLessThan(500);

    context.placement.applyContentSize(COMPACT.width, 300, true);
    context.timers.run();
    expect(context.view.window.getBounds().height).toBe(300);
    expect(context.timers.waiting).toBe(0);
  });

  it('repeated clicks cannot leave the window between two sizes', () => {
    const context = setup();
    for (const height of [420, 46, 380, 46, 500]) {
      context.placement.applyContentSize(COMPACT.width, height, true);
      context.timers.step();
    }
    context.timers.run();
    expect(context.view.window.getBounds().height).toBe(500);
    expect(context.placement.isAnimating).toBe(false);
  });

  it('hiding is immediate, and lands the size on its target first', () => {
    const context = setup();
    expand(context, 500);
    context.timers.step();
    expect(context.placement.isAnimating).toBe(true);

    context.placement.settleBounds();
    expect(context.view.window.getBounds().height).toBe(500);
    expect(context.placement.isAnimating).toBe(false);
    expect(context.timers.waiting).toBe(0);
    // The port settles before hiding, and hiding waits for nothing.
    const hide = WINDOW.slice(WINDOW.indexOf('hide: () => {'), WINDOW.indexOf('setAlwaysOnTop:'));
    expect(hide).toContain('placement.settleBounds()');
    expect(hide).toContain('live()?.hide()');
    expect(hide).not.toContain('setTimeout');
  });

  it('changing project settles the size instead of carrying it over', () => {
    const context = setup();
    expand(context, 500);
    context.timers.step();
    context.placement.setProject('C:/projetos/outro');
    expect(context.placement.isAnimating).toBe(false);
    expect(context.view.window.getBounds().height).toBe(500);
  });

  it('nothing about the animation touches a process or its output', () => {
    for (const source of [ANIMATION, PLACEMENT]) {
      // Nothing about sizing a window may reach a process, its output or the
      // project's configuration. (`clearTimeout` is a timer, not a log.)
      for (const forbidden of ['pty', 'Pty', 'kill(', 'clearLog', 'spawn', 'buttons']) {
        expect(source, forbidden).not.toContain(forbidden);
      }
    }
    // Closing keeps the panel's own tree alive: the terminal is not remounted.
    expect(APP).toContain("setPhase('collapsing')");
    const back = APP.slice(APP.indexOf('const back = useCallback'), APP.indexOf('const toggle'));
    expect(back).toContain('setView({ kind: \'compact\' })');
    expect(back).not.toContain('bridge.');
  });

  it('the script still starts in the same turn as the click', () => {
    const open = APP.slice(APP.indexOf('const openTerminal'), APP.indexOf('const addButton'));
    expect(open).toContain("if (button.status !== 'running') await bridge.run(button.id);");
    expect(open).not.toContain('setTimeout');
    expect(open).not.toContain('PANEL_OPEN_MS');
    expect(open.indexOf("setView({ kind: 'terminal'")).toBeLessThan(open.indexOf('bridge.run'));
  });
});

describe('the icon controls', () => {
  it('hover lifts them without moving anything else', () => {
    const hover = rule('.icon-button:hover');
    expect(hover).toContain('transform: translateY(-1px) scale(1.04)');
    expect(hover).toContain('background: var(--di-hover)');
    expect(hover).toContain('will-change: transform');
    for (const property of ['width', 'height', 'padding', 'margin', 'border-width', 'font-size']) {
      expect(hover, property).not.toContain(`${property}:`);
    }
    // Each icon has its own small touch, and both are inside their button.
    expect(rule('.icon-button--add:hover svg')).toContain('transform: scale(1.08)');
    expect(rule('.icon-button--theme:hover svg')).toContain('transform: rotate(-12deg)');
    expect(BAR).toContain("className=\"icon-button--theme\"");
    expect(BAR).toContain("'icon-button--add'");
  });

  it('pressing them gives way, and the return is a transition', () => {
    expect(rule('.icon-button:active')).toContain('transform: scale(0.95)');
    expect(rule('.icon-button:active')).toContain('background: var(--di-active)');
    const base = rule('.icon-button');
    expect(base).toContain('transform var(--di-quick) var(--di-ease)');
    const quick = Number(/--di-quick: (\d+)ms/.exec(rule(':root'))?.[1]);
    expect(quick).toBeGreaterThanOrEqual(120);
    expect(quick).toBeLessThanOrEqual(150);
  });

  it('and they keep their hit area, cursor and focus ring', () => {
    const base = rule('.icon-button');
    expect(base).toContain('width: 30px');
    expect(base).toContain('height: 30px');
    expect(base).toContain('cursor: pointer');
    expect(rule('.icon-button:focus-visible')).toContain('outline: 2px solid var(--di-accent)');
    const icon = fs.readFileSync('src/renderer/components/IconButton.tsx', 'utf8');
    expect(icon).toContain('aria-label={label}');
    expect(icon).toContain("type=\"button\"");
  });

  it('nothing loud was added: no ripple, glow, bounce or gradient', () => {
    // Comments stripped: prose saying "no gradient" must not fail the rule.
    const declarations = CSS.replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
    for (const forbidden of ['ripple', 'gradient', 'bounce', 'infinite', 'blur(']) {
      expect(declarations, forbidden).not.toContain(forbidden);
    }
  });
});

describe('what must not change', () => {
  it('reduced motion removes the movement, on both sides', () => {
    const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('.island--collapsing .panel');
    expect(block).toContain('animation: none !important');
    expect(block).toContain('.icon-button:hover');
    expect(block).toContain('transform: none !important');
    // And the window is resized in one step, because the renderer says so.
    expect(RESIZE).toContain('const animate = !first && !prefersReducedMotion();');
    expect(RESIZE).toContain('bridge.resizeWindow(baseWidth, height, animate);');
  });

  it('asking for no animation applies the size at once', () => {
    const context = setup();
    context.placement.applyContentSize(COMPACT.width, 460, false);
    expect(context.view.window.getBounds().height).toBe(460);
    expect(context.view.frames).toHaveLength(1);
    expect(context.placement.isAnimating).toBe(false);
  });

  it('nothing here can reach the project configuration', () => {
    for (const source of [ANIMATION, RESIZE, fs.readFileSync('src/renderer/panel-motion.ts', 'utf8')]) {
      expect(source).not.toContain('buttons.json');
      expect(source).not.toContain('.dev-island');
    }
    // The resize channel carries a size and a hint, and nothing else.
    expect(RESIZE).not.toContain('bridge.addButton');
    expect(RESIZE).not.toContain('bridge.reorderButtons');
  });
});

describe('the curve and the timing', () => {
  it('is the premium curve, at the length the design asks for', () => {
    expect(BOUNDS_EASING).toEqual([0.22, 1, 0.36, 1]);
    expect(BOUNDS_DURATION_MS).toBeGreaterThanOrEqual(180);
    expect(BOUNDS_DURATION_MS).toBeLessThanOrEqual(240);
    expect(BOUNDS_STEPS).toBeGreaterThanOrEqual(10);
    expect(BOUNDS_STEPS).toBeLessThanOrEqual(16);
    // The renderer's reveal runs over the same window of time.
    expect(PANEL_OPEN_MS).toBe(BOUNDS_DURATION_MS);
    expect(CSS).toContain('--di-panel-in: 200ms');
    expect(CSS).toContain('--di-ease: cubic-bezier(0.22, 1, 0.36, 1)');
  });

  it('the easing starts and ends where a curve must', () => {
    const ease = cubicBezier(...BOUNDS_EASING);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    // Front-loaded, as the curve's control points ask.
    expect(ease(0.25)).toBeGreaterThan(0.5);
    expect(ease(0.5)).toBeGreaterThan(0.8);
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = ease(t);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    let previous = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = ease(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('a size that did not change is applied once and animates nothing', () => {
    const animator = new BoundsAnimator(fakeClock().clock);
    const applied: Rect[] = [];
    animator.animate(COMPACT, { ...COMPACT }, (rect) => applied.push(rect));
    expect(applied).toEqual([COMPACT]);
    expect(animator.running).toBe(false);
    expect(sameRect(COMPACT, { ...COMPACT })).toBe(true);
  });

  it('the phases are a sequence, and only the moving ones carry a class', () => {
    expect(phaseClass('compact')).toBe('');
    expect(phaseClass('expanding')).toBe('island--expanding');
    expect(phaseClass('expanded')).toBe('');
    expect(phaseClass('collapsing')).toBe('island--collapsing');
    expect(APP).toContain("setPhase('expanding')");
    expect(APP).toContain("setPhase('expanded')");
    expect(APP).toContain("setPhase('collapsing')");
    expect(APP).toContain("setPhase('compact')");
  });
});
