import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  barWidth,
  BAR_CHROME,
  BAR_GAP,
  fitButtons,
  MIN_FREE_DRAG_WIDTH,
  splitButtons,
  type FitInput,
} from '../src/renderer/fit';
import { clampSize, computeLayoutLimits, MIN_WIDTH } from '../src/main/window-geometry';
import { FREE_DRAG_WIDTH_VARIABLE } from '../src/shared/layout';

/**
 * The topbar keeps a strip of empty space before the "Mais (N)" separator and
 * the fixed controls that exists only to be grabbed. These tests pin the
 * reservation down at each layer it touches: the fit algorithm, the window
 * width, the stylesheet and the gesture roles.
 *
 * The widths come from a real Electron window: a project with 19 scripts, VS
 * Code at 1600x900. The strip widths in "measured in the real window" below
 * were read back with `getBoundingClientRect()`.
 */
const REAL = {
  project: 125.0625,
  controls: 98,
  more: 70.359375,
  scripts: [
    65.953125, 55.25, 76.890625, 42.5625, 54.015625, 42.4375, 54.0625, 49.234375, 70.9375,
    78.5625, 81.953125, 70.40625, 64.578125, 62.515625, 67.96875, 80.15625, 99.8125, 65.375,
    118.78125,
  ],
};

const FEW = {
  ...REAL,
  scripts: [65.953125, 55.25, 76.890625],
};

/** Widths where the bar can pay for every named part out of the ceiling. */
const ROOMY = [400, 460, 520, 700, 842, 900, 1149, 1400, 1900];

const CSS = readFileSync('src/renderer/styles.css', 'utf8');
const APP = readFileSync('src/renderer/App.tsx', 'utf8');
const BAR = readFileSync('src/renderer/components/CompactBar.tsx', 'utf8');
const GEOMETRY = readFileSync('src/main/window-geometry.ts', 'utf8');
const FIT = readFileSync('src/renderer/fit.ts', 'utf8');

/** A source file without its comments. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function rule(selector: string): string {
  const start = CSS.indexOf(selector + ' {');
  expect(start, selector).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf('}', start));
}

/** The `<span className="bar__gap" />` element, attributes included. */
const GAP_ELEMENT = BAR.slice(BAR.indexOf('bar__gap'), BAR.indexOf('>', BAR.indexOf('bar__gap')) + 1);

function input(measured = REAL, maxWidth = 900): FitInput {
  return {
    maxWidth,
    projectWidth: measured.project,
    controlsWidth: measured.controls,
    moreWidth: measured.more,
    buttonWidths: measured.scripts,
    gap: BAR_GAP,
    chrome: BAR_CHROME,
  };
}

/** What the scripts on the bar cost, their gaps included. */
function scriptsWidth(measured: typeof REAL, visibleCount: number): number {
  return measured.scripts
    .slice(0, visibleCount)
    .reduce((total, width) => total + width + BAR_GAP, 0);
}

/**
 * The space the computed width leaves for the strip once every other part of
 * the bar is paid for.
 */
function reserved(measured: typeof REAL, maxWidth: number): number {
  const base = input(measured, maxWidth);
  const fit = fitButtons(base);
  const separator = fit.hiddenCount > 0 ? base.moreWidth + BAR_GAP : 0;
  return (
    barWidth(base, fit) -
    base.chrome -
    base.projectWidth -
    base.controlsWidth -
    separator -
    scriptsWidth(measured, fit.visibleCount)
  );
}

describe('the free drag strip never gets smaller than 28px', () => {
  it('is one constant, in one module, that every layer imports', () => {
    expect(MIN_FREE_DRAG_WIDTH).toBe(28);
    for (const source of [FIT, GEOMETRY, APP]) {
      expect(source).toContain('MIN_FREE_DRAG_WIDTH');
      expect(source).toContain("shared/layout");
    }
  });

  it('is reserved at every width where the bar fits its named parts', () => {
    for (const maxWidth of ROOMY) {
      expect(reserved(REAL, maxWidth), `at ${maxWidth}px`).toBeGreaterThanOrEqual(
        MIN_FREE_DRAG_WIDTH,
      );
    }
  });

  it('is held by the style at the floor, where the ceiling is the binding limit', () => {
    // At MIN_WIDTH a 125px project label plus "Mais (19)" plus three icons
    // cannot all keep their natural width, so the computed width is clamped
    // and the arithmetic alone no longer guarantees the strip. `min-width` on
    // `.bar__gap` does: measured 28px in the real window at 348px.
    expect(barWidth(input(REAL, MIN_WIDTH), fitButtons(input(REAL, MIN_WIDTH)))).toBe(MIN_WIDTH);
    expect(rule('.bar__gap')).toContain(`min-width: var(${FREE_DRAG_WIDTH_VARIABLE})`);
    // `flex: 1 0 auto` grows into spare room but never shrinks below it.
    expect(rule('.bar__gap')).toContain('flex: 1 0 auto');
  });

  it('publishes the constant into the stylesheet so the two cannot drift', () => {
    expect(APP).toContain('FREE_DRAG_WIDTH_VARIABLE');
    expect(APP).toContain('${MIN_FREE_DRAG_WIDTH}px');
    expect(rule(':root')).toContain(`${FREE_DRAG_WIDTH_VARIABLE}: ${MIN_FREE_DRAG_WIDTH}px`);
  });
});

describe('the fit calculation reserves the strip before including scripts', () => {
  it('takes it out of the budget, so one fewer script fits', () => {
    const base = input(REAL, 900);
    expect(fitButtons(base).visibleCount).toBe(8);
    // The same ceiling with the strip handed back to the scripts fits nine.
    expect(fitButtons({ ...base, maxWidth: 900 + MIN_FREE_DRAG_WIDTH }).visibleCount).toBe(9);
  });

  it('reserves it even when not a single script fits', () => {
    const huge = { ...REAL, scripts: [900] };
    expect(fitButtons(input(huge, 900)).visibleCount).toBe(0);
    expect(reserved(huge, 900)).toBeGreaterThanOrEqual(MIN_FREE_DRAG_WIDTH);
  });

  it('is inside barWidth, not added to the window afterwards', () => {
    const base = input(FEW, 900);
    const fit = fitButtons(base);
    expect(fit.hiddenCount).toBe(0);
    expect(barWidth(base, fit)).toBe(
      Math.ceil(
        base.chrome +
          base.projectWidth +
          base.controlsWidth +
          MIN_FREE_DRAG_WIDTH +
          scriptsWidth(FEW, fit.visibleCount),
      ),
    );
  });
});

describe('a whole script goes to Mais when it would eat the strip', () => {
  it('moves the ninth script out instead of shrinking the reservation', () => {
    const fit = fitButtons(input(REAL, 900));
    const { visible, hidden } = splitButtons(REAL.scripts, fit.visibleCount);
    expect(visible).toHaveLength(8);
    expect(hidden[0]).toBe(REAL.scripts[8]);
    // That script would have fitted in the strip's space, which is precisely
    // why it is not on the bar: the strip wins the tie.
    const spare = 900 - barWidth(input(REAL, 900), fit);
    expect(spare + MIN_FREE_DRAG_WIDTH).toBeGreaterThanOrEqual(REAL.scripts[8]! + BAR_GAP);
  });

  it('never leaves a partial script on the bar to make room', () => {
    for (const maxWidth of [MIN_WIDTH, ...ROOMY]) {
      const base = input(REAL, maxWidth);
      const fit = fitButtons(base);
      const shown = REAL.scripts.slice(0, fit.visibleCount);
      expect(shown.every((width, index) => width === REAL.scripts[index])).toBe(true);
      expect(fit.visibleCount + fit.hiddenCount).toBe(REAL.scripts.length);
    }
  });

  it('does not truncate: script buttons keep their natural width', () => {
    const action = rule('.action');
    expect(action).not.toContain('text-overflow');
    expect(action).not.toContain('max-width');
    expect(action).toContain('white-space: nowrap');
  });
});

describe('Mais (N) is recalculated with the reservation in place', () => {
  it('reports 11 hidden scripts for the 19-script project', () => {
    const fit = fitButtons(input(REAL, 900));
    expect(fit.hiddenCount).toBe(11);
    expect(splitButtons(REAL.scripts, fit.visibleCount).hidden).toHaveLength(11);
  });

  it('always equals the number of scripts that are not on the bar', () => {
    for (const maxWidth of [MIN_WIDTH, ...ROOMY]) {
      const fit = fitButtons(input(REAL, maxWidth));
      const { visible, hidden } = splitButtons(REAL.scripts, fit.visibleCount);
      expect(hidden).toHaveLength(fit.hiddenCount);
      expect([...visible, ...hidden]).toEqual(REAL.scripts);
    }
  });

  it('does not reserve the separator when nothing is hidden', () => {
    const base = input(FEW, 900);
    const fit = fitButtons(base);
    expect(fit.hiddenCount).toBe(0);
    expect(barWidth(base, fit)).toBeLessThan(
      base.chrome +
        base.projectWidth +
        base.controlsWidth +
        MIN_FREE_DRAG_WIDTH +
        base.moreWidth +
        scriptsWidth(FEW, fit.visibleCount),
    );
  });
});

describe('the strip never causes horizontal overflow', () => {
  it('keeps the computed width within the ceiling at every size', () => {
    for (const maxWidth of [300, MIN_WIDTH, 340, ...ROOMY]) {
      const base = input(REAL, maxWidth);
      expect(barWidth(base, fitButtons(base)), `at ${maxWidth}px`).toBeLessThanOrEqual(maxWidth);
    }
  });

  it('fits every part of the bar inside the width it asks for', () => {
    for (const maxWidth of ROOMY) {
      const base = input(REAL, maxWidth);
      const fit = fitButtons(base);
      const separator = fit.hiddenCount > 0 ? base.moreWidth + BAR_GAP : 0;
      const needed =
        base.chrome +
        base.projectWidth +
        base.controlsWidth +
        separator +
        MIN_FREE_DRAG_WIDTH +
        scriptsWidth(REAL, fit.visibleCount);
      expect(needed).toBeLessThanOrEqual(maxWidth);
    }
  });

  it('cannot push past the ceiling to create the strip', () => {
    // 300px is below MIN_WIDTH: the width clamps down instead of growing.
    const base = input(REAL, 300);
    expect(barWidth(base, fitButtons(base))).toBe(300);
    expect(fitButtons(base).visibleCount).toBe(0);
  });

  it('lets the project label yield at the floor instead of overflowing', () => {
    // The label can shrink to its ellipsis, which is the only reason the bar
    // fits at MIN_WIDTH once the strip is reserved. With `flex: 0 0 auto` on
    // the lead block the real window overflowed horizontally at 348px.
    expect(rule('.bar__lead')).toContain('flex: 0 1 auto');
    expect(rule('.bar__lead')).toContain('min-width: 0');
    const project = rule('.bar__project');
    expect(project).toContain('min-width: 0');
    expect(project).toContain('text-overflow: ellipsis');
    expect(rule('.grip')).toContain('flex: 0 0 auto');
  });

  it('lets the scripts area shrink rather than scroll the bar', () => {
    expect(rule('.bar__scripts')).toContain('min-width: 0');
    expect(rule('.bar__scripts')).toContain('overflow: hidden');
    expect(rule('.island')).toContain('overflow: hidden');
  });
});

describe('the fixed controls stay visible with the strip reserved', () => {
  it('accounts for the icon controls before any script, at every width', () => {
    for (const maxWidth of [MIN_WIDTH, ...ROOMY]) {
      const base = input(REAL, maxWidth);
      expect(barWidth(base, fitButtons(base))).toBeGreaterThanOrEqual(
        Math.min(
          maxWidth,
          base.chrome + base.projectWidth + base.controlsWidth + MIN_FREE_DRAG_WIDTH,
        ),
      );
    }
  });

  it('includes the strip in the minimum window width', () => {
    const block = GEOMETRY.slice(
      GEOMETRY.indexOf('export const MIN_WIDTH'),
      GEOMETRY.indexOf(';', GEOMETRY.indexOf('export const MIN_WIDTH')),
    );
    expect(block).toContain('MIN_FREE_DRAG_WIDTH');
    expect(MIN_WIDTH).toBe(348);
  });

  it('keeps the controls out of the shrinking part of the bar', () => {
    expect(rule('.bar__controls')).toContain('flex: 0 0 auto');
  });
});

describe('the strip exists with few scripts and with all 19', () => {
  it('is there when only three scripts exist and room is left over', () => {
    const fit = fitButtons(input(FEW, 900));
    expect(fit.visibleCount).toBe(3);
    expect(fit.hiddenCount).toBe(0);
    expect(reserved(FEW, 900)).toBeGreaterThanOrEqual(MIN_FREE_DRAG_WIDTH);
  });

  it('is there with 19 scripts, where the space is actually contested', () => {
    expect(REAL.scripts).toHaveLength(19);
    expect(fitButtons(input(REAL, 900)).hiddenCount).toBeGreaterThan(0);
    expect(reserved(REAL, 900)).toBeGreaterThanOrEqual(MIN_FREE_DRAG_WIDTH);
  });

  it('is there for one script, one very wide script and none at all', () => {
    const one = { ...REAL, scripts: [65.953125] };
    const wide = { ...REAL, scripts: [420] };
    const none = { ...REAL, scripts: [] as number[] };
    for (const measured of [one, wide, none]) {
      expect(reserved(measured, 900)).toBeGreaterThanOrEqual(MIN_FREE_DRAG_WIDTH);
    }
    const base = input(none, 900);
    expect(barWidth(base, fitButtons(base))).toBe(
      Math.ceil(base.chrome + base.projectWidth + base.controlsWidth + MIN_FREE_DRAG_WIDTH),
    );
  });
});

describe('the strip holds in auto mode and after a manual resize', () => {
  const limits = (sizeMode: 'auto' | 'manual', maxWidth: number) => ({
    sizeMode,
    maxWidth,
    maxHeight: 720,
    panelHeight: 320,
  });

  it('holds in auto mode as VS Code is resized', () => {
    for (const maxWidth of ROOMY) {
      const base = input(REAL, maxWidth);
      const width = clampSize(
        { width: barWidth(base, fitButtons(base)), height: 42 },
        limits('auto', maxWidth),
      ).width;
      expect(width).toBeLessThanOrEqual(maxWidth);
      expect(reserved(REAL, maxWidth)).toBeGreaterThanOrEqual(MIN_FREE_DRAG_WIDTH);
    }
  });

  it('holds after the user drags the window narrower or wider', () => {
    // A manual width is a hard ceiling for the fit exactly like the automatic
    // one, so the reservation applies to it unchanged. These are the widths
    // measured in the real window: 400 -> 58px, 460 -> 52px, 520 -> 52px,
    // 1200 -> 78px, all at or above the 28px minimum.
    for (const manual of [400, 460, 520, 842, 1200]) {
      const base = input(REAL, manual);
      const fit = fitButtons(base);
      expect(barWidth(base, fit)).toBeLessThanOrEqual(manual);
      expect(reserved(REAL, manual)).toBeGreaterThanOrEqual(MIN_FREE_DRAG_WIDTH);
      expect(fit.visibleCount + fit.hiddenCount).toBe(19);
    }
  });

  it('never lets a manual width drop below the reserved minimum', () => {
    // A width dragged narrower than the floor is raised back to MIN_WIDTH,
    // which now includes the strip, before it ever reaches the window.
    const tiny = computeLayoutLimits(
      { x: 0, y: 0, width: 1600, height: 900 },
      { x: 0, y: 0, width: 1920, height: 1040 },
      { sizeMode: 'manual', manualWidth: 120, panelHeight: null },
    );
    expect(tiny.maxWidth).toBe(MIN_WIDTH);
    expect(clampSize({ width: 120, height: 42 }, tiny).width).toBe(MIN_WIDTH);
    expect(MIN_WIDTH).toBeGreaterThan(MIN_FREE_DRAG_WIDTH);
  });

  it('migrates whole scripts to Mais as the width narrows, and back', () => {
    const wide = fitButtons(input(REAL, 1200));
    const narrow = fitButtons(input(REAL, 520));
    expect(narrow.visibleCount).toBeLessThan(wide.visibleCount);
    expect(narrow.hiddenCount).toBeGreaterThan(wide.hiddenCount);
    expect(fitButtons(input(REAL, 1200)).visibleCount).toBe(wide.visibleCount);
  });
});

describe('the strip survives the terminal, Adicionar and Mais', () => {
  it('is unaffected by the open panel, which never reaches the fit input', () => {
    // `barWidth` only sees the compact bar's measurements; there is no panel
    // input at all, so every screen keeps the same strip.
    const width = barWidth(input(REAL, 900), fitButtons(input(REAL, 900)));
    for (const _screen of ['compact', 'terminal', 'add', 'more', 'theme', 'authorize']) {
      expect(barWidth(input(REAL, 900), fitButtons(input(REAL, 900)))).toBe(width);
      expect(reserved(REAL, 900)).toBeGreaterThanOrEqual(MIN_FREE_DRAG_WIDTH);
    }
  });

  it('lives in the compact bar, between the scripts and the separator', () => {
    const gapIndex = BAR.lastIndexOf('bar__gap');
    expect(gapIndex).toBeGreaterThan(-1);
    expect(BAR.slice(0, gapIndex)).toContain('.bar__scripts'.slice(1));
    const rest = BAR.slice(gapIndex);
    expect(rest.indexOf('"sep"')).toBeGreaterThan(-1);
    expect(rest.indexOf('bar__controls')).toBeGreaterThan(rest.indexOf('"sep"'));
  });

  it('keeps its full height so the whole strip is grabbable', () => {
    expect(rule('.bar__gap')).toContain('align-self: stretch');
  });
});

describe('dragging the strip moves the window and never reorders', () => {
  it('carries no reorder data, so it cannot be taken for a script', () => {
    expect(GAP_ELEMENT).not.toContain('data-reorder-id');
    expect(GAP_ELEMENT).not.toContain('data-reorder-index');
  });

  it('inherits the bar free role, which is what moves the window', () => {
    // No gesture attribute of its own: `closest('[data-di-gesture]')` from the
    // strip reaches the bar, marked `free`.
    expect(GAP_ELEMENT).not.toContain('data-di-gesture');
    expect(GAP_ELEMENT).not.toContain('GESTURE_ATTRIBUTE');
    expect(BAR).toContain("[GESTURE_ATTRIBUTE]: 'free'");
    expect(BAR).toContain('{...gestures}');
  });

  it('is not a button and runs nothing', () => {
    expect(GAP_ELEMENT).not.toContain('onClick');
    expect(GAP_ELEMENT.startsWith('bar__gap')).toBe(true);
  });

  it('shows the same grab cursor as the rest of the drag surface', () => {
    expect(rule('.bar__gap')).not.toContain('cursor');
    expect(rule('.bar')).toContain('cursor: grab');
  });

  it('does not reintroduce the native drag region', () => {
    // Comments stripped, so prose explaining why it is banned cannot fail the
    // assertion and cannot satisfy it either.
    for (const source of [CSS, BAR, APP]) {
      expect(code(source)).not.toContain('app-region: drag');
    }
  });
});
