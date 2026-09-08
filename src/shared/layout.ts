/**
 * Layout constants both processes need.
 *
 * They live in the shared layer so the fit algorithm (renderer), the window
 * geometry (main) and the stylesheet all work from the same number.
 */

import type { LayoutLimits } from './types';

/**
 * Free strip kept before the separator and the fixed controls, so the topbar
 * always offers somewhere comfortable to grab and move the window.
 *
 * It is reserved *before* deciding how many scripts fit: given the choice
 * between one more button and this strip, the strip wins and the button goes
 * to `Mais (N)`.
 */
export const MIN_FREE_DRAG_WIDTH = 28;

/** CSS custom property the renderer publishes it under. */
export const FREE_DRAG_WIDTH_VARIABLE = '--di-free-drag-width';

/**
 * What both sides assume until a window has been measured.
 *
 * The main process replaces it as soon as there is a placement; the renderer
 * draws its first frame with it. The values are the ceilings `window-geometry`
 * applies, kept in step by a test.
 */
export const DEFAULT_LAYOUT_LIMITS: LayoutLimits = {
  sizeMode: 'auto',
  maxWidth: 900,
  maxHeight: 760,
  panelHeight: 320,
};
