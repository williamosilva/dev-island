import { describe, expect, it } from 'vitest';

import { moveItem, type ReorderRect } from '../src/renderer/reorder';
import { targetFor } from '../src/renderer/reorder-animation';
import { GESTURE_THRESHOLD_PX } from '../src/renderer/useTopbarGestures';

const ORDER = ['Build', 'Build:gateway', 'Postinstall', 'Dev'];

/** Buttons side by side, 100px wide, as they sit on the topbar. */
function topbarRects(count: number): ReorderRect[] {
  return Array.from({ length: count }, (_unused, index) => ({
    index,
    left: index * 100,
    top: 10,
    width: 100,
    height: 30,
    vertical: false,
  }));
}

/** Rows stacked vertically, as they sit in the "Mais" panel. */
function rowRects(count: number, offset = 0): ReorderRect[] {
  return Array.from({ length: count }, (_unused, index) => ({
    index: offset + index,
    left: 0,
    top: index * 40,
    width: 400,
    height: 40,
    vertical: true,
  }));
}

describe('moving a button changes its position', () => {
  it('drags the last button to the front', () => {
    // Build | Build:gateway | Postinstall | Dev  ->  Dev | Build | ...
    expect(moveItem(ORDER, 3, 0)).toEqual(['Dev', 'Build', 'Build:gateway', 'Postinstall']);
  });

  it('moves forwards and backwards', () => {
    expect(moveItem(ORDER, 0, 2)).toEqual(['Build:gateway', 'Postinstall', 'Build', 'Dev']);
    expect(moveItem(ORDER, 1, 3)).toEqual(['Build', 'Postinstall', 'Dev', 'Build:gateway']);
  });

  it('keeps every item exactly once, whatever the indices', () => {
    for (const from of [0, 1, 2, 3]) {
      for (const to of [-5, 0, 1, 2, 3, 9]) {
        const moved = moveItem(ORDER, from, to);
        expect(moved).toHaveLength(ORDER.length);
        expect([...moved].sort()).toEqual([...ORDER].sort());
      }
    }
  });

  it('is a no-op for an index that does not exist', () => {
    expect(moveItem(ORDER, 7, 0)).toEqual(ORDER);
  });
});

describe('the provisional position follows the dragged button', () => {
  it('changes only once the dragged centre crosses a neighbour centre', () => {
    const rects = topbarRects(4);
    // Item 0 grabbed: its centre starts at 50, item 1's is at 150.
    expect(targetFor(rects, 0, { x: 50, y: 25 }).to).toBe(0);
    // Just short of the neighbour's centre: still its own place.
    expect(targetFor(rects, 0, { x: 149, y: 25 }).to).toBe(0);
    // Past it: the two swap.
    expect(targetFor(rects, 0, { x: 151, y: 25 }).to).toBe(1);
    expect(targetFor(rects, 0, { x: 251, y: 25 }).to).toBe(2);
  });

  it('reverses at the same threshold, so a drag back undoes the swap', () => {
    const rects = topbarRects(4);
    expect(targetFor(rects, 3, { x: 249, y: 25 }).to).toBe(2);
    expect(targetFor(rects, 3, { x: 251, y: 25 }).to).toBe(3);
  });

  it('uses the vertical centres for the rows of "Mais"', () => {
    const rects = rowRects(3, 5);
    // Rows 40px tall from y=0: centres at 20, 60, 100.
    expect(targetFor(rects, 5, { x: 200, y: 20 }).to).toBe(5);
    expect(targetFor(rects, 5, { x: 200, y: 61 }).to).toBe(6);
    expect(targetFor(rects, 5, { x: 200, y: 101 }).to).toBe(7);
    expect(targetFor(rects, 5, { x: 200, y: 20 }).vertical).toBe(true);
  });

  it('stays put when the button it was given does not exist', () => {
    expect(targetFor([], 0, { x: 10, y: 10 })).toEqual({ to: 0, slot: 0, vertical: false });
  });

  it('keeps the nearest container when the pointer drifts off it', () => {
    const rects = topbarRects(3);
    // Well below the bar, but the bar is still the nearest container.
    expect(targetFor(rects, 0, { x: 251, y: 400 }).vertical).toBe(false);
    expect(targetFor(rects, 0, { x: 251, y: 400 }).to).toBe(2);
  });
});

describe('a row dragged onto the topbar lands in that slot', () => {
  const mixed = (): ReorderRect[] => [...topbarRects(3), ...rowRects(3, 3)];

  it('takes the topbar position its centre is over', () => {
    const rects = mixed();
    // Row 4 carried up to between the first and second button.
    const target = targetFor(rects, 4, { x: 120, y: 25 });
    expect(target.vertical).toBe(false);
    expect(target.to).toBe(1);
    expect(target.slot).toBe(1);
    expect(moveItem(['a', 'b', 'c', 'd', 'e', 'f'], 4, target.to)).toEqual([
      'a',
      'e',
      'b',
      'c',
      'd',
      'f',
    ]);
  });

  it('and a button dragged into the panel lands in that row', () => {
    const rects = mixed();
    // Button 0 carried down onto the second row: rows sit at y 0/40/80.
    const target = targetFor(rects, 0, { x: 200, y: 61 });
    expect(target.vertical).toBe(true);
    expect(target.slot).toBe(2);
    // Indices in the list without the dragged button: rows are 2, 3, 4.
    expect(target.to).toBe(4);
    expect(moveItem(['a', 'b', 'c', 'd', 'e', 'f'], 0, target.to)).toEqual([
      'b',
      'c',
      'd',
      'e',
      'a',
      'f',
    ]);
  });
});

describe('the threshold keeps a click a click', () => {
  it('is between 4 and 6 pixels', () => {
    expect(GESTURE_THRESHOLD_PX).toBeGreaterThanOrEqual(4);
    expect(GESTURE_THRESHOLD_PX).toBeLessThanOrEqual(6);
  });
});
