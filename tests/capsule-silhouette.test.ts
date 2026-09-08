import * as fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AddButtonForm } from '../src/renderer/components/AddButtonForm';
import { AnimatedPanel } from '../src/renderer/components/AnimatedPanel';
import { AuthorizePanel } from '../src/renderer/components/AuthorizePanel';
import { MorePanel } from '../src/renderer/components/MorePanel';
import { boundsAt, BOUNDS_STEPS } from '../src/main/bounds-animation';
import { THEME_TOKENS } from '../src/renderer/theme';
import type { Rect } from '../src/main/window-geometry';

const CSS = fs.readFileSync('src/renderer/styles.css', 'utf8');
const FORM = fs.readFileSync('src/renderer/components/AddButtonForm.tsx', 'utf8');
const APP = fs.readFileSync('src/renderer/App.tsx', 'utf8');

/** A rule's declarations, with the comments taken out. */
function rule(selector: string): string {
  const start = CSS.indexOf(selector + ' {');
  expect(start, selector).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** One declared property of a rule, or null when it is not declared at all. */
function declaration(selector: string, property: string): string | null {
  const match = new RegExp(`(?:^|;|\\{)\\s*${property}:\\s*([^;]+)`, 'm').exec(rule(selector));
  return match ? match[1]!.trim().replace(/\s+/g, ' ') : null;
}

/**
 * Every rule in the stylesheet whose selector reaches one of the elements that
 * fill the whole window, comments stripped.
 */
function rulesFor(selectors: readonly string[]): string[] {
  const blocks: string[] = [];
  const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(clean);
  while (match !== null) {
    const heads = match[1]!.split(',').map((head) => head.trim());
    if (heads.some((head) => selectors.includes(head))) blocks.push(match[2]!);
    match = pattern.exec(clean);
  }
  return blocks;
}

const NOOP = (): void => undefined;

/** The form, rendered for real: hooks run and the markup is the true output. */
function renderForm(expansionComplete: boolean): string {
  return renderToStaticMarkup(
    createElement(AddButtonForm, {
      onSubmit: async () => null,
      onBack: NOOP,
      expansionComplete,
    }),
  );
}

describe('nothing but the capsule is ever painted', () => {
  it('html, body and #root are transparent', () => {
    expect(declaration('html,\nbody', 'background')).toBe('transparent');
    expect(declaration('#root', 'background')).toBe('transparent');
  });

  it('and none of them carries a shadow, a filter or an opaque layer', () => {
    for (const block of rulesFor(['html', 'body', '#root', '*'])) {
      expect(block).not.toMatch(/box-shadow:/);
      expect(block).not.toMatch(/filter:/);
      // A background other than `transparent` on a full-window element would
      // be a rectangle the size of the window.
      const background = /background(?:-color)?:\s*([^;]+)/.exec(block);
      if (background) expect(background[1]!.trim()).toBe('transparent');
    }
  });

  it('no pseudo-element covers the window', () => {
    const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const pattern = /([^{}]*::(?:before|after))\s*\{([^{}]*)\}/g;
    let match = pattern.exec(clean);
    let checked = 0;
    while (match !== null) {
      const [, selector, body] = match;
      checked += 1;
      expect(selector!.trim()).not.toMatch(/^(html|body|#root|\.island)::/);
      expect(body).not.toMatch(/position:\s*fixed/);
      match = pattern.exec(clean);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('the capsule has no shadow left to be clipped', () => {
  it('every shadow on the capsule is inset, in both shapes', () => {
    const shadow = declaration('.island', 'box-shadow');
    expect(shadow).not.toBeNull();
    // Split on the commas that separate shadows, not the ones inside rgba().
    const parts = shadow!.split(/,(?![^(]*\))/).map((part) => part.trim());
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      expect(part, part).toMatch(/^inset /);
    }
    // An inset shadow cannot paint outside the border box, whatever the shape,
    // so neither the compact pill nor the expanded panel can be clipped.
    expect(declaration('.island--expanded', 'box-shadow')).toBeNull();
    expect(declaration('.island--collapsing', 'box-shadow')).toBeNull();
  });

  it('and the tokens behind it are inset hairlines, per theme', () => {
    for (const theme of ['dark', 'light'] as const) {
      expect(THEME_TOKENS[theme].insetTop, theme).toMatch(/^rgba\(/);
      expect(THEME_TOKENS[theme].insetBottom, theme).toMatch(/^rgba\(/);
    }
    expect(declaration('.island', 'box-shadow')).toContain('var(--di-inset-top)');
    expect(declaration('.island', 'box-shadow')).toContain('var(--di-inset-bottom)');
  });

  it('the visual surface keeps its radius in both shapes', () => {
    expect(declaration('.island', 'border-radius')).toBe('var(--di-radius-pill)');
    expect(declaration('.island--expanded', 'border-radius')).toBe('var(--di-radius)');
    expect(declaration(':root', '--di-radius-pill')).toBe('23px');
    expect(declaration(':root', '--di-capsule-height')).toBe('46px');
    expect(declaration('.island', 'overflow')).toBe('hidden');
    expect(declaration('.island', 'background')).toBe('var(--di-bg)');
  });

  it('and clipping the surface does not clip what has to escape it', () => {
    // A carried button leaves the scripts area, and the capsule stops clipping
    // for the length of a close so the panel can fade over the space it gave
    // back. The resize handles live inside the capsule, not outside it.
    const start = CSS.indexOf('body.di-reordering .bar__scripts');
    expect(start).toBeGreaterThan(-1);
    expect(CSS.slice(start, CSS.indexOf('}', start))).toContain('overflow: visible');
    expect(declaration('.island--collapsing', 'overflow')).toBe('visible');
    expect(declaration('.action:focus-visible', 'outline-offset')).toBe('1px');
    expect(Number(/z-index: (\d+)/.exec(rule('.resize'))?.[1])).toBeGreaterThan(0);
  });
});

describe('Add moves exactly like More', () => {
  it('both panels are the same component, so they cannot drift', () => {
    const more = MorePanel({
      buttons: [],
      offset: 0,
      onOpen: NOOP,
      onBack: NOOP,
      gestures: {
        onPointerDown: NOOP,
        onPointerMove: NOOP,
        onPointerUp: NOOP,
        onPointerCancel: NOOP,
        onLostPointerCapture: NOOP,
      },
      dragId: null,
      placeholder: null,
    });
    expect(more.type).toBe(AnimatedPanel);
    // The form runs hooks, so it is rendered for real; what comes out is the
    // very surface `AnimatedPanel` produces for a form.
    expect(renderForm(false).startsWith('<form class="panel"')).toBe(true);
    expect(renderToStaticMarkup(createElement(AnimatedPanel, { children: null, onSubmit: NOOP })))
      .toBe('<form class="panel"></form>');
    expect(
      AuthorizePanel({
        pending: { path: 'C:/x', name: 'x', buttons: [{ name: 'Dev', script: 'npm run dev' }] },
        onResolve: NOOP,
      }).type,
    ).toBe(AnimatedPanel);
    // The terminal cannot be rendered here — xterm needs a browser — so its
    // surface is checked where it is declared. No panel is left out.
    const process = fs.readFileSync('src/renderer/components/ProcessPanel.tsx', 'utf8');
    expect(process).toContain("import { AnimatedPanel } from './AnimatedPanel';");
    expect(process).toContain('<AnimatedPanel>');
    expect(process).not.toContain('className="panel"');
    for (const file of ['MorePanel', 'AddButtonForm', 'AuthorizePanel', 'ProcessPanel']) {
      const source = fs.readFileSync(`src/renderer/components/${file}.tsx`, 'utf8');
      expect(source, file).not.toContain('className="panel"');
    }
  });

  it('and that component is what carries the reveal', () => {
    expect(AnimatedPanel({ children: null }).props.className).toBe('panel');
    expect(AnimatedPanel({ children: null, onSubmit: NOOP }).props.className).toBe('panel');
    expect(AnimatedPanel({ children: null }).type).toBe('div');
    expect(AnimatedPanel({ children: null, onSubmit: NOOP }).type).toBe('form');
  });

  it('one curve and one duration, declared once for the surface', () => {
    expect(declaration('.panel', 'animation')).toBe(
      'di-panel-in var(--di-panel-in) var(--di-ease) both',
    );
    expect(declaration(':root', '--di-ease')).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
    expect(declaration(':root', '--di-panel-in')).toBe('200ms');
    const animations = [...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
    expect(animations).toContain('di-panel-in');
    expect(animations.filter((name) => name!.startsWith('di-panel'))).toEqual([
      'di-panel-in',
      'di-panel-out',
    ]);
  });

  it('the normalised progress of the bounds is identical for both', () => {
    const from: Rect = { x: 400, y: 152, width: 884, height: 48 };
    // "More" for 19 scripts and the form end at very different heights.
    const progressFor = (height: number): number[] => {
      const to: Rect = { ...from, height };
      return Array.from({ length: BOUNDS_STEPS }, (_unused, index) => {
        const step = boundsAt(from, to, (index + 1) / BOUNDS_STEPS);
        return (step.height - from.height) / (height - from.height);
      });
    };
    const form = progressFor(219);
    const more = progressFor(462);
    const terminal = progressFor(480);
    for (let index = 0; index < BOUNDS_STEPS; index += 1) {
      expect(Math.abs(form[index]! - more[index]!), `passo ${index}`).toBeLessThan(0.01);
      expect(Math.abs(form[index]! - terminal[index]!), `passo ${index}`).toBeLessThan(0.01);
    }
    // And it really is a curve, not a straight line: the first step of twelve
    // is already well past a twelfth of the way.
    expect(more[0]).toBeGreaterThan(0.25);
    expect(more.at(-1)).toBe(1);
  });
});

describe('the form arrives with the panel, not before it', () => {
  it('it starts see-through and ends opaque, like every panel', () => {
    const start = CSS.indexOf('@keyframes di-panel-in');
    const frames = CSS.slice(start, CSS.indexOf('}\n\n', start));
    expect(frames).toContain('opacity: 0');
    expect(frames).toContain('translate3d(0, -8px, 0)');
    expect(frames).toContain('opacity: 1');
    expect(frames).toContain('scale(1)');
    // `both` keeps the first frame's values before the animation starts, so
    // the panel is never painted opaque for a frame and then faded.
    expect(declaration('.panel', 'animation')).toContain('both');
  });

  it('the name field does not take focus while the panel is opening', () => {
    const markup = renderForm(false);
    expect(markup).toContain('class="field__input"');
    expect(markup).not.toContain('autofocus');
    expect(markup).not.toContain('autoFocus');
    expect(FORM).not.toContain('autoFocus');
    expect(renderForm(true)).not.toContain('autofocus');
  });

  it('it takes focus when the expansion reports that it finished', () => {
    expect(FORM).toContain('const nameField = useRef<HTMLInputElement>(null);');
    expect(FORM).toContain('ref={nameField}');
    expect(FORM).toContain('if (!expansionComplete) return;');
    expect(FORM).toContain('nameField.current?.focus();');
    expect(FORM).toContain('}, [expansionComplete]);');
    // No timer of its own: the App hands it the end of the phase.
    expect(FORM).not.toContain('setTimeout');
    expect(APP).toContain("expansionComplete={phase === 'expanded'}");
  });

  it('Cancel closes exactly the way Back does', () => {
    // Both are handed the same callback, which is the animated close.
    expect(renderForm(true)).toContain('Cancel');
    expect(APP).toContain('<AddButtonForm');
    expect(APP).toContain('onBack={back}');
    const back = APP.slice(APP.indexOf('const back = useCallback'), APP.indexOf('const toggle'));
    expect(back).toContain("setPhase('collapsing')");
    expect(back).toContain('PANEL_CLOSE_MS');
  });

  it('and saving still writes once, without waiting for the animation', () => {
    expect(FORM).toContain('const failure = await onSubmit(name, script);');
    expect(FORM.match(/await onSubmit\(/g)).toHaveLength(1);
    // The close is what happens after the write, never instead of it.
    expect(FORM.indexOf('await onSubmit(')).toBeLessThan(FORM.indexOf('onBack();'));
  });

  it('reduced motion still reaches the same states', () => {
    const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('.panel');
    expect(block).toContain('animation: none !important');
    // With no animation the phase still completes, so the field is still
    // focused — the focus follows the phase, not the animation.
    expect(APP).toContain("setPhase('expanded')");
  });
});

describe('what opening a panel is not allowed to touch', () => {
  it('the topbar keeps its width through the whole thing', () => {
    // The panel is out of the bar entirely, and the width the window uses is
    // measured from the compact bar alone.
    expect(declaration('.panel', 'width')).toBe('100%');
    expect(declaration('.panel', 'box-sizing')).toBe('border-box');
    const resize = fs.readFileSync('src/renderer/useAutoResize.ts', 'utf8');
    expect(resize).toContain('bridge.resizeWindow(baseWidth, height, animate)');
  });

  it('position, processes and the project file are untouched', () => {
    const panel = fs.readFileSync('src/renderer/components/AnimatedPanel.tsx', 'utf8');
    for (const forbidden of ['bridge', 'buttons.json', 'pty', 'setBounds']) {
      expect(panel, forbidden).not.toContain(forbidden);
    }
    // Opening or cancelling the form goes nowhere near the configuration.
    const cancelPath = FORM.slice(FORM.indexOf('const submit'), FORM.indexOf('return ('));
    expect(cancelPath).not.toContain('bridge.');
    // The only write the form can make is the one the App owns.
    expect(APP).toContain('const result = await bridge.addButton(name, script);');
  });
});
