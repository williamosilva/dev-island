import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { clickHint, scriptTitle } from '../src/renderer/components/CompactBar';
import type { ButtonView } from '../src/shared/types';

const css = fs.readFileSync('src/renderer/styles.css', 'utf8');
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const start = css.indexOf(selector + ' {');
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

/**
 * The cursor that actually applies: the **last** declaration in the rule wins,
 * so reading the first one would happily miss a later override.
 */
function declaredCursor(selector: string): string | null {
  const declarations = [...rule(selector).matchAll(/cursor:\s*([a-z-]+)/g)];
  return declarations.at(-1)?.[1] ?? null;
}

/**
 * The cursor each part of the widget must show at rest.
 *
 * `grab` belongs to the surfaces whose only job is moving the window. A script
 * button and a row of "More" are primarily things you click, so they read
 * `pointer`; carrying one is what turns the cursor into the closed hand, and
 * only once the press has stopped being a click.
 */
const EXPECTED: ReadonlyArray<[string, string]> = [
  ['.bar', 'grab'],
  ['.grip', 'grab'],
  ['.action--script', 'pointer'],
  ['.more__item', 'pointer'],
  ['.action', 'pointer'],
  ['.icon-button', 'pointer'],
];

describe('cursors of the topbar', () => {
  for (const [selector, cursor] of EXPECTED) {
    it(`${selector} shows ${cursor}`, () => {
      expect(declaredCursor(selector)).toBe(cursor);
    });
  }

  it('nothing that is only clickable ever declares grab', () => {
    for (const selector of ['.action', '.action--script', '.more__item', '.icon-button']) {
      expect(rule(selector), selector).not.toContain('cursor: grab');
    }
    // Both are single-class selectors, so source order decides which applies.
    expect(cssRules.indexOf('.action--script {')).toBeGreaterThan(cssRules.indexOf('.action {'));
  });

  it('the borders keep their own resize cursors', () => {
    const flat = css.replace(/\s+/g, ' ');
    expect(flat).toContain('.resize--n, .resize--s { left: 0; width: 100%; height: 6px; cursor: ns-resize');
    expect(flat).toContain('.resize--e, .resize--w { top: 0; width: 6px; height: 100%; cursor: ew-resize');
    expect(flat).toContain('.resize--nw, .resize--se { cursor: nwse-resize');
    expect(flat).toContain('.resize--ne, .resize--sw { cursor: nesw-resize');
  });

  it('a running gesture forces grabbing everywhere, even off the element', () => {
    const start = css.indexOf('body.di-gesturing');
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('cursor: grabbing !important');
    expect(block).toContain('body.di-gesturing *');
    // A reorder is the other gesture, and it looks the same to the hand.
    expect(block).toContain('body.di-reordering *');
  });

  it('declares each cursor exactly once, so none is silently overridden', () => {
    for (const [selector] of EXPECTED) {
      expect([...rule(selector).matchAll(/cursor:/g)], selector).toHaveLength(1);
    }
  });

  it('reorderable elements block accidental text selection', () => {
    expect(rule('.action--script')).toContain('user-select: none');
    expect(rule('.more__item')).toContain('user-select: none');
  });

  it('still declares no native drag region', () => {
    expect(cssRules).not.toMatch(/-webkit-app-region:\s*drag\s*;/);
  });
});

describe('the script tooltip explains both actions', () => {
  const button = (status: ButtonView['status']): ButtonView => ({
    id: 'abc123',
    name: 'Dev',
    script: 'npm run dev',
    custom: false,
    status,
    exitCode: null,
  });

  it('offers to run while the script is idle', () => {
    expect(clickHint(button('idle'))).toBe('Click to run');
    expect(scriptTitle(button('idle'))).toBe(
      'Dev\nnpm run dev\nClick to run · drag to reorder',
    );
  });

  it('offers the terminal while the script runs', () => {
    expect(clickHint(button('running'))).toBe('Click to open the terminal');
    expect(scriptTitle(button('running'))).toContain('Click to open the terminal');
  });

  it('keeps the drag half identical in every state', () => {
    for (const status of ['idle', 'running', 'exited'] as const) {
      expect(scriptTitle(button(status))).toContain('· drag to reorder');
      // The real command is still there, as it always was.
      expect(scriptTitle(button(status))).toContain('npm run dev');
    }
  });
});
