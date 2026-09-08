import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  boundsFor,
  DRAG_THRESHOLD_PX,
  DRAGGING_CLASS,
} from '../src/renderer/gesture-geometry';
import type { BoundsDirection } from '../src/shared/api';

const START = { pointerX: 500, pointerY: 400, x: 200, y: 100, width: 800, height: 300, started: true };
const gesture = (direction: BoundsDirection) => ({ ...START, direction });

const right = (b: { x: number; width: number }): number => b.x + b.width;
const bottom = (b: { y: number; height: number }): number => b.y + b.height;

describe('geometry of a gesture, always from the captured start', () => {
  it('move shifts the window and keeps its size', () => {
    expect(boundsFor(gesture('move'), 560, 460)).toEqual({ x: 260, y: 160, width: 800, height: 300 });
  });

  it('east and west mirror each other around the fixed edge', () => {
    const east = boundsFor(gesture('e'), 600, 400);
    expect(east).toMatchObject({ x: 200, width: 900 });

    const west = boundsFor(gesture('w'), 400, 400);
    expect(west).toMatchObject({ x: 100, width: 900 });
    expect(right(west)).toBe(right(START));
  });

  it('south and north mirror each other around the fixed edge', () => {
    const south = boundsFor(gesture('s'), 500, 500);
    expect(south).toMatchObject({ y: 100, height: 400 });

    const north = boundsFor(gesture('n'), 500, 300);
    expect(north).toMatchObject({ y: 0, height: 400 });
    expect(bottom(north)).toBe(bottom(START));
  });

  it('every corner combines its two edges', () => {
    expect(boundsFor(gesture('se'), 560, 460)).toEqual({ x: 200, y: 100, width: 860, height: 360 });
    expect(boundsFor(gesture('sw'), 440, 460)).toEqual({ x: 140, y: 100, width: 860, height: 360 });
    expect(boundsFor(gesture('ne'), 560, 340)).toEqual({ x: 200, y: 40, width: 860, height: 360 });
    expect(boundsFor(gesture('nw'), 440, 340)).toEqual({ x: 140, y: 40, width: 860, height: 360 });
  });

  it('is computed from the start, so repeating a position repeats the result', () => {
    const first = boundsFor(gesture('nw'), 470, 370);
    const wandered = boundsFor(gesture('nw'), 300, 250);
    const back = boundsFor(gesture('nw'), 470, 370);
    expect(back).toEqual(first);
    expect(wandered).not.toEqual(first);
  });

  it('lets a pull past the opposite edge go negative for the main process to clamp', () => {
    const collapsed = boundsFor(gesture('w'), 2500, 400);
    expect(collapsed.width).toBeLessThan(0);
    // The right edge is still described correctly, which is what the clamp uses.
    expect(right(collapsed)).toBe(right(START));
  });
});

describe('the grab cursor', () => {
  const css = fs.readFileSync('src/renderer/styles.css', 'utf8');
  const rule = (selector: string): string => {
    const start = css.indexOf(selector + ' {');
    expect(start, selector).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  it('shows grab at rest', () => {
    expect(rule('.grip')).toContain('cursor: grab');
  });

  it('keeps grabbing during the gesture, even off the grip', () => {
    const start = css.indexOf('body.di-gesturing');
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('cursor: grabbing !important');
    expect(block).toContain('user-select: none');
    expect(DRAGGING_CLASS).toBe('di-gesturing');
    // The class goes on <body>, so the rule applies wherever the pointer is.
    expect(block).toContain('body.di-gesturing *');
  });

  it('the grip is not a native drag region, which is what broke the cursor', () => {
    expect(rule('.grip')).toContain('-webkit-app-region: no-drag');
    expect(css).not.toMatch(/-webkit-app-region:\s*drag\s*;/);
  });

  it('a press that never moves stays a click, so double click still resets', () => {
    expect(DRAG_THRESHOLD_PX).toBeGreaterThan(0);
    const source = fs.readFileSync('src/renderer/useWindowGesture.ts', 'utf8');
    expect(source).toContain('if (current.started) bridge.commitBounds();');
    expect(source).toContain('else onClickWithoutDrag?.();');
  });
});
