import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import type { BoundsDirection } from '../shared/api';
import { bridge } from './bridge';
import { boundsFor, DRAG_THRESHOLD_PX, DRAGGING_CLASS, type Gesture } from './gesture-geometry';

export { boundsFor, DRAG_THRESHOLD_PX, DRAGGING_CLASS };

export interface GestureHandlers {
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
}

/**
 * Drives moving and resizing the window from the renderer.
 *
 * The window is frameless and transparent, so Windows offers neither usable
 * resize borders nor — since `-webkit-app-region: drag` turns an element into a
 * non-client area and drops the CSS cursor — a draggable title bar we can
 * style. Both gestures are therefore explicit: pointer capture keeps the events
 * coming, screen-space deltas describe the intent, and the main process clamps
 * and applies the bounds.
 */
export function useWindowGesture(direction: BoundsDirection, onClickWithoutDrag?: () => void): GestureHandlers {
  const gesture = useRef<Gesture | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is an optimisation; the gesture still works without it.
      }
      gesture.current = {
        direction,
        pointerX: event.screenX,
        pointerY: event.screenY,
        x: window.screenX,
        y: window.screenY,
        width: window.innerWidth,
        height: window.innerHeight,
        started: false,
      };
    },
    [direction],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current) return;

    if (!current.started) {
      const travelled =
        Math.abs(event.screenX - current.pointerX) + Math.abs(event.screenY - current.pointerY);
      if (travelled < DRAG_THRESHOLD_PX) return;
      current.started = true;
      // Keeps the grabbing cursor even when the pointer leaves the grip.
      document.body.classList.add(DRAGGING_CLASS);
    }

    bridge.setManualBounds(boundsFor(current, event.screenX, event.screenY), current.direction);
  }, []);

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = gesture.current;
      gesture.current = null;
      document.body.classList.remove(DRAGGING_CLASS);
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Nothing to release.
      }
      if (!current) return;
      // A press that never moved is a click, not a drag.
      if (current.started) bridge.commitBounds();
      else onClickWithoutDrag?.();
    },
    [onClickWithoutDrag],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
  };
}
