import type { BoundsDirection } from '../shared/api';

/** A pointer must travel this far before a press counts as a drag. */
export const DRAG_THRESHOLD_PX = 5;

export const DRAGGING_CLASS = 'di-gesturing';

export interface Gesture {
  direction: BoundsDirection;
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  started: boolean;
}

/**
 * Geometry for one direction, always derived from the bounds captured when the
 * gesture started so nothing accumulates rounding error.
 */
export function boundsFor(gesture: Gesture, screenX: number, screenY: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const dx = screenX - gesture.pointerX;
  const dy = screenY - gesture.pointerY;
  const { direction } = gesture;

  if (direction === 'move') {
    return { x: gesture.x + dx, y: gesture.y + dy, width: gesture.width, height: gesture.height };
  }

  const west = direction.includes('w');
  const east = direction.includes('e');
  const north = direction.includes('n');
  const south = direction.includes('s');

  return {
    // A west pull moves the left edge and shrinks by the same amount, which
    // leaves the right edge exactly where it was; the same holds for north.
    x: west ? gesture.x + dx : gesture.x,
    y: north ? gesture.y + dy : gesture.y,
    width: east ? gesture.width + dx : west ? gesture.width - dx : gesture.width,
    height: south ? gesture.height + dy : north ? gesture.height - dy : gesture.height,
  };
}
