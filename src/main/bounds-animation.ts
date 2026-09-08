/**
 * Animating the window's own bounds.
 *
 * A `BrowserWindow` really does change size — no CSS transition can move it —
 * so the growth of a panel is animated here, by stepping the native bounds.
 * Every step is computed from the bounds the animation started at, never from
 * the previous step, so rounding cannot drift and the last step lands exactly
 * on the target.
 */

import type { Rect } from './window-geometry';

export const BOUNDS_DURATION_MS = 200;

/** The same curve the capsule and the panels use. */
export const BOUNDS_EASING = [0.22, 1, 0.36, 1] as const;

export const BOUNDS_STEPS = 12;

/**
 * `cubic-bezier(x1, y1, x2, y2)` at `t`. The curve is defined with x as time,
 * so the y needs the parameter that produces that x; a bisection is enough.
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const axis = (a: number, b: number, u: number): number => {
    const v = 1 - u;
    return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u;
  };

  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let low = 0;
    let high = 1;
    let u = t;
    for (let round = 0; round < 20; round += 1) {
      const x = axis(x1, x2, u);
      if (x < t) low = u;
      else high = u;
      u = (low + high) / 2;
    }
    return axis(y1, y2, u);
  };
}

const ease = cubicBezier(...BOUNDS_EASING);

export function boundsAt(from: Rect, to: Rect, progress: number): Rect {
  const eased = ease(Math.min(Math.max(progress, 0), 1));
  const step = (a: number, b: number): number => Math.round(a + (b - a) * eased);
  return {
    x: step(from.x, to.x),
    y: step(from.y, to.y),
    width: step(from.width, to.width),
    height: step(from.height, to.height),
  };
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Injected so tests can step the animation. */
export interface AnimationClock {
  schedule(action: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const realClock: AnimationClock = {
  schedule: (action, delayMs) => {
    const timer = setTimeout(action, delayMs);
    timer.unref?.();
    return timer;
  },
  cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface AnimateOptions {
  durationMs?: number;
  steps?: number;
}

/**
 * One animation at a time: a second one takes over from where the window is,
 * and cancelling lands on the target rather than leaving it half open.
 */
export class BoundsAnimator {
  private handle: unknown = null;
  private target: Rect | null = null;
  private apply: ((bounds: Rect) => void) | null = null;

  constructor(private readonly clock: AnimationClock = realClock) {}

  get running(): boolean {
    return this.handle !== null;
  }

  get destination(): Rect | null {
    return this.target;
  }

  animate(
    from: Rect,
    to: Rect,
    apply: (bounds: Rect) => void,
    options: AnimateOptions = {},
  ): void {
    this.stop();
    if (sameRect(from, to)) {
      apply(to);
      return;
    }

    const steps = Math.max(1, Math.round(options.steps ?? BOUNDS_STEPS));
    const duration = Math.max(0, options.durationMs ?? BOUNDS_DURATION_MS);
    const interval = duration / steps;
    this.target = { ...to };
    this.apply = apply;

    let step = 0;
    const tick = (): void => {
      step += 1;
      const last = step >= steps;
      // Always from `from`, so no step inherits another step's rounding.
      apply(last ? { ...to } : boundsAt(from, to, step / steps));
      if (last) {
        this.handle = null;
        this.target = null;
        this.apply = null;
        return;
      }
      this.handle = this.clock.schedule(tick, interval);
    };

    this.handle = this.clock.schedule(tick, interval);
  }

  /** Leaves the window wherever it is. */
  stop(): void {
    if (this.handle !== null) this.clock.cancel(this.handle);
    this.handle = null;
    this.target = null;
    this.apply = null;
  }

  /** Lands on the target at once, so the geometry is never a mid-animation frame. */
  settle(): void {
    const target = this.target;
    const apply = this.apply;
    this.stop();
    if (target && apply) apply(target);
  }
}
