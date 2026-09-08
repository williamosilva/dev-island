/**
 * How long a panel takes to open and to close.
 *
 * The window itself is what grows — a `BrowserWindow` cannot be moved by CSS —
 * so the main process steps its bounds over `BOUNDS_DURATION_MS` while the
 * renderer plays the reveal over these. The two start in the same commit, so
 * they run together rather than one after the other.
 */

/** Matches `--di-panel-in`, and the bounds animation in the main process. */
export const PANEL_OPEN_MS = 200;

/**
 * Closing is a touch quicker than opening, and quicker than the window takes
 * to shrink: the content is gone before the window edge would reach it.
 */
export const PANEL_CLOSE_MS = 160;

export type PanelPhase = 'compact' | 'expanding' | 'expanded' | 'collapsing';

/**
 * The class for a phase that is passing through.
 *
 * `expanded` and `compact` are the settled states and are already described by
 * `island--expanded`, which says a panel is there at all; only the two moving
 * phases add a class of their own.
 */
export function phaseClass(phase: PanelPhase): string {
  return phase === 'expanding' || phase === 'collapsing' ? `island--${phase}` : '';
}
