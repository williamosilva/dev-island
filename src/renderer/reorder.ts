/**
 * Pure helpers behind dragging script buttons around.
 *
 * The topbar and the "More" panel are two views of one ordered list, so every
 * position here is an index into the **full** list of buttons, never into the
 * visible slice.
 */

/** Move one item to another position, keeping everything else in order. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  const target = Math.max(0, Math.min(to, next.length));
  next.splice(target, 0, moved);
  return next;
}

/** An element that takes part in the gesture. */
export interface ReorderRect {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Rows stack vertically ("More"); buttons sit side by side (topbar). */
  vertical: boolean;
}

/**
 * Apply an order of ids to a list of buttons.
 *
 * Used for the provisional order the renderer holds during a gesture, so it
 * has to be total: an id that is not in the list is ignored, and a button the
 * order does not mention keeps its place at the end. Nothing is ever lost or
 * duplicated, whatever the two sides disagree about.
 */
export function applyOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[] | null,
): readonly T[] {
  if (!order || order.length === 0) return items;
  const remaining = new Map(items.map((item) => [item.id, item]));
  const ordered: T[] = [];
  for (const id of order) {
    const item = remaining.get(id);
    if (!item) continue;
    remaining.delete(id);
    ordered.push(item);
  }
  if (remaining.size === 0) return ordered;
  return [...ordered, ...items.filter((item) => remaining.has(item.id))];
}

/** True when the list is already in exactly that order. */
export function matchesOrder(
  items: readonly { id: string }[],
  order: readonly string[] | null,
): boolean {
  if (!order) return true;
  if (items.length !== order.length) return false;
  return items.every((item, index) => item.id === order[index]);
}
