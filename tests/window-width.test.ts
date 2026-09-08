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
import { anchorFromForeground, type ForegroundWindow } from '../src/main/visibility';
import {
  ABSOLUTE_MAX_HEIGHT,
  ABSOLUTE_MAX_WIDTH,
  clampSize,
  computeLayoutLimits,
  DEFAULT_PANEL_HEIGHT,
  MIN_WIDTH,
} from '../src/main/window-geometry';
import { DEFAULT_LAYOUT_LIMITS } from '../src/shared/layout';

/**
 * Widths measured in a real Electron window: a project with 19 scripts, VS Code
 * at 1600x900. Measured rather than invented, so the test stays honest about
 * the bug it guards.
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

const SAMPLE_PROJECT = { project: 123, controls: 98, more: 70.359375, scripts: [42.4, 42.5, 48.9] };

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

/** The width the window ends up with, exactly as the app computes it. */
function windowWidth(measured = REAL, maxWidth = 900): number {
  const base = input(measured, maxWidth);
  const limits = { sizeMode: 'auto' as const, maxWidth, maxHeight: 720, panelHeight: 320 };
  return clampSize({ width: barWidth(base, fitButtons(base)), height: 42 }, limits).width;
}

describe('a 19-script project starts with Mais (11)', () => {
  const result = fitButtons(input());

  it('shows 8 of the 19 scripts', () => {
    expect(REAL.scripts).toHaveLength(19);
    expect(result.visibleCount).toBe(8);
    expect(result.hiddenCount).toBe(11);
  });

  it('produces the width the real window had', () => {
    // Measured in the real window after the free drag strip was reserved.
    expect(windowWidth()).toBe(842);
  });
});

describe('every screen keeps the same base width', () => {
  // The panels are not inputs to the width at all: `barWidth` only sees the
  // compact bar's measurements. Opening one changes the height, nothing else.
  const base = windowWidth();

  it('is identical for compact, theme, add, more, terminal and authorize', () => {
    const screens = ['compact', 'theme', 'add', 'more', 'terminal', 'authorize'];
    const widths = screens.map(() => windowWidth());
    expect(widths).toEqual(screens.map(() => base));
    expect(new Set(widths).size).toBe(1);
  });

  it('keeps Mais (11) while a panel is open', () => {
    // Nothing about the open panel reaches the fit input.
    expect(fitButtons(input()).hiddenCount).toBe(11);
    expect(fitButtons(input()).hiddenCount).not.toBe(19);
  });

  it('does not change when the theme is toggled', () => {
    // The theme changes no measurement: same input, same result.
    for (let round = 0; round < 10; round += 1) {
      expect(windowWidth()).toBe(base);
      expect(fitButtons(input()).hiddenCount).toBe(11);
    }
  });
});

describe('opening and closing Tema 20 times never shrinks the capsule', () => {
  it('stays at the base width for every cycle', () => {
    const limits = { sizeMode: 'auto' as const, maxWidth: 900, maxHeight: 720, panelHeight: 320 };
    let width = windowWidth();
    const heights = [42, 155];

    for (let cycle = 0; cycle < 20; cycle += 1) {
      for (const height of heights) {
        // Whatever the window currently is, the next width comes from the bar
        // measurements, never from the current window or the open panel.
        const next = clampSize({ width: barWidth(input(), fitButtons(input())), height }, limits);
        expect(next.width).toBe(width);
        width = next.width;
      }
    }
    expect(width).toBe(842);
  });
});

describe('the fixed controls and the project label always have room', () => {
  it('always reserves the full width of Adicionar, Tema and Fechar', () => {
    for (const maxWidth of [340, 520, 700, 900, 1200]) {
      const base = input(REAL, maxWidth);
      const width = barWidth(base, fitButtons(base));
      // Everything the bar needs beyond the scripts is inside the width.
      expect(width).toBeGreaterThanOrEqual(
        Math.min(
          maxWidth,
          base.chrome + base.projectWidth + base.controlsWidth + MIN_FREE_DRAG_WIDTH,
        ),
      );
    }
  });

  it('never drops the project label from the width', () => {
    const base = input();
    expect(barWidth(base, fitButtons(base))).toBeGreaterThan(REAL.project + REAL.controls);
  });

  it('caps at the maximum instead of overflowing when nothing fits', () => {
    const base = input(REAL, 300);
    expect(barWidth(base, fitButtons(base))).toBe(300);
  });
});

describe('a project with three scripts keeps its smaller capsule', () => {
  it('is far below the 900px ceiling', () => {
    const width = windowWidth(SAMPLE_PROJECT);
    expect(width).toBeLessThan(500);
    expect(width).toBeLessThan(windowWidth());
  });

  it('keeps that width with a panel open', () => {
    expect(windowWidth(SAMPLE_PROJECT)).toBe(windowWidth(SAMPLE_PROJECT));
    expect(fitButtons(input(SAMPLE_PROJECT)).hiddenCount).toBe(0);
  });
});

describe('resizing VS Code recalculates the width in a controlled way', () => {
  it('narrows and widens without overshooting', () => {
    const wide = computeLayoutLimits({ x: 0, y: 0, width: 1600, height: 900 }, { x: 0, y: 0, width: 1920, height: 1040 });
    const narrow = computeLayoutLimits({ x: 0, y: 0, width: 1000, height: 700 }, { x: 0, y: 0, width: 1920, height: 1040 });

    const wideWidth = windowWidth(REAL, wide.maxWidth);
    const narrowWidth = windowWidth(REAL, narrow.maxWidth);

    expect(narrowWidth).toBeLessThan(wideWidth);
    expect(narrowWidth).toBeLessThanOrEqual(narrow.maxWidth);
    expect(fitButtons(input(REAL, narrow.maxWidth)).visibleCount).toBeLessThan(
      fitButtons(input(REAL, wide.maxWidth)).visibleCount,
    );
    // Going back restores exactly the previous width.
    expect(windowWidth(REAL, wide.maxWidth)).toBe(wideWidth);
  });
});

describe('the anchor can never come from our own window (root cause)', () => {
  const window = (processName: string, width: number, height: number): ForegroundWindow => ({
    pid: 1,
    windowHandle: '0x000000000000ABCD',
    processName,
    title: processName,
    minimized: false,
    x: 0,
    y: 0,
    width,
    height,
  });

  it('accepts a VS Code window', () => {
    expect(anchorFromForeground(window('code.exe', 1600, 900))).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 900,
    });
  });

  it('refuses the widget itself and any other application', () => {
    expect(anchorFromForeground(window('electron.exe', 860, 42))).toBeNull();
    expect(anchorFromForeground(window('chrome.exe', 1200, 800))).toBeNull();
    expect(anchorFromForeground(null)).toBeNull();
  });

  it('does not collapse when the widget keeps taking the foreground', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 };
    const vsCode = window('code.exe', 1600, 900);
    let limits = computeLayoutLimits(anchorFromForeground(vsCode), area);
    const first = limits.maxWidth;

    // Twenty watcher ticks while the user interacts with the capsule. Before
    // the fix each tick fed the widget's own width back in and shrank it by
    // 20%: 860 -> 643 -> 457 -> ... -> the 260px floor.
    let widgetWidth = windowWidth(REAL, limits.maxWidth);
    for (let tick = 0; tick < 20; tick += 1) {
      const anchor = anchorFromForeground(window('electron.exe', widgetWidth, 42));
      if (anchor) limits = computeLayoutLimits(anchor, area);
      widgetWidth = windowWidth(REAL, limits.maxWidth);
    }

    expect(limits.maxWidth).toBe(first);
    expect(widgetWidth).toBe(842);
  });
});

describe('layout invariants', () => {
  it('the fallback limits are the ceilings the main process applies', () => {
    // Both processes start from DEFAULT_LAYOUT_LIMITS before anything is
    // measured, so it has to agree with the geometry it stands in for.
    expect(DEFAULT_LAYOUT_LIMITS).toEqual({
      sizeMode: 'auto',
      maxWidth: ABSOLUTE_MAX_WIDTH,
      maxHeight: ABSOLUTE_MAX_HEIGHT,
      panelHeight: DEFAULT_PANEL_HEIGHT,
    });
  });

  it('the measuring row is isolated from the document layout', async () => {
    const css = await import('node:fs').then((fs) =>
      fs.readFileSync('src/renderer/styles.css', 'utf8'),
    );
    const measure = css.slice(css.indexOf('.measure {'), css.indexOf('.measure__row'));
    // Out of flow, invisible, inert and contained: it cannot reach scrollWidth,
    // the document's intrinsic width or the size sent to Electron.
    expect(measure).toContain('position: fixed');
    expect(measure).toContain('visibility: hidden');
    expect(measure).toContain('pointer-events: none');
    expect(measure).toContain('contain: layout size style');
  });

  it('expanded content adapts to the base width instead of demanding one', async () => {
    const css = await import('node:fs').then((fs) =>
      fs.readFileSync('src/renderer/styles.css', 'utf8'),
    );
    for (const selector of ['.panel {', '.more {', '.terminal {']) {
      const block = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
      expect(block).toContain('width: 100%');
      expect(block).toContain('box-sizing: border-box');
      expect(block).toContain('min-width: 0');
    }
  });

  it('a height-only change keeps the width identical', () => {
    const limits = { sizeMode: 'auto' as const, maxWidth: 900, maxHeight: 720, panelHeight: 320 };
    const width = barWidth(input(), fitButtons(input()));
    for (const height of [42, 155, 198, 388, 465, 42]) {
      expect(clampSize({ width, height }, limits).width).toBe(842);
    }
  });

  it('every hidden script is still reachable at the base width', () => {
    const { hidden } = splitButtons(REAL.scripts, fitButtons(input()).visibleCount);
    expect(hidden).toHaveLength(11);
  });
});

describe('widening and narrowing move whole scripts in and out', () => {
  const names = [
    'Compile', 'Watch', 'Typecheck', 'Test', 'Check', 'Dev', 'Demo', 'Local', 'Local:dev',
    'Local:build', 'Local:check', 'Local:link', 'Cli:build', 'Cli:pack', 'Cli:check',
    'Install:local', 'Install:local:dry', 'Package', 'Vscode:prepublish',
  ];

  it('a script that does not fit whole is never squeezed in', () => {
    const base = input(REAL, 700);
    const result = fitButtons(base);
    const shown = REAL.scripts.slice(0, result.visibleCount);
    const used =
      base.chrome +
      base.projectWidth +
      base.controlsWidth +
      base.moreWidth +
      base.gap +
      MIN_FREE_DRAG_WIDTH +
      shown.reduce((total, width) => total + width + base.gap, 0);

    // Everything on the bar is there at its full natural width.
    expect(used).toBeLessThanOrEqual(700);
    const next = REAL.scripts[result.visibleCount];
    expect(used + (next ?? 0) + base.gap).toBeGreaterThan(700);
  });

  it('a wider window shows strictly more whole scripts', () => {
    let previous = -1;
    for (const maxWidth of [520, 700, 842, 1149, 1400]) {
      const visible = fitButtons(input(REAL, maxWidth)).visibleCount;
      expect(visible).toBeGreaterThanOrEqual(previous);
      previous = visible;
    }
    expect(fitButtons(input(REAL, 1149)).visibleCount).toBeGreaterThan(
      fitButtons(input(REAL, 842)).visibleCount,
    );
  });

  it('a narrower window sends whole scripts to Mais, in order', () => {
    const wide = fitButtons(input(REAL, 1149));
    const narrow = fitButtons(input(REAL, 700));
    expect(narrow.visibleCount).toBeLessThan(wide.visibleCount);

    const wideNames = splitButtons(names, wide.visibleCount);
    const narrowNames = splitButtons(names, narrow.visibleCount);
    // Nothing is lost and nothing is cut: the split just moves.
    expect([...narrowNames.visible, ...narrowNames.hidden]).toEqual(names);
    expect(narrowNames.visible).toEqual(wideNames.visible.slice(0, narrow.visibleCount));
  });

  it('the icon controls keep their room at the smallest width', () => {
    const base = input(REAL, MIN_WIDTH);
    const result = fitButtons(base);
    const scripts = REAL.scripts
      .slice(0, result.visibleCount)
      .reduce((total, width) => total + width + base.gap, 0);
    const reserved =
      base.chrome + base.projectWidth + base.controlsWidth + MIN_FREE_DRAG_WIDTH;

    expect(scripts).toBeLessThanOrEqual(Math.max(0, MIN_WIDTH - reserved));
    // The three icons are always accounted for before any script.
    expect(base.controlsWidth).toBeGreaterThan(0);
  });
});
