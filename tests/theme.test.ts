import * as fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { writeButtonsFile } from '../src/core/buttons-config';
import { uiPreferencesFile } from '../src/core/paths';
import { ProjectRegistry } from '../src/core/registry';
import { PreferencesStore } from '../src/main/preferences';
import { PtyManager } from '../src/main/pty-manager';
import { WidgetState } from '../src/main/widget-state';
import { applyThemeTokens, cssVariableName, THEME_TOKENS, terminalTheme } from '../src/renderer/theme';
import { makeTempDir, removeTempDirs, writePackageJson } from './helpers';

afterEach(removeTempDirs);

/** Records the custom properties a theme would write. */
function fakeTarget() {
  const properties: Record<string, string> = {};
  const attributes: Record<string, string> = {};
  return {
    properties,
    attributes,
    target: {
      style: {
        setProperty: (property: string, value: string) => {
          properties[property] = value;
        },
      },
      setAttribute: (name: string, value: string) => {
        attributes[name] = value;
      },
    },
  };
}

describe('initial theme follows Windows', () => {
  it('uses dark when Windows prefers dark', () => {
    const store = new PreferencesStore(makeTempDir(), () => true);
    expect(store.hasExplicitTheme()).toBe(false);
    expect(store.getTheme()).toBe('dark');
  });

  it('uses light when Windows prefers light', () => {
    expect(new PreferencesStore(makeTempDir(), () => false).getTheme()).toBe('light');
  });
});

describe('a manual choice is persisted', () => {
  it('survives a new store over the same directory', () => {
    const dataDir = makeTempDir();
    const first = new PreferencesStore(dataDir, () => true);
    first.setTheme('light');

    // A brand new process, with Windows still asking for dark.
    const restarted = new PreferencesStore(dataDir, () => true);
    expect(restarted.hasExplicitTheme()).toBe(true);
    expect(restarted.getTheme()).toBe('light');
  });

  it('never falls back to the system theme afterwards', () => {
    const dataDir = makeTempDir();
    let systemDark = false;
    const store = new PreferencesStore(dataDir, () => systemDark);
    store.setTheme('light');

    systemDark = true;
    expect(store.getTheme()).toBe('light');
    expect(new PreferencesStore(dataDir, () => systemDark).getTheme()).toBe('light');
  });

  it('ignores a value that is not a theme', () => {
    const store = new PreferencesStore(makeTempDir(), () => true);
    store.setTheme('roxo');
    expect(store.hasExplicitTheme()).toBe(false);
  });

  it('writes only its own file', () => {
    const dataDir = makeTempDir();
    new PreferencesStore(dataDir, () => true).setTheme('light');
    expect(uiPreferencesFile(dataDir).endsWith('ui-preferences.json')).toBe(true);
    expect(JSON.parse(fs.readFileSync(uiPreferencesFile(dataDir), 'utf8'))).toEqual({ version: 1, theme: 'light' });
  });
});

describe('switching projects keeps the theme', () => {
  it('reports the same theme before and after activating another project', () => {
    const dataDir = makeTempDir();
    const preferences = new PreferencesStore(dataDir, () => true);
    preferences.setTheme('light');

    const registry = new ProjectRegistry(dataDir);
    const state = new WidgetState(registry, new PtyManager(), {
      theme: () => preferences.getTheme(),
      layout: () => ({ sizeMode: 'auto' as const, maxWidth: 900, maxHeight: 760, panelHeight: 320 }),
    });

    const projects = [makeTempDir('projeto-a-'), makeTempDir('projeto-b-')];
    for (const dir of projects) {
      writePackageJson(dir, { name: 'demo', scripts: { dev: 'vite' } });
      writeButtonsFile(dir, { buttons: [{ name: 'Dev', script: 'npm run dev' }] });
      registry.authorize(dir, 'demo');
    }

    state.activate(projects[0]!);
    expect(state.getState().theme).toBe('light');

    state.activate(projects[1]!);
    expect(state.getState().theme).toBe('light');
    expect(state.getState().project?.path).toContain('projeto-b-');
  });
});

describe('each theme applies its own variables', () => {
  it('light uses the light palette', () => {
    const { target, properties, attributes } = fakeTarget();
    applyThemeTokens(target, 'light');

    expect(attributes['data-theme']).toBe('light');
    expect(properties['--di-bg']).toBe('#fbfbfd');
    expect(properties['--di-bg-elevated']).toBe('#ffffff');
    expect(properties['--di-border']).toBe('rgba(0, 0, 0, 0.10)');
    expect(properties['--di-text']).toBe('#1d1d1f');
    expect(properties['--di-text-muted']).toBe('#6e6e73');
    expect(properties['--di-hover']).toBe('rgba(0, 0, 0, 0.055)');
    expect(properties['--di-active']).toBe('rgba(0, 0, 0, 0.10)');
    expect(properties['--di-accent']).toBe('#0071e3');
  });

  it('dark uses the dark palette', () => {
    const { target, properties, attributes } = fakeTarget();
    applyThemeTokens(target, 'dark');

    expect(attributes['data-theme']).toBe('dark');
    expect(properties['--di-bg']).toBe('#090909');
    expect(properties['--di-bg-elevated']).toBe('#151515');
    expect(properties['--di-border']).toBe('rgba(255, 255, 255, 0.10)');
    expect(properties['--di-text']).toBe('#f5f5f7');
    expect(properties['--di-text-muted']).toBe('#a1a1a6');
    expect(properties['--di-hover']).toBe('rgba(255, 255, 255, 0.08)');
    expect(properties['--di-active']).toBe('rgba(255, 255, 255, 0.13)');
    expect(properties['--di-accent']).toBe('#0a84ff');
  });

  it('writes every token of the palette', () => {
    const { target, properties } = fakeTarget();
    applyThemeTokens(target, 'dark');
    for (const token of Object.keys(THEME_TOKENS.dark)) {
      expect(properties[cssVariableName(token as keyof typeof THEME_TOKENS.dark)]).toBeDefined();
    }
  });

  it('keeps every surface opaque so the editor cannot show through', () => {
    for (const theme of ['light', 'dark'] as const) {
      const tokens = THEME_TOKENS[theme];
      for (const surface of [tokens.bg, tokens.bgElevated, tokens.bgTerminal, tokens.bgInput]) {
        expect(surface).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('hands the terminal the matching colours', () => {
    expect(terminalTheme('dark')).toEqual({
      background: '#0c0c0c',
      foreground: '#f5f5f7',
      cursor: '#f5f5f7',
      selectionBackground: 'rgba(10, 132, 255, 0.32)',
    });
    expect(terminalTheme('light').background).toBe('#ffffff');
  });
});
