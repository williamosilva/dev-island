/**
 * The maths behind the reordering animation.
 *
 * Every frame is a pure function of a geometry snapshot taken when the gesture
 * starts, applied through `transform` only, so no frame reflows the bar or
 * resizes the window. The dragged button keeps its slot and the neighbours
 * slide by exactly its extent, which moves the empty slot to the target.
 */

import type { ReorderRect } from './reorder';

export const REORDER_DURATION_MS = 150;
export const REORDER_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
export const REORDERING_CLASS = 'di-reordering';

export interface Offset {
  x: number;
  y: number;
}

export const NO_OFFSET: Offset = { x: 0, y: 0 };

/** `to` is a `moveItem` index; `slot` is the position inside the container. */
export interface ReorderTarget {
  to: number;
  slot: number;
  vertical: boolean;
}

/** Space one item takes per axis, gap included. */
export interface ContainerMetrics {
  horizontal: number;
  vertical: number;
}

export function transformFor(offset: Offset): string {
  // `translate3d` keeps the movement on the compositor.
  return `translate3d(${round(offset.x)}px, ${round(offset.y)}px, 0)`;
}

export function transitionFor(duration: number): string {
  return duration > 0 ? `transform ${duration}ms ${REORDER_EASING}` : 'none';
}

function round(value: number): number {
  // Sub-pixel transforms blur text; whole pixels keep the label crisp.
  return Math.round(value);
}

function size(rect: ReorderRect): number {
  return rect.vertical ? rect.height : rect.width;
}

function start(rect: ReorderRect): number {
  return rect.vertical ? rect.top : rect.left;
}

function centreOf(rect: ReorderRect): number {
  return start(rect) + size(rect) / 2;
}

function containerOf(rects: readonly ReorderRect[], vertical: boolean): ReorderRect[] {
  return rects.filter((rect) => rect.vertical === vertical).sort((a, b) => a.index - b.index);
}

/** Measured rather than assumed, so no gap constant has to be kept in step. */
export function gapOf(rects: readonly ReorderRect[], vertical: boolean): number {
  const container = containerOf(rects, vertical);
  for (let index = 1; index < container.length; index += 1) {
    const previous = container[index - 1]!;
    const current = container[index]!;
    const gap = start(current) - (start(previous) + size(previous));
    if (gap >= 0) return gap;
  }
  return 0;
}

/**
 * A row dragged out of "Mais" is as wide as the panel, so the space it will
 * need on the bar comes from the measured natural width instead.
 */
export function containerMetrics(
  rects: readonly ReorderRect[],
  from: number,
  naturalWidth: number,
): ContainerMetrics {
  const dragged = rects.find((rect) => rect.index === from) ?? null;
  const rows = containerOf(rects, true);
  const rowHeight = dragged?.vertical ? dragged.height : (rows[0]?.height ?? 0);
  const barWidth = dragged && !dragged.vertical ? dragged.width : naturalWidth;
  return {
    horizontal: barWidth + gapOf(rects, false),
    vertical: rowHeight + gapOf(rects, true),
  };
}

/**
 * A bar button is pinned vertically until the pointer leaves the row, so the
 * wobble of a hand cannot drop it into the panel. The travel grows from zero
 * at the edge, so nothing jumps on the way out.
 */
export function draggedOffset(
  press: Offset,
  pointer: Offset,
  dragged: ReorderRect,
): Offset {
  if (dragged.vertical) {
    return { x: pointer.x - press.x, y: pointer.y - press.y };
  }
  return {
    x: pointer.x - press.x,
    y: past(pointer.y, dragged.top, dragged.top + dragged.height),
  };
}

/** How far a value lies outside a band; zero while it is inside. */
function past(value: number, min: number, max: number): number {
  if (value < min) return value - min;
  if (value > max) return value - max;
  return 0;
}

export function draggedCentre(dragged: ReorderRect, offset: Offset): Offset {
  return {
    x: dragged.left + dragged.width / 2 + offset.x,
    y: dragged.top + dragged.height / 2 + offset.y,
  };
}

/** Squared, so nothing takes a root just to compare. Zero inside the rect. */
function distanceTo(rect: ReorderRect, point: Offset): number {
  const dx = Math.max(rect.left - point.x, 0, point.x - (rect.left + rect.width));
  const dy = Math.max(rect.top - point.y, 0, point.y - (rect.top + rect.height));
  return dx * dx + dy * dy;
}

/**
 * Decided by the dragged centre crossing a neighbour's original centre. Since
 * a neighbour that gave way has slid a full item out of the way, the swap has
 * hysteresis and cannot flicker around the threshold.
 */
export function targetFor(
  rects: readonly ReorderRect[],
  from: number,
  centre: Offset,
): ReorderTarget {
  const dragged = rects.find((rect) => rect.index === from) ?? null;
  if (!dragged) return { to: from, slot: 0, vertical: false };

  // Nearest container, so a pointer just above the bar still counts as on it.
  let nearest = dragged;
  let best = Number.POSITIVE_INFINITY;
  for (const rect of rects) {
    const distance = distanceTo(rect, centre);
    if (distance < best) {
      best = distance;
      nearest = rect;
    }
  }

  const container = containerOf(rects, nearest.vertical);
  const others = container.filter((rect) => rect.index !== from);
  const axis = nearest.vertical ? centre.y : centre.x;
  const slot = others.filter((rect) => centreOf(rect) < axis).length;

  // `moveItem` indexes the list without the dragged item.
  const first = container[0]?.index ?? 0;
  const base = from < first ? first - 1 : first;
  return { to: base + slot, slot, vertical: nearest.vertical };
}

export interface ShiftContext {
  from: number;
  target: ReorderTarget;
  fromVertical: boolean;
  metrics: ContainerMetrics;
}

function withoutDragged(index: number, from: number): number {
  return index > from ? index - 1 : index;
}

export function shiftOf(rect: ReorderRect, context: ShiftContext): Offset {
  if (rect.index === context.from) return NO_OFFSET;
  const { from, target, fromVertical, metrics } = context;
  const extent = rect.vertical ? metrics.vertical : metrics.horizontal;

  if (fromVertical === target.vertical) {
    // One container: everything else stays exactly where it is.
    if (rect.vertical !== fromVertical) return NO_OFFSET;
    const forwards = target.to > from && rect.index > from && rect.index <= target.to;
    const backwards = target.to < from && rect.index >= target.to && rect.index < from;
    if (forwards) return along(rect.vertical, -extent);
    if (backwards) return along(rect.vertical, extent);
    return NO_OFFSET;
  }

  if (rect.vertical === fromVertical) {
    // The container the item is leaving: close the hole behind it.
    return rect.index > from ? along(rect.vertical, -extent) : NO_OFFSET;
  }

  // The container it is heading for: open the destination slot.
  return withoutDragged(rect.index, from) >= target.to
    ? along(rect.vertical, extent)
    : NO_OFFSET;
}

function along(vertical: boolean, amount: number): Offset {
  return vertical ? { x: 0, y: amount } : { x: amount, y: 0 };
}

/**
 * Lands exactly where the button will be once the real order arrives, so
 * clearing the temporary transforms changes nothing visible.
 */
export function settleOffset(
  rects: readonly ReorderRect[],
  context: ShiftContext,
): Offset {
  const dragged = rects.find((rect) => rect.index === context.from) ?? null;
  if (!dragged) return NO_OFFSET;

  const vertical = context.target.vertical;
  const container = containerOf(rects, vertical).filter((rect) => rect.index !== context.from);
  const first = containerOf(rects, vertical)[0];
  if (!first) return NO_OFFSET;

  const gap = gapOf(rects, vertical);
  const slot = Math.max(0, Math.min(context.target.slot, container.length));

  // Each item's real size, so the landing point is exact rather than estimated.
  let position = start(first);
  for (let index = 0; index < slot; index += 1) {
    const rect = container[index];
    if (!rect) break;
    position += size(rect) + gap;
  }

  const main = position - start(dragged);
  const cross = vertical
    ? first.left - dragged.left
    : first.top - dragged.top;
  return vertical ? { x: cross, y: main } : { x: main, y: cross };
}

export interface FrameStyle {
  index: number;
  transform: string;
  transition: string;
  dragged: boolean;
}

export interface FrameInput {
  rects: readonly ReorderRect[];
  from: number;
  target: ReorderTarget;
  fromVertical: boolean;
  metrics: ContainerMetrics;
  dragged: Offset;
  /** Zero disables every transition, for `prefers-reduced-motion`. */
  duration: number;
  /** While `dragging` the grabbed button has no transition, so it cannot lag. */
  phase: 'dragging' | 'settling';
}

export function reorderFrame(input: FrameInput): FrameStyle[] {
  const context: ShiftContext = {
    from: input.from,
    target: input.target,
    fromVertical: input.fromVertical,
    metrics: input.metrics,
  };
  const neighbours = transitionFor(input.duration);
  return input.rects.map((rect) => {
    if (rect.index === input.from) {
      return {
        index: rect.index,
        transform: transformFor(input.dragged),
        transition: input.phase === 'settling' ? neighbours : 'none',
        dragged: true,
      };
    }
    return {
      index: rect.index,
      transform: transformFor(shiftOf(rect, context)),
      transition: neighbours,
      dragged: false,
    };
  });
}

export function restingFrame(
  rects: readonly ReorderRect[],
  from: number,
  duration: number,
): FrameStyle[] {
  const transition = transitionFor(duration);
  return rects.map((rect) => ({
    index: rect.index,
    transform: transformFor(NO_OFFSET),
    transition,
    dragged: rect.index === from,
  }));
}
