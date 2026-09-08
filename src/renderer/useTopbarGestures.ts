import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { ButtonView } from '../shared/types';
import { bridge } from './bridge';
import { boundsFor, DRAGGING_CLASS } from './gesture-geometry';
import { GESTURE_ATTRIBUTE, GESTURE_THRESHOLD_PX, type GestureRole } from './gesture-roles';
import { applyOrder, matchesOrder, moveItem } from './reorder';
import {
  containerMetrics,
  draggedCentre,
  draggedOffset,
  reorderFrame,
  REORDER_DURATION_MS,
  REORDERING_CLASS,
  restingFrame,
  settleOffset,
  targetFor,
  type ContainerMetrics,
  type ReorderTarget,
} from './reorder-animation';
import {
  clearStage,
  paint,
  prefersReducedMotion,
  readStage,
  type PlaceholderBox,
  type Stage,
} from './reorder-stage';

export { GESTURE_ATTRIBUTE, GESTURE_THRESHOLD_PX, type GestureRole };

interface MoveGesture {
  kind: 'move';
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  started: boolean;
}

interface ReorderGesture {
  kind: 'reorder';
  /** Screen for the threshold, client for the geometry. */
  pointerX: number;
  pointerY: number;
  clientX: number;
  clientY: number;
  id: string;
  from: number;
  started: boolean;
  stage: Stage | null;
  metrics: ContainerMetrics;
  target: ReorderTarget;
}

export interface TopbarGestures {
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
  onLostPointerCapture(event: ReactPointerEvent<HTMLElement>): void;
  dragId: string | null;
  placeholder: PlaceholderBox | null;
  /** The real order, or the one the gesture holds until its write lands. */
  buttons: readonly ButtonView[];
  /** Gives up on the gesture without writing anything. */
  cancel(): void;
  /** True only for the click that closes a reorder; cleared on the next press. */
  consumeClick(): boolean;
}

/**
 * One controller for the three gestures the topbar has to tell apart.
 *
 * Which one it is comes from the element under the pointer, never from
 * coordinates: `block` keeps its click, `reorder` drags that button, `free`
 * moves the window. Below the threshold nothing happens at all, so the press
 * is still a click; the rendered order is then held until the write lands, so
 * nothing snaps back in between.
 */
export function useTopbarGestures(
  buttons: readonly ButtonView[],
  onReorder: (orderedIds: string[]) => Promise<boolean>,
): TopbarGestures {
  const gesture = useRef<MoveGesture | ReorderGesture | null>(null);
  const reordered = useRef(false);
  const settle = useRef<{ timer: ReturnType<typeof setTimeout>; done: () => void } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [placeholder, setPlaceholder] = useState<PlaceholderBox | null>(null);
  const [heldOrder, setHeldOrder] = useState<readonly string[] | null>(null);

  const ordered = useMemo(() => applyOrder(buttons, heldOrder), [buttons, heldOrder]);

  // The real order caught up: stop holding one.
  useEffect(() => {
    if (heldOrder && gesture.current === null && matchesOrder(buttons, heldOrder)) {
      setHeldOrder(null);
    }
  }, [buttons, heldOrder]);

  const duration = useCallback(
    () => (prefersReducedMotion() ? 0 : REORDER_DURATION_MS),
    [],
  );

  /** Otherwise the previous timer wipes the styles of the gesture just begun. */
  const flushSettle = useCallback(() => {
    const pending = settle.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    settle.current = null;
    pending.done();
  }, []);

  const clear = useCallback((stage: Stage | null) => {
    if (settle.current !== null) {
      clearTimeout(settle.current.timer);
      settle.current = null;
    }
    if (stage) clearStage(stage.elements);
    document.body.classList.remove(DRAGGING_CLASS, REORDERING_CLASS);
    setDragId(null);
    setPlaceholder(null);
  }, []);

  const afterAnimation = useCallback(
    (_stage: Stage | null, done: () => void) => {
      if (settle.current !== null) clearTimeout(settle.current.timer);
      // Reduced motion: nothing to wait for.
      if (duration() === 0) {
        settle.current = null;
        done();
        return;
      }
      const timer = setTimeout(() => {
        settle.current = null;
        done();
      }, REORDER_DURATION_MS);
      settle.current = { timer, done };
    },
    [duration],
  );

  const cancel = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    if (!current) return;
    if (current.kind !== 'reorder' || !current.started || !current.stage) {
      clear(current.kind === 'reorder' ? current.stage : null);
      setHeldOrder(null);
      return;
    }
    // A click may still be on its way; it must not run the script.
    reordered.current = true;
    const stage = current.stage;
    paint(stage.elements, restingFrame(stage.rects, current.from, duration()));
    afterAnimation(stage, () => {
      clear(stage);
      setHeldOrder(null);
    });
  }, [afterAnimation, clear, duration]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Land the previous gesture first, so the two never fight over the styles.
    flushSettle();
    // A stale suppression must not swallow the click this press will produce.
    reordered.current = false;
    const target = event.target instanceof Element ? event.target : null;
    const marked = target?.closest(`[${GESTURE_ATTRIBUTE}]`);
    const role = marked?.getAttribute(GESTURE_ATTRIBUTE) as GestureRole | undefined;
    if (!role || role === 'block') return;

    // No `preventDefault` and no capture yet: both suppress or redirect the
    // compatibility mouse events, costing the buttons their click and the grip
    // its double click. They are taken past the threshold instead.
    if (role === 'reorder' && marked instanceof HTMLElement) {
      const id = marked.dataset.reorderId;
      const from = Number(marked.dataset.reorderIndex);
      if (!id || !Number.isInteger(from)) return;
      gesture.current = {
        kind: 'reorder',
        pointerX: event.screenX,
        pointerY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        id,
        from,
        started: false,
        stage: null,
        metrics: { horizontal: 0, vertical: 0 },
        target: { to: from, slot: 0, vertical: false },
      };
      return;
    }

    gesture.current = {
      kind: 'move',
      pointerX: event.screenX,
      pointerY: event.screenY,
      x: window.screenX,
      y: window.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
      started: false,
    };
    },
    [flushSettle],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (!current) return;

      if (!current.started) {
        const travelled =
          Math.abs(event.screenX - current.pointerX) + Math.abs(event.screenY - current.pointerY);
        if (travelled < GESTURE_THRESHOLD_PX) return;
        current.started = true;
        // Own the pointer, so it keeps arriving outside the topbar.
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* capture is an optimisation; the gesture still works without it */
        }
        if (current.kind === 'reorder') {
          const stage = readStage(current.from);
          current.stage = stage;
          current.metrics = containerMetrics(
            stage.rects,
            current.from,
            stage.naturalWidths[current.from] ?? 0,
          );
          document.body.classList.add(REORDERING_CLASS);
          // An update arriving mid-gesture must not reshuffle the bar.
          setHeldOrder(ordered.map((button) => button.id));
          setDragId(current.id);
          setPlaceholder(stage.placeholder);
        } else {
          document.body.classList.add(DRAGGING_CLASS);
        }
      }

      if (current.kind === 'move') {
        bridge.setManualBounds(
          boundsFor({ ...current, direction: 'move' }, event.screenX, event.screenY),
          'move',
        );
        return;
      }

      const stage = current.stage;
      if (!stage) return;
      const dragged = stage.rects.find((rect) => rect.index === current.from);
      if (!dragged) return;

      const offset = draggedOffset(
        { x: current.clientX, y: current.clientY },
        { x: event.clientX, y: event.clientY },
        dragged,
      );
      current.target = targetFor(stage.rects, current.from, draggedCentre(dragged, offset));
      paint(
        stage.elements,
        reorderFrame({
          rects: stage.rects,
          from: current.from,
          target: current.target,
          fromVertical: dragged.vertical,
          metrics: current.metrics,
          dragged: offset,
          duration: duration(),
          phase: 'dragging',
        }),
      );
    },
    [duration, ordered],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = gesture.current;
      gesture.current = null;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        /* nothing to release */
      }
      if (!current) return;

      if (!current.started) {
        clear(null);
        return;
      }

      if (current.kind === 'move') {
        clear(null);
        bridge.commitBounds();
        return;
      }

      reordered.current = true;
      const stage = current.stage;
      const dragged = stage?.rects.find((rect) => rect.index === current.from) ?? null;
      if (!stage || !dragged) {
        clear(stage);
        setHeldOrder(null);
        return;
      }

      const ids = ordered.map((button) => button.id);
      const moved = current.target.to !== current.from;
      const next = moved ? moveItem(ids, current.from, current.target.to) : ids;

      const context = {
        rects: stage.rects,
        from: current.from,
        target: current.target,
        fromVertical: dragged.vertical,
        metrics: current.metrics,
      };
      paint(
        stage.elements,
        reorderFrame({
          ...context,
          dragged: settleOffset(stage.rects, context),
          duration: duration(),
          phase: 'settling',
        }),
      );

      // A single write, at the end of the gesture.
      if (moved) {
        void onReorder([...next]).then((saved) => {
          // On failure the previous order shows, every button still present.
          if (!saved) setHeldOrder(null);
        });
      }

      afterAnimation(stage, () => {
        // Styles and order swap in the same frame, so nothing moves twice.
        clear(stage);
        setHeldOrder(moved ? [...next] : null);
      });
    },
    [afterAnimation, clear, duration, onReorder, ordered],
  );

  const onLostPointerCapture = useCallback(() => {
    // A release of our own already went through `finish`.
    if (gesture.current?.started) cancel();
  }, [cancel]);

  useEffect(() => {
    if (dragId === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancel, dragId]);

  // A pending settle would touch a DOM that is already gone.
  useEffect(
    () => () => {
      if (settle.current !== null) clearTimeout(settle.current.timer);
    },
    [],
  );

  const consumeClick = useCallback(() => {
    const was = reordered.current;
    reordered.current = false;
    return was;
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: cancel,
    onLostPointerCapture,
    dragId,
    placeholder,
    buttons: ordered,
    cancel,
    consumeClick,
  };
}
