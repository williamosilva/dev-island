import { screen, type BrowserWindow } from 'electron';

import { normalizeProjectPath } from '../core/paths';
import type { LayoutLimits } from '../shared/types';
import { BoundsAnimator, type AnimationClock } from './bounds-animation';
import type { Anchor } from './visibility';

export type BoundsDirection =
  | 'move'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'nw';
import {
  clampPanelHeight,
  clampSize,
  clampToArea,
  clampValue,
  computeLayoutLimits,
  manualWidthCeiling,
  MIN_HEIGHT,
  MIN_WIDTH,
  resolvePosition,
  toPlacement,
  type Rect,
} from './window-geometry';
import type { WindowStateStore } from './window-state';

// Windows delivers `moved` asynchronously, so a boolean cannot tell our own
// moves from a drag. A drag outlives the window and still gets recorded.
const PROGRAMMATIC_GRACE_MS = 250;

export interface PlacementOptions {
  now?: () => number;
  programmaticGraceMs?: number;
  clock?: AnimationClock;
}

/**
 * Owns where the capsule sits.
 *
 * The user's drag is authoritative: our own moves (anchoring, resizing,
 * showing) are flagged so they can never overwrite the offset they chose.
 */
export class WindowPlacement {
  private anchor: Anchor | null = null;
  /** Once set, width changes grow to the right instead of sliding the window. */
  private userPinned = false;
  private programmaticUntil = 0;
  private limitsCache: LayoutLimits;
  /** Until the renderer reports a width the centred default cannot be computed. */
  private measured = false;
  private pendingShow: (() => void) | null = null;

  private readonly now: () => number;
  private readonly graceMs: number;
  /** CSS cannot resize a window, so panel growth is stepped here. */
  private readonly bounds: BoundsAnimator;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly store: WindowStateStore,
    options: PlacementOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.graceMs = options.programmaticGraceMs ?? PROGRAMMATIC_GRACE_MS;
    this.bounds = new BoundsAnimator(options.clock);
    this.limitsCache = computeLayoutLimits(null, this.workArea(null), store.getSize());
    this.userPinned = store.get() !== null || store.getSize().sizeMode === 'manual';
  }

  /** A project with no position of its own gets the default, never another's. */
  setProject(projectRoot: string | null): void {
    if (this.store.projectKey === (projectRoot === null ? null : normalizeProjectPath(projectRoot))) {
      return;
    }
    // A size still opening belongs to the project being left.
    this.settleBounds();
    this.store.flush();
    this.store.setProject(projectRoot);
    this.userPinned = this.store.get() !== null || this.store.getSize().sizeMode === 'manual';
    this.applyPosition(this.anchor);
  }

  get limits(): LayoutLimits {
    return this.limitsCache;
  }

  private workArea(anchor: Anchor | null): Rect {
    try {
      const display =
        anchor && anchor.width > 0 && anchor.height > 0
          ? screen.getDisplayMatching({
              x: anchor.x,
              y: anchor.y,
              width: anchor.width,
              height: anchor.height,
            })
          : screen.getPrimaryDisplay();
      return display.workArea;
    } catch {
      return { x: 0, y: 0, width: 1920, height: 1080 };
    }
  }

  private live(): BrowserWindow | null {
    const window = this.getWindow();
    return window && !window.isDestroyed() ? window : null;
  }

  /** Moves the window without the result counting as a drag. */
  runProgrammatic<T>(action: () => T): T {
    this.programmaticUntil = this.now() + this.graceMs;
    try {
      return action();
    } finally {
      this.programmaticUntil = this.now() + this.graceMs;
    }
  }

  private refreshLimits(): boolean {
    const limits = computeLayoutLimits(this.anchor, this.workArea(this.anchor), this.store.getSize());
    if (
      limits.sizeMode === this.limitsCache.sizeMode &&
      limits.maxWidth === this.limitsCache.maxWidth &&
      limits.maxHeight === this.limitsCache.maxHeight &&
      limits.panelHeight === this.limitsCache.panelHeight
    ) {
      return false;
    }
    this.limitsCache = limits;
    return true;
  }

  /** Records the reference frame without moving anything. True if limits changed. */
  setAnchor(anchor: Anchor | null): boolean {
    this.anchor = anchor;
    return this.refreshLimits();
  }

  /** Baselines captured once, so no step accumulates the previous one. */
  private gesture: { windowHeight: number; panelHeight: number } | null = null;
  /** After a north drag, content taller than asked for must keep the bottom edge. */
  private preserveBottomEdge = false;

  /**
   * The renderer sends the geometry it wants; clamping lives here. At the
   * minimum size the opposite edge is pinned so the window stops instead of
   * sliding away.
   */
  applyManualBounds(bounds: Rect, direction: BoundsDirection): boolean {
    const window = this.live();
    if (!window) return false;

    const current = window.getBounds();
    if (!this.gesture) {
      this.gesture = {
        windowHeight: current.height,
        panelHeight: this.limitsCache.panelHeight,
      };
    }

    const area = this.workArea(this.anchor);
    const resizing = direction !== 'move';

    const width = resizing
      ? Math.round(
          clampValue(
            bounds.width,
            MIN_WIDTH,
            Math.min(manualWidthCeiling(this.anchor, area), area.width),
          ),
        )
      : current.width;
    const height = resizing
      ? Math.round(clampValue(bounds.height, MIN_HEIGHT, Math.min(this.limitsCache.maxHeight, area.height)))
      : current.height;

    // Pin the edge the gesture is not pulling.
    const anchoredX = direction.includes('w') ? bounds.x + bounds.width - width : bounds.x;
    const anchoredY = direction.includes('n') ? bounds.y + bounds.height - height : bounds.y;
    const position = clampToArea({ x: anchoredX, y: anchoredY }, { width, height }, area);

    this.userPinned = true;
    this.preserveBottomEdge = direction.includes('n');
    let changed = false;

    if (resizing) {
      this.store.saveSize({ sizeMode: 'manual', manualWidth: width });
      // The body of the open panel absorbs the height the gesture added.
      const panelHeight = clampPanelHeight(
        this.gesture.panelHeight + (height - this.gesture.windowHeight),
      );
      this.store.saveSize({ panelHeight });
      changed = this.refreshLimits();
    }

    if (
      current.x !== position.x ||
      current.y !== position.y ||
      current.width !== width ||
      current.height !== height
    ) {
      this.runProgrammatic(() => window.setBounds({ ...position, width, height }));
      changed = true;
    }
    return changed;
  }

  commitManualBounds(): void {
    const window = this.live();
    this.gesture = null;
    // The flag survives just long enough for the content to settle.
    setTimeout(() => (this.preserveBottomEdge = false), 400).unref?.();
    if (!window) return;
    this.store.save(toPlacement(window.getBounds(), this.anchor));
    this.store.flush();
  }

  get isGesturing(): boolean {
    return this.gesture !== null;
  }

  get isAnimating(): boolean {
    return this.bounds.running;
  }

  /** Hiding must be immediate and must not leave the window half open. */
  settleBounds(): void {
    this.bounds.settle();
  }

  resetToAutoSize(): boolean {
    this.store.saveSize({ sizeMode: 'auto', manualWidth: null });
    return this.refreshLimits();
  }

  /** The first show waits for the measurement, so the capsule never jumps. */
  showWhenPositioned(show: () => void): void {
    if (!this.measured) {
      this.pendingShow = show;
      return;
    }
    this.applyPosition(this.anchor);
    this.runProgrammatic(show);
  }

  cancelPendingShow(): void {
    this.pendingShow = null;
  }

  applyPosition(anchor: Anchor | null): void {
    const window = this.live();
    if (!window) return;
    this.anchor = anchor;

    const bounds = window.getBounds();
    const position = resolvePosition(this.store.get(), bounds, anchor, this.workArea(anchor));
    if (position.x === bounds.x && position.y === bounds.y) return;
    this.runProgrammatic(() => window.setPosition(position.x, position.y));
  }

  /**
   * A window the user placed keeps its top-left corner; an untouched one keeps
   * its horizontal centre.
   */
  applyContentSize(width: number, height: number, animate = false): void {
    const window = this.live();
    if (!window) return;
    if (this.gesture) return;

    // Take over from where the window is, not from where the last one started.
    this.bounds.stop();
    const bounds = window.getBounds();
    // In manual mode this keeps the user's width, so only the height changes.
    const size = clampSize({ width, height }, this.limitsCache);
    const first = !this.measured;
    this.measured = true;

    if (size.width === bounds.width && size.height === bounds.height) {
      // Right size already, but a show may still be waiting on the measurement.
      if (first) this.releasePendingShow();
      return;
    }

    const keepLeftEdge = this.userPinned;
    const desired = keepLeftEdge
      ? {
          x: bounds.x,
          y: this.preserveBottomEdge
            ? bounds.y + bounds.height - size.height
            : bounds.y,
        }
      : { x: Math.round(bounds.x + bounds.width / 2 - size.width / 2), y: bounds.y };
    const position = clampToArea(desired, size, this.workArea(this.anchor));
    const target = { x: position.x, y: position.y, width: size.width, height: size.height };

    const setBounds = (next: Rect): void => {
      const live = this.live();
      if (live) this.runProgrammatic(() => live.setBounds(next));
    };

    // A hidden window has nothing to animate.
    if (!animate || first || !window.isVisible()) {
      setBounds(target);
      if (first) this.releasePendingShow();
      return;
    }

    this.bounds.animate(bounds, target, setBounds);
  }

  private releasePendingShow(): void {
    const show = this.pendingShow;
    if (!show) return;
    this.pendingShow = null;
    this.applyPosition(this.anchor);
    this.runProgrammatic(show);
  }

  handleMoved(): void {
    if (this.now() < this.programmaticUntil) return;
    const window = this.live();
    if (!window) return;
    this.userPinned = true;
    this.store.save(toPlacement(window.getBounds(), this.anchor));
  }

  flush(): void {
    this.store.flush();
  }
}
