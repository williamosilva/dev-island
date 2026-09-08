import * as fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { normalizeProjectPath, windowStateFile } from '../src/core/paths';
import { THEME_TOKENS } from '../src/renderer/theme';
import type { Anchor } from '../src/main/visibility';
import {
  clampToArea,
  DEFAULT_TOP_OFFSET,
  defaultPosition,
  resolvePosition,
  toPlacement,
  type Rect,
} from '../src/main/window-geometry';
import { WindowPlacement } from '../src/main/window-placement';
import { WindowStateStore } from '../src/main/window-state';
import { CAPSULE_ENTRY_MS } from '../src/renderer/useCapsuleEntry';
import { makeTempDir, removeTempDirs } from './helpers';

afterEach(() => removeTempDirs());

const CSS = fs.readFileSync('src/renderer/styles.css', 'utf8');
const APP = fs.readFileSync('src/renderer/App.tsx', 'utf8');
const ENTRY = fs.readFileSync('src/renderer/useCapsuleEntry.ts', 'utf8');
const PLACEMENT = fs.readFileSync('src/main/window-placement.ts', 'utf8');
const WINDOW = fs.readFileSync('src/main/widget-window.ts', 'utf8');

const PROJECT_A = 'C:/projetos/agent-rules-lens';
const PROJECT_B = 'C:/projetos/outro-projeto';

/** A 1920x1080 monitor, minus the taskbar. */
const SCREEN: Rect = { x: 0, y: 0, width: 1920, height: 1040 };

/** The rectangle of a VS Code window, which is all an anchor is. */
function vsCode(x: number, y: number, width = 1400, height = 900): Anchor {
  return { x, y, width, height };
}

/** The capsule, at the size the renderer measured for a 19-script project. */
const CAPSULE = { width: 842, height: 46 };

function rule(selector: string): string {
  const start = CSS.indexOf(selector + ' {');
  expect(start, selector).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf('}', start));
}

/** A window that only records what was done to it. */
function fakeWindow(bounds = { x: 0, y: 0, ...CAPSULE }) {
  const state = { ...bounds, visible: false };
  const calls: string[] = [];
  const window = {
    isDestroyed: () => false,
    isVisible: () => state.visible,
    getBounds: () => ({ ...state }),
    setBounds: (next: Partial<typeof state>) => {
      Object.assign(state, next);
      calls.push(`bounds ${state.x},${state.y} ${state.width}x${state.height}`);
    },
    setPosition: (x: number, y: number) => {
      state.x = x;
      state.y = y;
      calls.push(`position ${x},${y}`);
    },
    showInactive: () => {
      state.visible = true;
      calls.push(`show ${state.x},${state.y}`);
    },
    hide: () => {
      state.visible = false;
      calls.push('hide');
    },
    setAlwaysOnTop: () => undefined,
  };
  return { window, state, calls };
}

function setup(project: string | null = PROJECT_A, dataDir = makeTempDir('dev-island-place-')) {
  const store = new WindowStateStore(dataDir, { debounceMs: 0 });
  const view = fakeWindow();
  const clock = { value: 1_000_000 };
  const placement = new WindowPlacement(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => view.window as any,
    store,
    { now: () => clock.value },
  );
  placement.setProject(project);
  /**
   * Move past the grace period that tells our own moves from a drag, so the
   * next `handleMoved` counts as the user dragging the capsule.
   */
  const drag = (x: number, y: number): void => {
    clock.value += 10_000;
    view.window.setPosition(x, y);
    placement.handleMoved();
  };
  return { placement, store, view, dataDir, clock, drag };
}

describe('a project with no position of its own starts at the top centre', () => {
  it('is centred on the VS Code window, not on the editor', () => {
    const anchor = vsCode(200, 100);
    const position = defaultPosition(CAPSULE, anchor, SCREEN);
    expect(position.x + CAPSULE.width / 2).toBe(anchor.x + anchor.width / 2);
    expect(position.y).toBeLessThan(anchor.y + anchor.height / 4);
  });

  it('sits exactly DEFAULT_TOP_OFFSET below the top of the window', () => {
    expect(DEFAULT_TOP_OFFSET).toBe(72);
    for (const [x, y] of [
      [0, 0],
      [200, 100],
      [640, 260],
    ]) {
      const anchor = vsCode(x!, y!);
      expect(defaultPosition(CAPSULE, anchor, SCREEN).y).toBe(y! + DEFAULT_TOP_OFFSET);
    }
    const geometry = fs.readFileSync('src/main/window-geometry.ts', 'utf8');
    expect(geometry.match(/export const DEFAULT_TOP_OFFSET/g)).toHaveLength(1);
    const body = geometry.slice(
      geometry.indexOf('export function defaultPosition'),
      geometry.indexOf('export function resolvePosition'),
    );
    expect(body).toContain('DEFAULT_TOP_OFFSET');
  });

  it('needs the measured width, so the centre is exact', () => {
    const anchor = vsCode(200, 100);
    const narrow = defaultPosition({ width: 400, height: 46 }, anchor, SCREEN);
    const wide = defaultPosition({ width: 842, height: 46 }, anchor, SCREEN);
    expect(narrow.x + 400 / 2).toBe(wide.x + 842 / 2);
    expect(narrow.x).not.toBe(wide.x);
  });

  it('clears the title bar, the tabs and the breadcrumbs', () => {
    const anchor = vsCode(0, 0);
    expect(DEFAULT_TOP_OFFSET).toBeGreaterThanOrEqual(64);
    expect(defaultPosition(CAPSULE, anchor, SCREEN).y + CAPSULE.height).toBeLessThan(
      anchor.y + anchor.height / 2,
    );
  });
});

describe('the capsule never appears anywhere it is not staying', () => {
  it('the first show waits for the measurement, then places and shows', () => {
    const { placement, view } = setup();
    placement.setAnchor(vsCode(200, 100));

    view.calls.length = 0;
    placement.showWhenPositioned(() => view.window.showInactive());
    // Nothing yet: the width is still unknown.
    expect(view.state.visible).toBe(false);
    expect(view.calls).toEqual([]);

    placement.applyContentSize(CAPSULE.width, CAPSULE.height);
    expect(view.state.visible).toBe(true);
    const shown = view.calls.at(-1) ?? '';
    expect(shown.startsWith('show ')).toBe(true);
    expect(shown).toBe(`show ${view.state.x},${view.state.y}`);
    expect(view.state.y).toBe(100 + DEFAULT_TOP_OFFSET);
  });

  it('and it is never shown twice or at a provisional place', () => {
    const { placement, view } = setup();
    placement.setAnchor(vsCode(200, 100));
    placement.showWhenPositioned(() => view.window.showInactive());
    placement.applyContentSize(CAPSULE.width, CAPSULE.height);

    const shows = view.calls.filter((call) => call.startsWith('show'));
    expect(shows).toHaveLength(1);
    const positions = view.calls
      .filter((call) => call.startsWith('position') || call.startsWith('bounds'))
      .length;
    expect(positions).toBeGreaterThan(0);
    expect(view.state.x).toBe(defaultPosition(CAPSULE, vsCode(200, 100), SCREEN).x);
  });

  it('hiding drops a show that is still waiting', () => {
    expect(WINDOW).toContain('placement.cancelPendingShow()');
    expect(WINDOW).toContain('placement.showWhenPositioned(');
    // The port shows through the placement, so a show can never bypass it.
    expect(WINDOW).not.toContain('live()?.showInactive())\n');
  });

  it('the arrival animation starts from the final position', () => {
    // It is triggered by the page becoming visible, which follows the window
    // being shown — and the window is only shown once it has been placed.
    expect(ENTRY).toContain("document.visibilityState !== 'visible'");
    expect(ENTRY).toContain("document.addEventListener('visibilitychange'");
    expect(APP).toContain('useCapsuleEntry()');
    expect(APP).toContain("entering ? 'island--entering' : ''");
    const keyframes = CSS.slice(CSS.indexOf('@keyframes di-capsule-in'));
    expect(keyframes).toContain('translate3d(0, -6px, 0) scale(0.985)');
    expect(keyframes).toContain('opacity: 0');
    expect(rule('.island--entering')).toContain('animation: di-capsule-in');
    expect(CAPSULE_ENTRY_MS).toBeGreaterThanOrEqual(180);
    expect(CAPSULE_ENTRY_MS).toBeLessThanOrEqual(220);
  });
});

describe('a position belongs to one project', () => {
  it('project B does not inherit the position of project A', () => {
    const { placement, store, view, drag } = setup(PROJECT_A);
    placement.setAnchor(vsCode(200, 100));
    placement.applyContentSize(CAPSULE.width, CAPSULE.height);

    drag(320, 400);
    expect(store.get()).not.toBeNull();

    placement.setProject(PROJECT_B);
    expect(store.get()).toBeNull();
    expect(view.state.y).toBe(100 + DEFAULT_TOP_OFFSET);
    expect(view.state.x).toBe(defaultPosition(CAPSULE, vsCode(200, 100), SCREEN).x);
  });

  it('each project restores its own position', () => {
    const { placement, store, view, drag } = setup(PROJECT_A);
    placement.setAnchor(vsCode(200, 100));
    placement.applyContentSize(CAPSULE.width, CAPSULE.height);

    drag(320, 400);
    const positionOfA = { x: view.state.x, y: view.state.y };

    placement.setProject(PROJECT_B);
    drag(900, 700);
    const positionOfB = { x: view.state.x, y: view.state.y };
    expect(positionOfB).not.toEqual(positionOfA);

    placement.setProject(PROJECT_A);
    expect({ x: view.state.x, y: view.state.y }).toEqual(positionOfA);
    placement.setProject(PROJECT_B);
    expect({ x: view.state.x, y: view.state.y }).toEqual(positionOfB);
    expect(store.get()).toMatchObject({ absoluteX: positionOfB.x, absoluteY: positionOfB.y });
  });

  it('restarting reads both positions back from disk', () => {
    const dataDir = makeTempDir('dev-island-restart-');
    const first = setup(PROJECT_A, dataDir);
    first.placement.setAnchor(vsCode(200, 100));
    first.placement.applyContentSize(CAPSULE.width, CAPSULE.height);
    first.drag(320, 400);
    first.placement.setProject(PROJECT_B);
    first.drag(900, 700);
    first.placement.flush();

    // A fresh store over the same directory, as a restart would build.
    const reopened = new WindowStateStore(dataDir, { debounceMs: 0 });
    reopened.setProject(PROJECT_A);
    expect(reopened.get()).toMatchObject({ absoluteX: 320, absoluteY: 400 });
    reopened.setProject(PROJECT_B);
    expect(reopened.get()).toMatchObject({ absoluteX: 900, absoluteY: 700 });

    const stored = JSON.parse(fs.readFileSync(windowStateFile(dataDir), 'utf8'));
    expect(stored.version).toBe(2);
    expect(Object.keys(stored.projects).sort()).toEqual(
      [normalizeProjectPath(PROJECT_A), normalizeProjectPath(PROJECT_B)].sort(),
    );
  });

  it('the same root in a different case is the same project', () => {
    const dataDir = makeTempDir('dev-island-case-');
    const store = new WindowStateStore(dataDir, { debounceMs: 0 });
    store.setProject('C:/Projetos/Agent-Rules-Lens');
    store.save({ relativeX: 10, relativeY: 20, absoluteX: 30, absoluteY: 40 });

    store.setProject('c:\\projetos\\agent-rules-lens\\');
    // Same project on Windows, so the same position — and only one entry.
    expect(store.get()).toMatchObject({ relativeX: 10, relativeY: 20 });
    store.flush();
    const stored = JSON.parse(fs.readFileSync(windowStateFile(dataDir), 'utf8'));
    expect(Object.keys(stored.projects)).toHaveLength(1);
  });

  it('and no position is stored while no project is active', () => {
    const dataDir = makeTempDir('dev-island-noproject-');
    const store = new WindowStateStore(dataDir, { debounceMs: 0 });
    store.save({ relativeX: 1, relativeY: 2, absoluteX: 3, absoluteY: 4 });
    expect(store.get()).toBeNull();
    // Better no position at all than one attributed to the wrong project.
    expect(fs.existsSync(windowStateFile(dataDir))).toBe(false);
  });
});

describe('only a real drag writes a position', () => {
  it('a programmatic move creates nothing', () => {
    const { placement, store, view } = setup(PROJECT_A);
    placement.setAnchor(vsCode(200, 100));
    placement.applyContentSize(CAPSULE.width, CAPSULE.height);
    placement.applyPosition(vsCode(400, 300));
    placement.applyContentSize(CAPSULE.width, 320);
    placement.handleMoved();
    expect(store.get()).toBeNull();
    expect(view.state.visible).toBe(false);
  });

  it('hiding and showing creates nothing', () => {
    const { placement, store, view } = setup(PROJECT_A);
    placement.setAnchor(vsCode(200, 100));
    placement.applyContentSize(CAPSULE.width, CAPSULE.height);

    for (let round = 0; round < 5; round += 1) {
      placement.showWhenPositioned(() => view.window.showInactive());
      placement.handleMoved();
      placement.runProgrammatic(() => view.window.hide());
      placement.handleMoved();
    }
    expect(store.get()).toBeNull();
    // The grace period is what tells our own moves apart from a drag.
    expect(PLACEMENT).toContain('if (this.now() < this.programmaticUntil) return;');
  });
});

describe('following the VS Code window', () => {
  it('a project with no position stays centred when VS Code is resized', () => {
    const { placement, view } = setup(PROJECT_A);
    placement.setAnchor(vsCode(200, 100));
    placement.applyContentSize(CAPSULE.width, CAPSULE.height);

    for (const anchor of [vsCode(200, 100, 1400), vsCode(200, 100, 1000), vsCode(300, 140, 1600)]) {
      placement.applyPosition(anchor);
      expect(view.state.x + CAPSULE.width / 2).toBe(anchor.x + anchor.width / 2);
      expect(view.state.y).toBe(anchor.y + DEFAULT_TOP_OFFSET);
    }
  });

  it('a project that was dragged keeps its offset when VS Code moves', () => {
    const { placement, view, drag } = setup(PROJECT_A);
    placement.setAnchor(vsCode(200, 100));
    placement.applyContentSize(CAPSULE.width, CAPSULE.height);
    drag(320, 400);
    const offset = { x: 320 - 200, y: 400 - 100 };

    placement.applyPosition(vsCode(500, 260));
    expect({ x: view.state.x, y: view.state.y }).toEqual({
      x: 500 + offset.x,
      y: 260 + offset.y,
    });
  });

  it('a position off the screen is nudged back, and only as far as needed', () => {
    const size = { width: 400, height: 46 };
    // Too far right: x comes back, y is untouched.
    expect(clampToArea({ x: 1900, y: 300 }, size, SCREEN)).toEqual({ x: 1520, y: 300 });
    // Too far up: y comes back, x is untouched.
    expect(clampToArea({ x: 300, y: -40 }, size, SCREEN)).toEqual({ x: 300, y: 0 });
    // Inside: nothing moves at all.
    expect(clampToArea({ x: 300, y: 300 }, size, SCREEN)).toEqual({ x: 300, y: 300 });

    const saved = toPlacement({ x: 5000, y: 5000 }, { x: 0, y: 0 });
    const rescued = resolvePosition(saved, size, vsCode(0, 0), SCREEN);
    expect(rescued.x).toBeLessThanOrEqual(SCREEN.width - size.width);
    expect(rescued.y).toBeLessThanOrEqual(SCREEN.height - size.height);
  });
});

describe('the two themes carry the new tokens', () => {
  it('dark and light use the palettes of the redesign', () => {
    expect(THEME_TOKENS.dark.bg).toBe('#090909');
    expect(THEME_TOKENS.dark.bgElevated).toBe('#151515');
    expect(THEME_TOKENS.dark.text).toBe('#f5f5f7');
    expect(THEME_TOKENS.dark.textMuted).toBe('#a1a1a6');
    expect(THEME_TOKENS.dark.accent).toBe('#0a84ff');
    expect(THEME_TOKENS.light.bg).toBe('#fbfbfd');
    expect(THEME_TOKENS.light.bgElevated).toBe('#ffffff');
    expect(THEME_TOKENS.light.text).toBe('#1d1d1f');
    expect(THEME_TOKENS.light.textMuted).toBe('#6e6e73');
    expect(THEME_TOKENS.light.accent).toBe('#0071e3');
  });

  it('every surface stays opaque, and only the tints are translucent', () => {
    for (const theme of ['dark', 'light'] as const) {
      const tokens = THEME_TOKENS[theme];
      for (const surface of [tokens.bg, tokens.bgElevated, tokens.bgTerminal, tokens.bgInput]) {
        expect(surface, theme).toMatch(/^#[0-9a-f]{6}$/i);
      }
      // The hover and press tints sit on top of those surfaces.
      expect(tokens.hover).toMatch(/^rgba\(/);
      expect(tokens.active).toMatch(/^rgba\(/);
    }
    // The capsule and the panels paint one of those opaque surfaces.
    expect(rule('.island')).toContain('background: var(--di-bg)');
    expect(rule('.panel')).toContain('background: var(--di-bg-elevated)');
    // Only the area around the capsule is see-through.
    expect(rule('body')).toContain('background: transparent');
    expect(CSS).not.toContain('backdrop-filter');
  });

  it('the capsule looks like a floating pill, not a toolbar', () => {
    const island = rule('.island');
    expect(island).toContain('border: 1px solid var(--di-border)');
    expect(island).toContain('box-shadow');
    expect(island).toContain('border-radius: var(--di-radius-pill)');
    const root = rule(':root');
    // Roughly half the capsule's height, which is what makes it a pill.
    expect(root).toContain('--di-capsule-height: 46px');
    expect(root).toContain('--di-radius-pill: 23px');
    expect(rule('.bar')).toContain('min-height: var(--di-capsule-height)');
    // A system font stack, nothing bundled.
    expect(root).toContain('-apple-system');
    expect(root).toContain("'Segoe UI'");
    expect(CSS).not.toContain('@font-face');
  });
});

describe('how the controls respond', () => {
  it('hover only paints: it never changes the layout', () => {
    for (const selector of ['.action:hover', '.icon-button:hover', '.grip:hover']) {
      const block = rule(selector);
      for (const property of ['width', 'height', 'padding', 'margin', 'border-width', 'font-size']) {
        expect(block, `${selector} ${property}`).not.toContain(`${property}:`);
      }
    }
    // And the transition is limited to properties that cannot reflow.
    const action = rule('.action');
    expect(action).toContain('transition:');
    expect(action).not.toContain('transition: all');
  });

  it('pressing scales without getting in the way of the click', () => {
    expect(rule('.action:active')).toContain('transform: scale(0.96)');
    // The icon controls give way a touch more, since they also lift on hover.
    expect(rule('.icon-button:active')).toContain('transform: scale(0.95)');
    expect(rule('.action:active')).toContain('background: var(--di-active)');
    // A transform paints elsewhere but hit-tests where it is drawn, and it
    // takes no space, so nothing about the click changes.
    expect(rule('.action:active')).not.toContain('pointer-events');
    expect(rule('.action')).toContain('transform var(--di-quick)');
  });

  it('keyboard focus keeps a visible ring in the accent colour', () => {
    for (const selector of ['.action:focus-visible', '.icon-button:focus-visible']) {
      const block = rule(selector);
      expect(block).toContain('outline: 2px solid var(--di-accent)');
      expect(block).not.toContain('outline: none');
    }
    expect(rule('.field__input:focus')).toContain('border-color: var(--di-accent)');
  });

  it('running and disabled stay clearly different, and cost no width', () => {
    expect(rule('.action--running')).toContain('color: var(--di-running)');
    expect(rule('.action--exited')).toContain('color: var(--di-text-muted)');
    const disabled = rule('.action[disabled]');
    expect(disabled).toContain('cursor: default');
    expect(disabled).toContain('transform: none');
    // The width of a script is measured without these classes, so none of them
    // may change its metrics.
    for (const selector of ['.action--running', '.action--exited']) {
      for (const property of ['font-weight', 'padding', 'width', 'font-size', 'letter-spacing']) {
        expect(rule(selector), `${selector} ${property}`).not.toContain(`${property}:`);
      }
    }
  });

  it('reduced motion drops the movement and keeps the behaviour', () => {
    const start = CSS.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThan(-1);
    const block = CSS.slice(start);
    expect(block).toContain('animation: none !important');
    expect(block).toContain('transition: none !important');
    expect(block).toContain('transform: none !important');
    // The overrides come last, so they win over the rules they relax.
    expect(start).toBeGreaterThan(CSS.indexOf('.island--entering {'));
    expect(start).toBeGreaterThan(CSS.indexOf('.action:active {'));
    // Colour still changes: only the movement is gone.
    expect(block).not.toContain('background: none');
  });

  it('the animations share one curve and stay short', () => {
    const root = rule(':root');
    expect(root).toContain('--di-ease: cubic-bezier(0.22, 1, 0.36, 1)');
    for (const [token, min, max] of [
      ['--di-quick', 120, 150],
      ['--di-panel-in', 180, 240],
      ['--di-capsule-in', 180, 220],
    ] as const) {
      const value = Number(new RegExp(`${token}: (\\d+)ms`).exec(root)?.[1]);
      expect(value, token).toBeGreaterThanOrEqual(min);
      expect(value, token).toBeLessThanOrEqual(max);
    }
    // A panel arrives from the capsule above it, by transform alone.
    expect(rule('.panel')).toContain('transform-origin: 50% 0');
    expect(rule('.panel')).toContain('animation: di-panel-in');
    const keyframes = CSS.slice(CSS.indexOf('@keyframes di-panel-in'));
    expect(keyframes.slice(0, 200)).toContain('translate3d(0, -8px, 0)');
    // Nothing that would resize the window frame by frame.
    expect(keyframes.slice(0, 200)).not.toContain('height');
  });
});

describe('boundaries the redesign must not cross', () => {
  it('no surface swallows a click', () => {
    expect(rule('.action')).not.toContain('pointer-events: none');
    expect(rule('.island')).not.toContain('pointer-events: none');
  });

  it('switching project or hiding never touches a process', () => {
    // `setProject` is about positions and nothing else.
    const body = PLACEMENT.slice(
      PLACEMENT.indexOf('setProject(projectRoot: string | null)'),
      PLACEMENT.indexOf('get limits()'),
    );
    for (const forbidden of ['pty', 'Pty', 'kill', 'stop', 'spawn']) {
      expect(body, forbidden).not.toContain(forbidden);
    }
    expect(PLACEMENT).not.toContain('PtyManager');
    expect(WINDOW).not.toContain('PtyManager');
  });

  it('no position or theme has any business inside the project', () => {
    const state = fs.readFileSync('src/main/window-state.ts', 'utf8');
    expect(state).toContain('windowStateFile(this.dataDir)');
    expect(state).not.toContain('buttons.json');
    expect(state).not.toContain('projectButtonsFile');
    expect(state).not.toContain('projectConfigDir');
    expect(PLACEMENT).not.toContain('buttons');
  });

  it('nothing from a VS Code extension was added', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      contributes?: unknown;
      engines?: Record<string, string>;
    };
    expect(manifest.contributes).toBeUndefined();
    expect(manifest.engines?.vscode).toBeUndefined();
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    for (const name of names) {
      expect(name).not.toMatch(/^@types\/vscode$|^vscode/);
    }
    for (const file of [PLACEMENT, WINDOW, APP, ENTRY]) {
      expect(file).not.toContain("from 'vscode'");
      expect(file).not.toContain('require(\'vscode\')');
    }
  });
});
