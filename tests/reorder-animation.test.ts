import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { applyOrder, matchesOrder, moveItem, type ReorderRect } from '../src/renderer/reorder';
import {
  containerMetrics,
  draggedCentre,
  draggedOffset,
  gapOf,
  reorderFrame,
  REORDER_DURATION_MS,
  REORDER_EASING,
  REORDERING_CLASS,
  restingFrame,
  settleOffset,
  shiftOf,
  targetFor,
  transformFor,
  transitionFor,
  type Offset,
  type ShiftContext,
} from '../src/renderer/reorder-animation';
import { paint, type StageElement } from '../src/renderer/reorder-stage';
import { GESTURE_THRESHOLD_PX } from '../src/renderer/gesture-roles';
import { ReorderPlaceholder } from '../src/renderer/components/ReorderPlaceholder';
import type { ButtonView } from '../src/shared/types';

/**
 * The reordering animation: the buttons themselves change places.
 *
 * The geometry here has the shape a real topbar has — buttons of different
 * widths, 4px apart — because the whole point of the animation is that a
 * neighbour slides by exactly the space the carried button occupies.
 */
const WIDTHS = [60, 100, 40, 80];

/** Buttons side by side on the topbar, 4px apart, 30px tall. */
function topbar(widths: readonly number[] = WIDTHS, top = 10): ReorderRect[] {
  const rects: ReorderRect[] = [];
  let left = 0;
  widths.forEach((width, index) => {
    rects.push({ index, left, top, width, height: 30, vertical: false });
    left += width + 4;
  });
  return rects;
}

/** Rows stacked in the "Mais" panel, 2px apart, 40px tall. */
function rows(count: number, offset = 0, top = 200): ReorderRect[] {
  return Array.from({ length: count }, (_unused, index) => ({
    index: offset + index,
    left: 0,
    top: top + index * 42,
    width: 400,
    height: 40,
    vertical: true,
  }));
}

const CSS = readFileSync('src/renderer/styles.css', 'utf8');
const CONTROLLER = readFileSync('src/renderer/useTopbarGestures.ts', 'utf8');
const APP = readFileSync('src/renderer/App.tsx', 'utf8');
const BAR = readFileSync('src/renderer/components/CompactBar.tsx', 'utf8');
const MORE = readFileSync('src/renderer/components/MorePanel.tsx', 'utf8');

/** A source file without its comments, so prose cannot satisfy a rule. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function rule(selector: string): string {
  const start = CSS.indexOf(selector + ' {');
  expect(start, selector).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf('}', start));
}

/** The body of the controller between two of its declarations. */
function section(from: string, to: string): string {
  const bare = code(CONTROLLER);
  const start = bare.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = bare.indexOf(to, start);
  return bare.slice(start, end === -1 ? bare.length : end);
}

/** The grouped rule that lifts whichever element is being carried. */
function liftRule(): string {
  const start = CSS.indexOf('.action--dragging,');
  expect(start).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf('}', start));
}

/** The block of the gesturing rule, where the cursor is forced. */
function gesturingRule(): string {
  const start = CSS.indexOf('body.di-gesturing');
  return CSS.slice(start, CSS.indexOf('}', start));
}

/** Elements that only remember what was written to them. */
function stageElements(rects: readonly ReorderRect[]): {
  elements: StageElement[];
  written: Map<number, { transform: string; transition: string }>;
} {
  const written = new Map<number, { transform: string; transition: string }>();
  const elements = rects.map((rect) => ({
    index: rect.index,
    setTransform(transform: string, transition: string) {
      written.set(rect.index, { transform, transition });
    },
  }));
  return { elements, written };
}

function context(
  rects: readonly ReorderRect[],
  from: number,
  centre: Offset,
  naturalWidth = 0,
): ShiftContext {
  const dragged = rects.find((rect) => rect.index === from)!;
  return {
    from,
    target: targetFor(rects, from, centre),
    fromVertical: dragged.vertical,
    metrics: containerMetrics(rects, from, naturalWidth),
  };
}

/** Where a button sits after a frame is applied. */
function positionAfter(
  rects: readonly ReorderRect[],
  written: Map<number, { transform: string; transition: string }>,
  index: number,
): Offset {
  const rect = rects.find((candidate) => candidate.index === index)!;
  const match = /translate3d\((-?\d+)px, (-?\d+)px, 0\)/.exec(written.get(index)!.transform)!;
  return { x: rect.left + Number(match[1]), y: rect.top + Number(match[2]) };
}

const button = (id: string, status: ButtonView['status'] = 'idle'): ButtonView => ({
  id,
  name: id,
  script: `npm run ${id}`,
  custom: false,
  status,
  exitCode: null,
});

describe('a button at rest is something you click', () => {
  it('a script button reads pointer, not grab', () => {
    expect(rule('.action--script')).toContain('cursor: pointer');
    expect(rule('.action--script')).not.toContain('cursor: grab');
  });

  it('a row of "Mais" reads pointer as well', () => {
    expect(rule('.more__item')).toContain('cursor: pointer');
    expect(rule('.more__item')).not.toContain('cursor: grab');
  });

  it('the surfaces that only move the window keep grab', () => {
    expect(rule('.bar')).toContain('cursor: grab');
    expect(rule('.grip')).toContain('cursor: grab');
  });
});

describe('the cursor follows the phases of the press', () => {
  it('nothing at all happens below the threshold', () => {
    const move = section('const onPointerMove', 'const finish');
    const guard = move.indexOf('if (travelled < GESTURE_THRESHOLD_PX) return;');
    expect(guard).toBeGreaterThan(-1);
    // Below the guard the press is still nothing but a click.
    for (const effect of ['REORDERING_CLASS', 'setPointerCapture', 'readStage', 'paint(', 'setDragId']) {
      expect(move.indexOf(effect), effect).toBeGreaterThan(guard);
    }
    const down = section('const onPointerDown', 'const onPointerMove');
    for (const effect of ['setPointerCapture', 'classList', 'readStage', 'paint(', 'preventDefault']) {
      expect(down, effect).not.toContain(effect);
    }
    expect(GESTURE_THRESHOLD_PX).toBe(5);
  });

  it('crossing the threshold turns the cursor into the closed hand', () => {
    expect(section('const onPointerMove', 'const finish')).toContain(
      'document.body.classList.add(REORDERING_CLASS)',
    );
    expect(gesturingRule()).toContain(`body.${REORDERING_CLASS}`);
    expect(gesturingRule()).toContain('cursor: grabbing !important');
  });

  it('it stays closed off the element and outside the window', () => {
    // Every descendant, so the hand cannot flicker crossing another control.
    expect(gesturingRule()).toContain(`body.${REORDERING_CLASS} *`);
    expect(section('const onPointerMove', 'const finish')).toContain('setPointerCapture');
  });

  it('every way a gesture can end takes the class off again', () => {
    const clear = section('const clear = useCallback', 'const afterAnimation');
    expect(clear).toContain('classList.remove(DRAGGING_CLASS, REORDERING_CLASS)');
    // Release, cancel and Escape all go through it.
    expect(section('const cancel = useCallback', 'const onPointerDown')).toContain('clear(');
    expect(section('const finish = useCallback', 'const onLostPointerCapture')).toContain('clear(');
  });
});

describe('a click is still a click', () => {
  it('a plain click runs the script exactly once', () => {
    const finish = section('const finish = useCallback', 'const onLostPointerCapture');
    expect(finish).toContain('if (!current.started) {');
    const beforeStarted = finish.slice(0, finish.indexOf('reordered.current = true;'));
    expect(beforeStarted).toContain('clear(null);');
    expect(beforeStarted).not.toContain('onReorder(');
    expect(BAR).toContain('onClick={() => onOpen(button)}');
    expect(MORE).toContain('onClick={() => onOpen(button)}');
  });

  it('movement under the threshold is still that click', () => {
    expect(GESTURE_THRESHOLD_PX).toBeGreaterThanOrEqual(4);
    expect(GESTURE_THRESHOLD_PX).toBeLessThanOrEqual(6);
    const move = section('const onPointerMove', 'const finish');
    // Measured from the press, not accumulated frame by frame.
    expect(move).toContain('Math.abs(event.screenX - current.pointerX)');
    expect(move).toContain('if (travelled < GESTURE_THRESHOLD_PX) return;');
  });
});

describe('the carried button follows the pointer', () => {
  it('follows the pointer delta along the bar', () => {
    const rects = topbar();
    const press = { x: 30, y: 25 };
    for (const delta of [1, 17, 120, -45]) {
      const offset = draggedOffset(press, { x: press.x + delta, y: press.y }, rects[1]!);
      expect(offset.x).toBe(delta);
      // Still on the bar: no vertical drift at all.
      expect(offset.y).toBe(0);
    }
  });

  it('follows a row on both axes, so it can be aimed at the bar', () => {
    const rects = rows(3, 0);
    const press = { x: 200, y: 210 };
    const offset = draggedOffset(press, { x: 260, y: 260 }, rects[0]!);
    expect(offset.y).toBe(50);
    // A row leaves the panel upwards, so the horizontal has to follow too or
    // the position it lands in on the bar could not be chosen.
    expect(offset.x).toBe(60);
  });

  it('starts following the other axis only once the pointer leaves', () => {
    const rects = topbar();
    const press = { x: 30, y: 25 };
    // The bar's band is 10..40; leaving it below starts the vertical travel
    // from zero, so the button never jumps as it crosses the edge.
    expect(draggedOffset(press, { x: 30, y: 40 }, rects[1]!).y).toBe(0);
    expect(draggedOffset(press, { x: 30, y: 41 }, rects[1]!).y).toBe(1);
    expect(draggedOffset(press, { x: 30, y: 90 }, rects[1]!).y).toBe(50);
  });

  it('moves by transform only, so no frame can reflow the bar', () => {
    const rects = topbar();
    const frame = reorderFrame({
      ...context(rects, 0, { x: 30, y: 25 }),
      rects,
      dragged: { x: 12, y: 0 },
      duration: REORDER_DURATION_MS,
      phase: 'dragging',
    });
    for (const style of frame) {
      expect(style.transform).toMatch(/^translate3d\(-?\d+px, -?\d+px, 0\)$/);
      expect(style.transition === 'none' || style.transition.startsWith('transform ')).toBe(true);
    }
    expect(transformFor({ x: 8, y: -3 })).toBe('translate3d(8px, -3px, 0)');
  });

  it('is the only element with no transition while it is being carried', () => {
    const rects = topbar();
    const frame = reorderFrame({
      ...context(rects, 1, { x: 200, y: 25 }),
      rects,
      dragged: { x: 90, y: 0 },
      duration: REORDER_DURATION_MS,
      phase: 'dragging',
    });
    const dragged = frame.find((style) => style.dragged)!;
    expect(dragged.index).toBe(1);
    expect(dragged.transition).toBe('none');
    for (const style of frame.filter((candidate) => !candidate.dragged)) {
      expect(style.transition).toBe(`transform ${REORDER_DURATION_MS}ms ${REORDER_EASING}`);
    }
  });
});

describe('the slot it came from keeps its size', () => {
  it('the placeholder has exactly the width and height of the button', () => {
    const box = { left: 64, top: 6, width: 100, height: 30, vertical: false };
    const style = ReorderPlaceholder({ box }).props.style as Record<string, string>;
    expect(style.width).toBe('100px');
    expect(style.height).toBe('30px');
    expect(style.left).toBe('64px');
    expect(style.top).toBe('6px');
  });

  it('and it is out of flow and inert, so it measures nothing', () => {
    expect(rule('.reorder-slot')).toContain('position: absolute');
    expect(rule('.reorder-slot')).toContain('pointer-events: none');
    expect(rule('.reorder-slot')).toContain('box-sizing: border-box');
    expect(rule('.bar__scripts')).toContain('position: relative');
    expect(rule('.more')).toContain('position: relative');
  });

  it('the space itself is held by the button, which never leaves the flow', () => {
    expect(liftRule()).toContain('position: relative');
    expect(liftRule()).not.toContain('position: absolute');
    expect(liftRule()).not.toContain('position: fixed');
    expect(code(BAR)).toContain('<ReorderPlaceholder box={placeholder} />');
    expect(code(MORE)).toContain('<ReorderPlaceholder box={placeholder} />');
  });

  it('is lifted discreetly: a shadow and a stacking order, nothing else', () => {
    const lift = liftRule();
    expect(lift).toContain('box-shadow');
    expect(Number(/z-index: (\d+)/.exec(lift)?.[1])).toBeGreaterThan(0);
    expect(lift).not.toContain('opacity');
    expect(lift).not.toContain('scale');
    expect(lift).not.toContain('rotate');
  });
});

describe('the neighbours open and close the space', () => {
  it('crossing a neighbour centre changes the provisional order', () => {
    const rects = topbar();
    // Button 0 grabbed. Centres: 30, 114, 190, 234.
    expect(targetFor(rects, 0, { x: 113, y: 25 }).to).toBe(0);
    expect(targetFor(rects, 0, { x: 115, y: 25 }).to).toBe(1);
    expect(targetFor(rects, 0, { x: 191, y: 25 }).to).toBe(2);
  });

  it('the neighbour slides by exactly the space the button occupied', () => {
    const rects = topbar();
    const { elements, written } = stageElements(rects);
    // Button 0 (60px wide) carried past button 1: that one has to come back
    // by 64px, the button plus the 4px gap.
    const ctx = context(rects, 0, { x: 115, y: 25 });
    paint(
      elements,
      reorderFrame({ ...ctx, rects, dragged: { x: 85, y: 0 }, duration: REORDER_DURATION_MS, phase: 'dragging' }),
    );
    expect(written.get(1)).toEqual({
      transform: 'translate3d(-64px, 0px, 0)',
      transition: `transform ${REORDER_DURATION_MS}ms ${REORDER_EASING}`,
    });
    expect(written.get(2)!.transform).toBe('translate3d(0px, 0px, 0)');
    expect(written.get(3)!.transform).toBe('translate3d(0px, 0px, 0)');
    expect(gapOf(rects, false)).toBe(4);
    expect(ctx.metrics.horizontal).toBe(64);
  });

  it('the neighbour ends up exactly where the carried button was', () => {
    const rects = topbar();
    const { elements, written } = stageElements(rects);
    paint(
      elements,
      reorderFrame({
        ...context(rects, 0, { x: 115, y: 25 }),
        rects,
        dragged: { x: 85, y: 0 },
        duration: REORDER_DURATION_MS,
        phase: 'dragging',
      }),
    );
    // Button 1 slides into button 0's slot: same left edge, same row.
    expect(positionAfter(rects, written, 1)).toEqual({ x: rects[0]!.left, y: rects[0]!.top });
  });

  it('bringing the pointer back puts everyone back', () => {
    const rects = topbar();
    const { elements, written } = stageElements(rects);
    const forward = context(rects, 0, { x: 115, y: 25 });
    paint(
      elements,
      reorderFrame({ ...forward, rects, dragged: { x: 85, y: 0 }, duration: REORDER_DURATION_MS, phase: 'dragging' }),
    );
    expect(written.get(1)!.transform).toBe('translate3d(-64px, 0px, 0)');

    const back = context(rects, 0, { x: 113, y: 25 });
    expect(back.target.to).toBe(0);
    paint(
      elements,
      reorderFrame({ ...back, rects, dragged: { x: 83, y: 0 }, duration: REORDER_DURATION_MS, phase: 'dragging' }),
    );
    expect(written.get(1)).toEqual({
      transform: 'translate3d(0px, 0px, 0)',
      transition: `transform ${REORDER_DURATION_MS}ms ${REORDER_EASING}`,
    });
  });

  it('a whole run of neighbours shifts, each by one slot', () => {
    const rects = topbar([60, 60, 60, 60]);
    const ctx = context(rects, 3, { x: 30, y: 25 });
    expect(ctx.target.to).toBe(0);
    for (const index of [0, 1, 2]) {
      // Dragged to the front: everything it passed moves one slot right.
      expect(shiftOf(rects[index]!, ctx)).toEqual({ x: 64, y: 0 });
    }
    expect(shiftOf(rects[3]!, ctx)).toEqual({ x: 0, y: 0 });
  });

  it('the settle lands the button exactly where its slot will be', () => {
    const rects = topbar();
    const ctx = context(rects, 0, { x: 191, y: 25 });
    expect(ctx.target.to).toBe(2);
    const offset = settleOffset(rects, ctx);
    // Slot 2 after the move: buttons 1 (100) and 2 (40) come first.
    expect(offset).toEqual({ x: 100 + 4 + 40 + 4, y: 0 });
    // Which is exactly the space the neighbours' slide leaves empty: button 2
    // has come back 64px, so the gap after it starts there.
    const settled = rects[0]!.left + offset.x;
    expect(settled).toBe(rects[2]!.left + rects[2]!.width - ctx.metrics.horizontal + 4);
    // And the button that follows has not moved, so the slot is 60px wide.
    expect(rects[3]!.left - settled).toBe(60 + 4);
  });
});

describe('the order is written once, or not at all', () => {
  it('a valid release writes exactly once', () => {
    const finish = section('const finish = useCallback', 'const onLostPointerCapture');
    expect(finish.match(/onReorder\(/g)).toHaveLength(1);
    expect(finish).toContain('const moved = current.target.to !== current.from;');
    expect(finish).toContain('if (moved) {');
    expect(section('const onPointerMove', 'const finish')).not.toContain('onReorder(');
    expect(code(CONTROLLER).match(/onReorder\(/g)).toHaveLength(1);
  });

  it('a cancelled pointer restores and writes nothing', () => {
    const cancel = section('const cancel = useCallback', 'const onPointerDown');
    expect(cancel).not.toContain('onReorder');
    expect(cancel).toContain('restingFrame(stage.rects, current.from, duration())');
    expect(cancel).toContain('setHeldOrder(null)');
    expect(code(CONTROLLER)).toContain('onPointerCancel: cancel');
    // A capture lost without a release is the same accident.
    expect(section('const onLostPointerCapture', 'useEffect')).toContain('cancel()');
  });

  it('the frame it goes back to is the resting one', () => {
    const rects = topbar();
    const { elements, written } = stageElements(rects);
    paint(elements, restingFrame(rects, 1, REORDER_DURATION_MS));
    for (const rect of rects) {
      expect(written.get(rect.index)).toEqual({
        transform: 'translate3d(0px, 0px, 0)',
        transition: `transform ${REORDER_DURATION_MS}ms ${REORDER_EASING}`,
      });
    }
  });

  it('Escape gives up on the gesture the same way', () => {
    const escape = section("if (dragId === null) return undefined;", 'useEffect');
    expect(escape).toContain("if (event.key === 'Escape') cancel();");
    expect(escape).toContain("window.addEventListener('keydown', onKeyDown)");
    expect(escape).toContain("window.removeEventListener('keydown', onKeyDown)");
  });

  it('a write that fails puts the previous order back', () => {
    const finish = section('const finish = useCallback', 'const onLostPointerCapture');
    expect(finish).toContain('if (!saved) setHeldOrder(null)');
    expect(code(APP)).toContain('const result = await bridge.reorderButtons(orderedIds);');
    expect(code(APP)).toContain('if (result.ok) return true;');
    expect(code(APP)).toContain('setError(');
    expect(code(APP)).toContain('return false;');
  });

  it('no button is ever lost or duplicated by a provisional order', () => {
    const buttons = [button('a'), button('b'), button('c')];
    const ids = buttons.map((item) => item.id);
    for (const order of [
      ids,
      ['c', 'a', 'b'],
      ['c'],
      ['z', 'b'],
      [],
      ['a', 'a', 'b', 'c'],
    ]) {
      const applied = applyOrder(buttons, order);
      expect(applied).toHaveLength(3);
      expect([...applied].map((item) => item.id).sort()).toEqual(['a', 'b', 'c']);
    }
    expect(matchesOrder(buttons, ids)).toBe(true);
    expect(matchesOrder(buttons, ['c', 'a', 'b'])).toBe(false);
    expect(matchesOrder(buttons, null)).toBe(true);
  });
});

describe('nothing runs because of a drag', () => {
  it('the click that ends a reorder is swallowed', () => {
    expect(section('const finish = useCallback', 'const onLostPointerCapture')).toContain(
      'reordered.current = true;',
    );
    expect(section('const cancel = useCallback', 'const onPointerDown')).toContain(
      'reordered.current = true;',
    );
    expect(code(APP)).toContain('if (gestures.consumeClick()) return;');
  });

  it('and no frame of the gesture can start a process', () => {
    const move = section('const onPointerMove', 'const finish');
    for (const forbidden of ['bridge.run', 'onOpen', 'setView']) {
      expect(move, forbidden).not.toContain(forbidden);
    }
    expect(section('const onPointerDown', 'const onPointerMove')).toContain(
      'reordered.current = false;',
    );
  });
});

describe('the widget itself does not move', () => {
  it('no frame of the gesture can change the width', () => {
    const move = section('const onPointerMove', 'const finish');
    const reorderPart = move.slice(move.indexOf("if (current.kind === 'move') {"));
    expect(reorderPart.slice(reorderPart.indexOf('const stage = current.stage;'))).not.toContain(
      'bridge.',
    );
    const rects = topbar();
    const frame = reorderFrame({
      ...context(rects, 0, { x: 191, y: 25 }),
      rects,
      dragged: { x: 160, y: 0 },
      duration: REORDER_DURATION_MS,
      phase: 'dragging',
    });
    expect(Object.keys(frame[0]!).sort()).toEqual(['dragged', 'index', 'transform', 'transition']);
  });

  it('the order is held while the gesture runs, so nothing re-fits', () => {
    const move = section('const onPointerMove', 'const finish');
    expect(move).toContain('setHeldOrder(ordered.map((button) => button.id))');
    expect(code(APP)).toContain('const buttons = gestures.buttons;');
    expect(code(APP)).toContain('splitButtons(buttons, visibleCount)');
    // The measurement still counts the stored buttons, whose number a reorder
    // never changes.
    expect(code(APP)).toContain('state.buttons.length,');
  });

  it('Mais (N) keeps counting what did not fit', () => {
    const buttons = [button('a'), button('b'), button('c'), button('d')];
    for (const order of [['d', 'c', 'b', 'a'], ['b', 'a'], []]) {
      // However the order is held, the list is the same length, so the split
      // between the bar and the panel adds up to the same N.
      const applied = applyOrder(buttons, order);
      expect(applied).toHaveLength(buttons.length);
    }
    expect(code(BAR)).toContain('{`Mais (${hiddenCount})`}');
    expect(code(BAR)).toContain('{`Mais (${buttons.length})`}');
    expect(code(MORE)).toContain('{`Mais (${buttons.length})`}');
  });
});

describe('the panel animates vertically, and across to the bar', () => {
  it('a row dragged inside Mais moves the other rows vertically', () => {
    const rects = rows(4, 0);
    const { elements, written } = stageElements(rects);
    // Row 0 carried down past row 1: centres at 220, 262, 304, 346.
    const ctx = context(rects, 0, { x: 200, y: 263 });
    expect(ctx.target.to).toBe(1);
    expect(ctx.target.vertical).toBe(true);
    paint(
      elements,
      reorderFrame({ ...ctx, rects, dragged: { x: 0, y: 43 }, duration: REORDER_DURATION_MS, phase: 'dragging' }),
    );
    // Row 1 comes up by exactly one row plus the 2px gap, and only vertically.
    expect(written.get(1)!.transform).toBe('translate3d(0px, -42px, 0)');
    expect(gapOf(rects, true)).toBe(2);
    expect(ctx.metrics.vertical).toBe(42);
    expect(written.get(2)!.transform).toBe('translate3d(0px, 0px, 0)');
  });

  it('carrying a row to the bar opens the destination and closes the hole', () => {
    const rects = [...topbar(), ...rows(3, 4)];
    const { elements, written } = stageElements(rects);
    // Row 5 carried up between buttons 0 and 1. Its width on the bar is the
    // natural width the App measured for it, not the panel's width.
    const ctx = context(rects, 5, { x: 70, y: 25 }, 70);
    expect(ctx.target.vertical).toBe(false);
    expect(ctx.target.to).toBe(1);
    expect(ctx.metrics.horizontal).toBe(74);
    paint(
      elements,
      reorderFrame({ ...ctx, rects, dragged: { x: -130, y: -230 }, duration: REORDER_DURATION_MS, phase: 'dragging' }),
    );
    // The bar opens the slot it is heading for.
    expect(written.get(0)!.transform).toBe('translate3d(0px, 0px, 0)');
    for (const index of [1, 2, 3]) {
      expect(written.get(index)!.transform).toBe('translate3d(74px, 0px, 0)');
    }
    // The panel closes up behind it; the row above it stays.
    expect(written.get(4)!.transform).toBe('translate3d(0px, 0px, 0)');
    expect(written.get(6)!.transform).toBe('translate3d(0px, -42px, 0)');
  });

  it('and the button it displaced is the one that moves down to Mais', () => {
    const rects = [...topbar(), ...rows(3, 4)];
    const ctx = context(rects, 5, { x: 70, y: 25 }, 70);
    const ids = ['b0', 'b1', 'b2', 'b3', 'r4', 'r5', 'r6'];
    // One list, one move: the last button that no longer fits is simply the
    // one after the split.
    expect(moveItem(ids, ctx.from, ctx.target.to)).toEqual([
      'b0',
      'r5',
      'b1',
      'b2',
      'b3',
      'r4',
      'r6',
    ]);
  });

  it('the carried button is never cut off while it travels', () => {
    // The scripts area clips at its edge, which is what keeps a button that no
    // longer fits out of sight; for the length of the gesture that clip is
    // lifted so the carried button stays whole over the free strip.
    expect(rule('.bar__scripts')).toContain('overflow: hidden');
    const start = CSS.indexOf('body.di-reordering .bar__scripts');
    expect(start).toBeGreaterThan(-1);
    expect(CSS.slice(start, CSS.indexOf('}', start))).toContain('overflow: visible');
    // Nothing about the button's own width changes, so no truncation either.
    expect(rule('.action--script')).not.toContain('text-overflow');
    expect(rule('.action--script')).not.toContain('max-width');
  });
});

describe('a running script keeps its process', () => {
  it('carries the very same button object into the new order', () => {
    const running = button('watch', 'running');
    const buttons = [button('build'), running, button('test')];
    const applied = applyOrder(buttons, ['watch', 'test', 'build']);
    // The same object, so its status, its exit code and the PTY behind it are
    // not something the order can affect.
    expect(applied[0]).toBe(running);
    expect(applied[0]!.status).toBe('running');
    expect(applied.filter((item) => item.status === 'running')).toHaveLength(1);
  });

  it('is identified by id, never by its position', () => {
    // The write is a list of ids, and the gesture reads the id off the button
    // it grabbed, so nothing downstream depends on where it sat.
    expect(code(CONTROLLER)).toContain('const ids = ordered.map((button) => button.id);');
    expect(code(CONTROLLER)).toContain('const id = marked.dataset.reorderId;');
    expect(code(BAR)).toContain('data-reorder-id={button.id}');
    expect(code(MORE)).toContain('data-reorder-id={button.id}');
  });
});

describe('less movement, same behaviour', () => {
  it('drops every transition when the system asks for reduced motion', () => {
    const rects = topbar();
    const frame = reorderFrame({
      ...context(rects, 0, { x: 191, y: 25 }),
      rects,
      dragged: { x: 160, y: 0 },
      duration: 0,
      phase: 'settling',
    });
    for (const style of frame) {
      expect(style.transition).toBe('none');
    }
    expect(transitionFor(0)).toBe('none');
  });

  it('but still changes the places: only the travelling is gone', () => {
    const rects = topbar();
    const ctx = context(rects, 0, { x: 191, y: 25 });
    const frame = reorderFrame({ ...ctx, rects, dragged: { x: 160, y: 0 }, duration: 0, phase: 'dragging' });
    // The same transforms as with the animation on, so the order still moves.
    expect(ctx.target.to).toBe(2);
    expect(frame.find((style) => style.index === 1)!.transform).toBe('translate3d(-64px, 0px, 0)');
    expect(frame.find((style) => style.index === 2)!.transform).toBe('translate3d(-64px, 0px, 0)');
    // And the write still happens, so the new order is kept.
    expect(section('const finish = useCallback', 'const onLostPointerCapture')).toContain('onReorder(');
  });

  it('asks the system, and the stylesheet backs the answer up', () => {
    expect(code(CONTROLLER)).toContain('prefersReducedMotion() ? 0 : REORDER_DURATION_MS');
    const stage = readFileSync('src/renderer/reorder-stage.ts', 'utf8');
    expect(stage).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    const start = CSS.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThan(-1);
    const block = CSS.slice(start, CSS.indexOf('}', CSS.indexOf('{', start)));
    expect(block).toContain('transition: none !important');
  });

  it('and it waits for nothing when there is nothing to wait for', () => {
    const after = section('const afterAnimation = useCallback', 'const cancel');
    // No timer at all: the state is dropped in the same turn.
    expect(after).toContain('if (duration() === 0) {');
    expect(after.slice(after.indexOf('if (duration() === 0) {'))).toContain('done();');
  });
});

describe('the movement itself stays discreet', () => {
  it('lasts between 120 and 180ms, on the curve the design asks for', () => {
    expect(REORDER_DURATION_MS).toBeGreaterThanOrEqual(120);
    expect(REORDER_DURATION_MS).toBeLessThanOrEqual(180);
    expect(REORDER_EASING).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(transitionFor(REORDER_DURATION_MS)).toBe(
      `transform ${REORDER_DURATION_MS}ms ${REORDER_EASING}`,
    );
  });

  it('animates transforms only, and only on the compositor', () => {
    const animation = readFileSync('src/renderer/reorder-animation.ts', 'utf8');
    expect(animation).toContain('translate3d');
    // Nothing springy, nothing spinning, nothing fading.
    for (const forbidden of ['rotate', 'scale', 'opacity', 'bounce', 'elastic', 'spring']) {
      expect(code(animation).toLowerCase(), forbidden).not.toContain(forbidden);
    }
    expect(transitionFor(REORDER_DURATION_MS)).toContain('transform ');
    expect(transitionFor(REORDER_DURATION_MS)).not.toContain('all ');
  });

  it('carries no drag and drop library', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    for (const name of names) {
      expect(name).not.toMatch(/dnd|drag|sortable|beautiful/i);
    }
  });

  it('does not animate a first paint or an order that simply arrived', () => {
    // The transition is written by the gesture and taken off when it ends, so
    // there is nothing to animate with when a render is not a reorder.
    expect(rule('.action--script')).not.toContain('transition');
    expect(rule('.more__item')).not.toContain('transition');
    const clear = section('const clear = useCallback', 'const afterAnimation');
    expect(clear).toContain('clearStage(stage.elements)');
    const stage = readFileSync('src/renderer/reorder-stage.ts', 'utf8');
    expect(stage).toContain("element.setTransform('', '')");
  });

  it('the centre it steers by is the button, not the pointer', () => {
    const rects = topbar();
    const dragged = rects[0]!;
    // Grabbed near its left edge, the pointer sits well left of the centre;
    // the decision follows the button's centre so the swap happens when the
    // button is over its neighbour, not when the pointer is.
    expect(draggedCentre(dragged, { x: 0, y: 0 })).toEqual({ x: 30, y: 25 });
    expect(draggedCentre(dragged, { x: 85, y: 0 })).toEqual({ x: 115, y: 25 });
    expect(code(CONTROLLER)).toContain('targetFor(stage.rects, current.from, draggedCentre(dragged, offset))');
  });
});
