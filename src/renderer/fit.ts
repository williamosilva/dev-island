/**
 * How many script buttons fit on the compact bar.
 *
 * Only the scripts are elastic: the fixed controls and the free drag strip
 * come out of the budget first, so neither can be pushed out of the window.
 * Every width is measured from the rendered elements, so the result follows
 * the script names and the Windows display scale.
 */
import { MIN_FREE_DRAG_WIDTH } from '../shared/layout';

export { MIN_FREE_DRAG_WIDTH };

/** Must match `--di-gap` in styles.css. */
export const BAR_GAP = 4;

/**
 * Padding, border, separator and the gutter the resize handle sits in.
 * Slightly generous, so a rounding difference never causes a cut.
 */
export const BAR_CHROME = 44;

/** Every width is measured from the rendered elements. */
export interface FitInput {
  maxWidth: number;
  projectWidth: number;
  controlsWidth: number;
  moreWidth: number;
  buttonWidths: readonly number[];
  gap: number;
  chrome: number;
}

export interface FitResult {
  visibleCount: number;
  hiddenCount: number;
}

function totalWidth(widths: readonly number[], count: number, gap: number): number {
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    total += (widths[index] ?? 0) + gap;
  }
  return total;
}

export function fitButtons(input: FitInput): FitResult {
  const count = input.buttonWidths.length;
  if (count === 0) return { visibleCount: 0, hiddenCount: 0 };

  // Before the first measurement every width is zero: show everything rather
  // than flash an empty bar.
  if (input.maxWidth <= 0 || input.buttonWidths.every((width) => width <= 0)) {
    return { visibleCount: count, hiddenCount: 0 };
  }

  // The strip comes out first: the scripts may not eat into it.
  const budget =
    input.maxWidth -
    input.chrome -
    input.projectWidth -
    input.controlsWidth -
    MIN_FREE_DRAG_WIDTH;

  if (totalWidth(input.buttonWidths, count, input.gap) <= budget) {
    return { visibleCount: count, hiddenCount: 0 };
  }

  // Something has to go into "More (N)", so that button now costs space too.
  const reduced = budget - input.moreWidth - input.gap;
  let used = 0;
  let visibleCount = 0;
  for (let index = 0; index < count; index += 1) {
    const next = used + (input.buttonWidths[index] ?? 0) + input.gap;
    if (next > reduced) break;
    used = next;
    visibleCount += 1;
  }

  return { visibleCount, hiddenCount: count - visibleCount };
}

/**
 * The one source of truth for the window width. It describes the compact bar
 * and nothing else, so an expanded panel only ever changes the height.
 */
export function barWidth(input: FitInput, result: FitResult): number {
  let width =
    input.chrome + input.projectWidth + input.controlsWidth + MIN_FREE_DRAG_WIDTH;
  for (let index = 0; index < result.visibleCount; index += 1) {
    width += (input.buttonWidths[index] ?? 0) + input.gap;
  }
  if (result.hiddenCount > 0) width += input.moreWidth + input.gap;
  return Math.min(Math.ceil(width), input.maxWidth);
}

export function splitButtons<T>(items: readonly T[], visibleCount: number): { visible: T[]; hidden: T[] } {
  const safe = Math.max(0, Math.min(visibleCount, items.length));
  return { visible: items.slice(0, safe), hidden: items.slice(safe) };
}
