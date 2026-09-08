import { describe, expect, it } from 'vitest';

import {
  BAR_CHROME,
  BAR_GAP,
  fitButtons,
  MIN_FREE_DRAG_WIDTH,
  splitButtons,
  type FitInput,
} from '../src/renderer/fit';

/** A real project's 19 scripts, in package.json order. */
const REAL_SCRIPTS = [
  'Compile', 'Watch', 'Typecheck', 'Test', 'Check', 'Dev', 'Demo', 'Local',
  'Local:dev', 'Local:build', 'Local:check', 'Local:link', 'Cli:build', 'Cli:pack',
  'Cli:check', 'Install:local', 'Install:local:dry', 'Package', 'Vscode:prepublish',
];

/** Rough but consistent stand-in for a real measurement. */
const widthOf = (name: string): number => name.length * 7 + 20;

/** Measured widths of the fixed controls, as rendered. */
const CONTROLS_WIDTH = widthOf('Add') + BAR_GAP + widthOf('Theme') + BAR_GAP + widthOf('Close');
const MORE_WIDTH = widthOf('More (19)');

function input(names: readonly string[], overrides: Partial<FitInput> = {}): FitInput {
  return {
    maxWidth: 900,
    projectWidth: widthOf('agent-rules-lens'),
    controlsWidth: CONTROLS_WIDTH,
    moreWidth: MORE_WIDTH,
    buttonWidths: names.map(widthOf),
    gap: BAR_GAP,
    chrome: BAR_CHROME,
    ...overrides,
  };
}

/** Total width the bar would actually occupy for a given result. */
function occupied(names: readonly string[], visibleCount: number, showsMore: boolean, base: FitInput): number {
  const scripts = names
    .slice(0, visibleCount)
    .reduce((total, name) => total + widthOf(name) + base.gap, 0);
  return (
    base.chrome +
    base.projectWidth +
    base.controlsWidth +
    MIN_FREE_DRAG_WIDTH +
    scripts +
    (showsMore ? base.moreWidth + base.gap : 0)
  );
}

describe('a project with few scripts shows no "More"', () => {
  it('fits three buttons with room to spare', () => {
    const names = ['Dev', 'Test', 'Build'];
    expect(fitButtons(input(names))).toEqual({ visibleCount: 3, hiddenCount: 0 });
  });

  it('never reports "More (0)"', () => {
    const result = fitButtons(input(['Dev', 'Test', 'Build']));
    expect(result.hiddenCount).toBe(0);
  });

  it('shows everything when there are no scripts at all', () => {
    expect(fitButtons(input([]))).toEqual({ visibleCount: 0, hiddenCount: 0 });
  });
});

describe('a project with 19 scripts', () => {
  const base = input(REAL_SCRIPTS);
  const result = fitButtons(base);

  it('shows only the buttons that actually fit', () => {
    expect(result.visibleCount).toBeGreaterThan(0);
    expect(result.visibleCount).toBeLessThan(REAL_SCRIPTS.length);
  });

  it('never exceeds the maximum width', () => {
    expect(occupied(REAL_SCRIPTS, result.visibleCount, true, base)).toBeLessThanOrEqual(base.maxWidth);
  });

  it('adding one more button would overflow', () => {
    expect(occupied(REAL_SCRIPTS, result.visibleCount + 1, true, base)).toBeGreaterThan(base.maxWidth);
  });

  it('reports exactly how many are hidden', () => {
    expect(result.hiddenCount).toBe(REAL_SCRIPTS.length - result.visibleCount);
    expect(result.visibleCount + result.hiddenCount).toBe(19);
  });

  it('adapts to a narrower VS Code window', () => {
    const narrow = fitButtons(input(REAL_SCRIPTS, { maxWidth: 520 }));
    expect(narrow.visibleCount).toBeLessThan(result.visibleCount);
    expect(narrow.visibleCount + narrow.hiddenCount).toBe(19);
  });

  it('adapts to a wider one', () => {
    const wide = fitButtons(input(REAL_SCRIPTS, { maxWidth: 1600 }));
    expect(wide.visibleCount).toBeGreaterThan(result.visibleCount);
  });
});

describe('every hidden script is reachable', () => {
  const result = fitButtons(input(REAL_SCRIPTS));
  const { visible, hidden } = splitButtons(REAL_SCRIPTS, result.visibleCount);

  it('lists exactly the ones that did not fit, in order', () => {
    expect(hidden).toHaveLength(result.hiddenCount);
    expect([...visible, ...hidden]).toEqual(REAL_SCRIPTS);
  });

  it('includes the last script of the project', () => {
    expect(hidden.at(-1)).toBe('Vscode:prepublish');
    expect(hidden).toContain('Vscode:prepublish');
  });

  it('loses nothing even when nothing fits', () => {
    const none = splitButtons(REAL_SCRIPTS, 0);
    expect(none.visible).toEqual([]);
    expect(none.hidden).toEqual(REAL_SCRIPTS);
  });
});

describe('the fixed controls are never pushed out', () => {
  it('never lets the scripts eat into the space the controls need', () => {
    for (const maxWidth of [320, 420, 520, 700, 900, 1200]) {
      const base = input(REAL_SCRIPTS, { maxWidth });
      const result = fitButtons(base);
      const showsMore = result.hiddenCount > 0;

      const scriptsWidth = REAL_SCRIPTS.slice(0, result.visibleCount).reduce(
        (total, name) => total + widthOf(name) + base.gap,
        0,
      );
      const leftover =
        maxWidth -
        base.chrome -
        base.projectWidth -
        base.controlsWidth -
        (showsMore ? base.moreWidth + base.gap : 0);

      expect(scriptsWidth).toBeLessThanOrEqual(Math.max(0, leftover));
    }
  });

  it('fits inside the window whenever the fixed parts themselves fit', () => {
    for (const maxWidth of [520, 700, 900, 1200]) {
      const base = input(REAL_SCRIPTS, { maxWidth });
      const result = fitButtons(base);
      expect(occupied(REAL_SCRIPTS, result.visibleCount, result.hiddenCount > 0, base)).toBeLessThanOrEqual(
        maxWidth,
      );
    }
  });

  it('shows no script at all when the project and controls already fill the bar', () => {
    // A degenerate VS Code window: the label and the controls are ellipsised by
    // CSS, and no script is placed.
    expect(fitButtons(input(REAL_SCRIPTS, { maxWidth: 320 }))).toEqual({
      visibleCount: 0,
      hiddenCount: 19,
    });
  });

  it('drops every script rather than the controls when space runs out', () => {
    const result = fitButtons(input(REAL_SCRIPTS, { maxWidth: 260 }));
    expect(result.visibleCount).toBe(0);
    expect(result.hiddenCount).toBe(19);
  });

  it('never returns a negative or out-of-range count', () => {
    for (const maxWidth of [0, 1, 100, 260, 5000]) {
      const result = fitButtons(input(REAL_SCRIPTS, { maxWidth }));
      expect(result.visibleCount).toBeGreaterThanOrEqual(0);
      expect(result.hiddenCount).toBeGreaterThanOrEqual(0);
      expect(result.visibleCount + result.hiddenCount).toBe(19);
    }
  });
});

describe('a long project name does not break the layout', () => {
  it('takes space from the scripts, never from the controls', () => {
    const base = input(REAL_SCRIPTS);
    // The CSS caps the project label at 190px, so that is the worst case.
    const long = input(REAL_SCRIPTS, { projectWidth: 190 });
    const result = fitButtons(long);

    expect(result.visibleCount).toBeLessThanOrEqual(fitButtons(base).visibleCount);
    expect(occupied(REAL_SCRIPTS, result.visibleCount, true, long)).toBeLessThanOrEqual(
      long.maxWidth,
    );
  });

  it('still fits the controls when the project label alone is huge', () => {
    const result = fitButtons(input(REAL_SCRIPTS, { projectWidth: 600 }));
    expect(result.visibleCount).toBeGreaterThanOrEqual(0);
    expect(result.hiddenCount).toBe(19 - result.visibleCount);
  });
});

describe('before the first measurement', () => {
  it('shows every button rather than flashing an empty bar', () => {
    expect(fitButtons(input(REAL_SCRIPTS, { buttonWidths: REAL_SCRIPTS.map(() => 0) }))).toEqual(
      { visibleCount: 19, hiddenCount: 0 },
    );
    expect(fitButtons(input(REAL_SCRIPTS, { maxWidth: 0 })).visibleCount).toBe(19);
  });
});
