import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ADD_LABEL, CLOSE_LABEL, themeLabel } from '../src/renderer/components/CompactBar';
import { GRIP_LABEL, GRIP_TITLE } from '../src/renderer/components/Grip';
import { GRIP_DOT_COUNT } from '../src/renderer/components/icons';

const css = fs.readFileSync('src/renderer/styles.css', 'utf8');
/** Same stylesheet without comments, so selector lists are unambiguous. */
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '');
const compactBar = fs.readFileSync('src/renderer/components/CompactBar.tsx', 'utf8');

/** Reads one rule block out of the stylesheet. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector} not found`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('the grip has exactly six dots', () => {
  it('renders two columns of three', () => {
    expect(GRIP_DOT_COUNT).toBe(6);
    const grip = rule('.grip');
    expect(grip).toContain('grid-template-columns: repeat(2, 3px)');
    expect(grip).toContain('grid-auto-rows: 3px');
  });

  it('shows grab and grabbing cursors', () => {
    expect(rule('.grip')).toContain('cursor: grab');
    expect(rule('.grip:active')).toContain('cursor: grabbing');
  });

  it('is between 24 and 32 pixels wide', () => {
    const width = /width: (\d+)px/.exec(rule('.grip'))?.[1];
    expect(Number(width)).toBeGreaterThanOrEqual(24);
    expect(Number(width)).toBeLessThanOrEqual(32);
  });
});

describe('only the grip moves the window', () => {
  it('declares no native drag region at all', () => {
    // `-webkit-app-region: drag` turns an element into a Windows non-client
    // area, which drops the CSS cursor. The move is driven from the renderer
    // instead, so nothing declares it.
    const dragRules = cssRules
      .split('}')
      .filter((block) => /-webkit-app-region:\s*drag\s*;/.test(block));
    expect(dragRules).toEqual([]);
  });

  it('marks the capsule and every interactive surface as no-drag', () => {
    for (const selector of [
      '.island',
      '.grip',
      '.action',
      '.icon-button',
      '.panel',
      '.field__input',
      '.more__item',
      '.terminal',
      '.resize',
    ]) {
      expect(rule(selector), selector).toContain('-webkit-app-region: no-drag');
    }
  });

  it('the topbar owns the move gesture, and the grip is a free area of it', () => {
    // The move used to live on the grip alone; it now belongs to the topbar,
    // which treats every spot without a control as free.
    expect(compactBar).toContain('{...gestures}');
    expect(compactBar).toContain("[GESTURE_ATTRIBUTE]: 'free'");
    expect(fs.readFileSync('src/renderer/components/Grip.tsx', 'utf8')).toContain(
      "[GESTURE_ATTRIBUTE]: 'free'",
    );

    // No other component wires the gesture handlers of its own accord.
    for (const name of ['ProcessPanel', 'AddButtonForm', 'ResizeHandles', 'AuthorizePanel']) {
      const source = fs.readFileSync(`src/renderer/components/${name}.tsx`, 'utf8');
      expect(source, name).not.toContain('{...gestures}');
    }
  });

  it('never puts a gesture inside the measuring row', () => {
    expect(compactBar).toContain('measure__grip');
    expect(rule('.measure__grip')).not.toContain('app-region');
  });
});

describe('the three icon controls are labelled', () => {
  it('uses the expected wording', () => {
    expect(ADD_LABEL).toBe('Add action');
    expect(CLOSE_LABEL).toBe('Close widget');
    expect(themeLabel('dark')).toBe('Use the light theme');
    expect(themeLabel('light')).toBe('Use the dark theme');
  });

  it('puts the same words in aria-label and title', () => {
    const iconButton = fs.readFileSync('src/renderer/components/IconButton.tsx', 'utf8');
    expect(iconButton).toContain('aria-label={label}');
    expect(iconButton).toContain('title={label}');
  });

  it('gives every icon button at least a 30x30 hit area', () => {
    const block = rule('.icon-button');
    expect(block).toContain('width: 30px');
    expect(block).toContain('height: 30px');
  });

  it('has hover, pressed and keyboard focus states', () => {
    expect(rule('.icon-button:hover')).toContain('background');
    expect(rule('.icon-button:active')).toContain('background');
    expect(rule('.icon-button:focus-visible')).toContain('border-color');
  });

  it('labels the grip for pointer and screen reader', () => {
    expect(GRIP_LABEL).toBe('Drag widget');
    expect(GRIP_TITLE).toContain('Drag');
    expect(GRIP_TITLE).toContain('double click');
  });
});

describe('scripts are never elided', () => {
  it('lets a script keep its natural width', () => {
    const block = rule('.action--script');
    expect(block).toContain('flex: 0 0 auto');
    expect(block).toContain('flex-shrink: 0');
    expect(block).toContain('white-space: nowrap');
  });

  it('has no ellipsis or width cap on the buttons', () => {
    for (const selector of ['.action', '.action--script']) {
      expect(rule(selector)).not.toContain('text-overflow');
      expect(rule(selector)).not.toContain('max-width');
    }
  });

  it('keeps the ellipsis only on the project label', () => {
    expect(rule('.bar__project')).toContain('text-overflow: ellipsis');
  });
});

describe('resize affordances', () => {
  /** Reads the block a multi-selector rule starts, without needing newlines. */
  const groupRule = (marker: string): string => {
    const start = css.indexOf(marker);
    expect(start, marker).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  /** Whitespace-insensitive view, so grouped selectors read as one line. */
  const flat = css.replace(/\s+/g, ' ');

  it('offers all eight directions with the matching native cursors', () => {
    expect(flat).toContain('.resize--n, .resize--s { left: 0; width: 100%; height: 6px; cursor: ns-resize');
    expect(flat).toContain('.resize--e, .resize--w { top: 0; width: 6px; height: 100%; cursor: ew-resize');
    expect(flat).toContain('.resize--nw, .resize--se { cursor: nwse-resize');
    expect(flat).toContain('.resize--ne, .resize--sw { cursor: nesw-resize');
  });

  it('gives edges ~6px and corners ~12px, with corners on top', () => {
    expect(flat).toContain('height: 6px');
    const corners = groupRule('.resize--ne,');
    expect(corners).toContain('width: 12px');
    expect(corners).toContain('height: 12px');
    // Corners must win the pixels they share with the edges.
    const cornerZ = Number(/z-index: (\d+)/.exec(corners)?.[1]);
    const edgeZ = Number(/z-index: (\d+)/.exec(rule('.resize'))?.[1]);
    expect(cornerZ).toBeGreaterThan(edgeZ);
  });

  it('marks the corner discreetly', () => {
    expect(css).toContain('.resize--se::after');
  });
});
