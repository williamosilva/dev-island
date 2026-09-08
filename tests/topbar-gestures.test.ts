import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync('src/renderer/styles.css', 'utf8');
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '');
const flat = css.replace(/\s+/g, ' ');

const source = (relative: string): string => fs.readFileSync(relative, 'utf8');

/** The same file without comments, so prose about a rule cannot satisfy it. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const bar = source('src/renderer/components/CompactBar.tsx');
const grip = source('src/renderer/components/Grip.tsx');
const icon = source('src/renderer/components/IconButton.tsx');
const more = source('src/renderer/components/MorePanel.tsx');
const controller = source('src/renderer/useTopbarGestures.ts');
const app = source('src/renderer/App.tsx');

function rule(selector: string): string {
  const start = css.indexOf(selector + ' {');
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('free areas move the window', () => {
  it('the bar is marked free, so any spot without a control moves it', () => {
    expect(bar).toContain('{...gestures}');
    expect(bar).toContain('className="bar"');
    expect(bar).toContain("[GESTURE_ATTRIBUTE]: 'free'");
  });

  it('the grip and the elastic gap are free areas too', () => {
    expect(grip).toContain("[GESTURE_ATTRIBUTE]: 'free'");
    expect(bar).toContain('className="bar__gap"');
    expect(rule('.bar__gap')).toContain('flex: 1 0 auto');
    expect(rule('.bar__gap')).toContain('min-width: var(--di-free-drag-width)');
  });

  it('the project name inherits the free area, setting no role of its own', () => {
    expect(bar).toContain('className="bar__project"');
    expect(rule('.bar__project')).not.toContain('cursor');
  });
});

describe('cursors', () => {
  it('free areas offer grab', () => {
    expect(rule('.bar')).toContain('cursor: grab');
    expect(rule('.grip')).toContain('cursor: grab');
  });

  it('the gesture keeps grabbing everywhere while it runs', () => {
    const start = css.indexOf('body.di-gesturing');
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('cursor: grabbing !important');
    expect(block).toContain('body.di-gesturing *');
  });

  it('actions keep the pointer cursor, borders keep theirs', () => {
    expect(rule('.action')).toContain('cursor: pointer');
    expect(rule('.icon-button')).toContain('cursor: pointer');
    // A row of "Mais" is clicked to run and dragged to reorder; the click is
    // the main action, so it reads `pointer` like a script button.
    expect(rule('.more__item')).toContain('cursor: pointer');
    expect(rule('.action--script')).toContain('cursor: pointer');
    expect(flat).toContain('.resize--e, .resize--w { top: 0; width: 6px; height: 100%; cursor: ew-resize');
  });
});

describe('controls never move the window', () => {
  it('every interactive control is marked block', () => {
    expect(icon).toContain("[GESTURE_ATTRIBUTE]: 'block'");
    expect(bar).toContain("[GESTURE_ATTRIBUTE]: 'block'");
    expect(more).toContain("[GESTURE_ATTRIBUTE]: 'block'");
  });

  it('a press on a blocked element starts no gesture at all', () => {
    expect(controller).toContain("if (!role || role === 'block') return;");
  });

  it('the fixed controls stay after the scripts, in a group that never flexes', () => {
    const barMarkup = bar.slice(bar.indexOf('<div className="bar"'));
    expect(barMarkup.indexOf('bar__controls')).toBeGreaterThan(barMarkup.indexOf('bar__scripts'));
    expect(rule('.bar__controls')).toContain('flex: 0 0 auto');
  });
});

describe('telling the three gestures apart', () => {
  it('a press that never crosses the threshold stays a click', () => {
    expect(controller).toContain('if (travelled < GESTURE_THRESHOLD_PX) return;');
    const bare = code(controller);
    const down = bare.slice(bare.indexOf('const onPointerDown'), bare.indexOf('const onPointerMove'));
    // Neither the default action nor the pointer is taken on pointerdown,
    // which is what keeps the click and the grip double click working.
    expect(down).not.toContain('preventDefault');
    expect(down).not.toContain('setPointerCapture');
    // They are taken once the threshold is crossed.
    expect(bare.slice(bare.indexOf('const onPointerMove'))).toContain('setPointerCapture');
  });

  it('a reorder swallows the click that follows it', () => {
    expect(controller).toContain('reordered.current = true;');
    expect(controller).toContain('const consumeClick');
    expect(app).toContain('if (gestures.consumeClick()) return;');
  });

  it('the suppression never survives into the next press', () => {
    // Otherwise a reorder whose trailing click never arrived would swallow the
    // next legitimate click on a script.
    const down = code(controller).slice(
      code(controller).indexOf('const onPointerDown'),
      code(controller).indexOf('const onPointerMove'),
    );
    expect(down).toContain('reordered.current = false;');
  });

  it('a gesture started on a script never moves the window', () => {
    const bare = code(controller);
    const start = bare.indexOf("if (role === 'reorder'");
    const reorderBranch = bare.slice(start, bare.indexOf("kind: 'move',", start));
    // The reorder branch returns before the move gesture is ever set up.
    expect(reorderBranch).toContain('return;');
    expect(bare).toContain("if (current.kind === 'move') {");
  });

  it('the order is written once, when the pointer is released', () => {
    const finish = controller.slice(
      controller.indexOf('const finish'),
      controller.indexOf('const consumeClick'),
    );
    expect(finish.match(/onReorder\(/g)).toHaveLength(1);
    const move = controller.slice(
      controller.indexOf('const onPointerMove'),
      controller.indexOf('const finish'),
    );
    expect(move).not.toContain('onReorder(');
  });
});

describe('panels, borders and no native drag', () => {
  it('the rows of Mais join the same ordered list', () => {
    expect(more).toContain("[GESTURE_ATTRIBUTE]: 'reorder'");
    expect(more).toContain('data-reorder-index={index}');
    expect(more).toContain('data-reorder-axis="vertical"');
    expect(more).toContain('const index = offset + position;');
    expect(app).toContain('offset={visibleCount}');
  });

  it('the resize handles sit above the bar, so the borders win', () => {
    expect(Number(/z-index: (\d+)/.exec(rule('.resize'))?.[1])).toBeGreaterThan(0);
    expect(app).toContain('<ResizeHandles resizableHeight={resizableHeight} />');
  });

  it('no native drag region is reintroduced', () => {
    expect(cssRules).not.toMatch(/-webkit-app-region:\s*drag\s*;/);
    for (const file of [bar, grip, icon, more, controller]) {
      expect(code(file)).not.toContain('app-region');
    }
  });

  it('only script buttons and rows are reorderable', () => {
    expect(bar).toContain("[GESTURE_ATTRIBUTE]: 'reorder'");
    expect(code(grip)).not.toContain('reorder');
    expect(code(icon)).not.toContain('reorder');
    const barCode = code(bar);
    const controls = barCode.slice(barCode.indexOf('<div className="bar__controls">'));
    expect(controls).not.toContain('reorder');
  });
});
