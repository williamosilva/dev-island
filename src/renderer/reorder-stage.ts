/**
 * The DOM half of the reordering animation.
 *
 * Everything the gesture needs is read once, when it starts, and written back
 * as bare `transform` / `transition` styles — never through React, so a frame
 * of the drag costs no render, no measurement and no window resize.
 */

import { GESTURE_ATTRIBUTE } from './gesture-roles';
import type { FrameStyle } from './reorder-animation';
import type { ReorderRect } from './reorder';

/** The little of an element the animation actually touches. */
export interface StageElement {
  index: number;
  setTransform(transform: string, transition: string): void;
}

/** The box the dragged button leaves behind, relative to its container. */
export interface PlaceholderBox {
  left: number;
  top: number;
  width: number;
  height: number;
  vertical: boolean;
}

export interface Stage {
  rects: ReorderRect[];
  elements: StageElement[];
  /** Natural topbar width of every button, in list order. */
  naturalWidths: number[];
  placeholder: PlaceholderBox | null;
}

const REORDER_SELECTOR = `[${GESTURE_ATTRIBUTE}="reorder"]`;
const MEASURE_SELECTOR = '[data-measure="script"]';

function wrap(element: HTMLElement, index: number): StageElement {
  return {
    index,
    setTransform(transform, transition) {
      // Set the transition first: changing both in one go would otherwise
      // animate from whatever the element carried before.
      element.style.transition = transition;
      element.style.transform = transform;
    },
  };
}

/** Read the geometry of every participating element, once per gesture. */
export function readStage(from: number): Stage {
  const rects: ReorderRect[] = [];
  const elements: StageElement[] = [];
  let placeholder: PlaceholderBox | null = null;

  for (const element of document.querySelectorAll(REORDER_SELECTOR)) {
    if (!(element instanceof HTMLElement)) continue;
    const index = Number(element.dataset.reorderIndex);
    if (!Number.isInteger(index)) continue;
    const box = element.getBoundingClientRect();
    const vertical = element.dataset.reorderAxis === 'vertical';
    rects.push({
      index,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      vertical,
    });
    elements.push(wrap(element, index));

    if (index === from) {
      // The placeholder marks the slot the button keeps in the flow, so it is
      // positioned inside that same container.
      const container = element.parentElement?.getBoundingClientRect() ?? null;
      placeholder = {
        left: box.left - (container?.left ?? 0),
        top: box.top - (container?.top ?? 0),
        width: box.width,
        height: box.height,
        vertical,
      };
    }
  }

  const naturalWidths = [...document.querySelectorAll(MEASURE_SELECTOR)].map((element) =>
    element instanceof HTMLElement ? element.getBoundingClientRect().width : 0,
  );

  return { rects, elements, naturalWidths, placeholder };
}

/** Apply one computed frame to the elements it belongs to. */
export function paint(elements: readonly StageElement[], frame: readonly FrameStyle[]): void {
  const styles = new Map(frame.map((style) => [style.index, style]));
  for (const element of elements) {
    const style = styles.get(element.index);
    if (!style) continue;
    element.setTransform(style.transform, style.transition);
  }
}

/**
 * Drop every temporary style. Called only once the settle (or the animation
 * back) has finished, so nothing visible moves when the real order arrives.
 */
export function clearStage(elements: readonly StageElement[]): void {
  for (const element of elements) {
    element.setTransform('', '');
  }
}

/** True when the user asked the system for less movement. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // No `matchMedia` (or no window): assume the animation is welcome.
    return false;
  }
}
