import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeButtonsFile } from '../src/core/buttons-config';
import {
  normalizeProjectPath,
  projectButtonsFile,
  projectConfigDir,
  uiPreferencesFile,
  windowStateFile,
} from '../src/core/paths';
import { PreferencesStore } from '../src/main/preferences';
import { WindowStateStore } from '../src/main/window-state';
import { makeTempDir, readFile, removeTempDirs, writePackageJson } from './helpers';

afterEach(removeTempDirs);

describe('theme and position never touch the project', () => {
  it('leaves .dev-island/buttons.json byte for byte identical', () => {
    const dataDir = makeTempDir('dev-island-data-');
    const projectDir = makeTempDir('dev-island-project-');
    writePackageJson(projectDir, { name: 'demo', scripts: { dev: 'vite' } });
    writeButtonsFile(projectDir, {
      buttons: [
        { name: 'Dev', script: 'npm run dev' },
        { name: 'Docker', script: 'docker compose up -d' },
      ],
    });

    const buttonsPath = projectButtonsFile(projectDir);
    const before = readFile(buttonsPath);
    const beforeMtime = fs.statSync(buttonsPath).mtimeMs;

    new PreferencesStore(dataDir, () => true).setTheme('light');
    const store = new WindowStateStore(dataDir, { debounceMs: 0 });
    // A position belongs to a project, so saving one needs a project.
    store.setProject(projectDir);
    store.save({ relativeX: 240, relativeY: 200, absoluteX: 340, absoluteY: 260 });

    expect(readFile(buttonsPath)).toBe(before);
    expect(fs.statSync(buttonsPath).mtimeMs).toBe(beforeMtime);
    expect(JSON.parse(before).buttons[0]).toEqual({ name: 'Dev', script: 'npm run dev' });
  });

  it('adds no file to the project directory', () => {
    const dataDir = makeTempDir('dev-island-data-');
    const projectDir = makeTempDir('dev-island-project-');
    writePackageJson(projectDir, { name: 'demo', scripts: { dev: 'vite' } });
    writeButtonsFile(projectDir, { buttons: [{ name: 'Dev', script: 'npm run dev' }] });

    const before = fs.readdirSync(projectDir).sort();
    const beforeConfig = fs.readdirSync(projectConfigDir(projectDir)).sort();

    new PreferencesStore(dataDir, () => false).setTheme('dark');
    new WindowStateStore(dataDir, { debounceMs: 0 }).save({
      relativeX: 1,
      relativeY: 2,
      absoluteX: 3,
      absoluteY: 4,
    });

    expect(fs.readdirSync(projectDir).sort()).toEqual(before);
    expect(fs.readdirSync(projectConfigDir(projectDir)).sort()).toEqual(beforeConfig);
    expect(beforeConfig).toEqual(['buttons.json']);
  });

  it('writes both preferences into the user data directory, in separate files', () => {
    const dataDir = makeTempDir('dev-island-data-');
    new PreferencesStore(dataDir, () => true).setTheme('light');
    const store = new WindowStateStore(dataDir, { debounceMs: 0 });
    // A position belongs to a project, so saving one needs a project.
    store.setProject('C:/projetos/preferencias');
    store.save({ relativeX: 240, relativeY: 200, absoluteX: 340, absoluteY: 260 });

    expect(fs.existsSync(uiPreferencesFile(dataDir))).toBe(true);
    expect(fs.existsSync(windowStateFile(dataDir))).toBe(true);
    expect(path.dirname(uiPreferencesFile(dataDir))).toBe(dataDir);
    expect(path.dirname(windowStateFile(dataDir))).toBe(dataDir);
    expect(uiPreferencesFile(dataDir)).not.toBe(windowStateFile(dataDir));

    // Neither file carries anything that belongs to a project.
    const preferences = JSON.parse(readFile(uiPreferencesFile(dataDir)));
    expect(Object.keys(preferences).sort()).toEqual(['theme', 'version']);
  });

  it('coalesces rapid saves while the user drags', () => {
    const dataDir = makeTempDir('dev-island-data-');
    const projectDir = 'C:/projetos/arrastado';
    const store = new WindowStateStore(dataDir, { debounceMs: 50 });
    store.setProject(projectDir);

    for (let step = 0; step < 20; step += 1) {
      store.save({ relativeX: step, relativeY: step, absoluteX: step, absoluteY: step });
    }
    // Nothing on disk yet, but the value is already available in memory.
    expect(fs.existsSync(windowStateFile(dataDir))).toBe(false);
    expect(store.get()?.relativeX).toBe(19);

    store.flush();
    const stored = JSON.parse(readFile(windowStateFile(dataDir)));
    expect(stored.projects[normalizeProjectPath(projectDir)].relativeX).toBe(19);
  });

  it('ignores a corrupted window state file instead of crashing', () => {
    const dataDir = makeTempDir('dev-island-data-');
    fs.writeFileSync(windowStateFile(dataDir), 'not json', 'utf8');
    expect(new WindowStateStore(dataDir).get()).toBeNull();

    fs.writeFileSync(windowStateFile(dataDir), JSON.stringify({ placement: { relativeX: 'x' } }), 'utf8');
    expect(new WindowStateStore(dataDir).get()).toBeNull();
  });
});
