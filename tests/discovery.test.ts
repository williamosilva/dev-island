import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeButtonsFile } from '../src/core/buttons-config';
import { discoverProject, findProjectRoot, isInsideNodeModules } from '../src/core/discovery';
import { projectButtonsFile, projectConfigDir } from '../src/core/paths';
import { makeTempDir, readFile, removeTempDirs, writeFile, writePackageJson } from './helpers';

afterEach(removeTempDirs);

const always = { isAuthorized: () => true };
const never = { isAuthorized: () => false };

describe('finding the nearest project root', () => {
  it('a terminal in a subfolder finds the project above it', () => {
    const root = makeTempDir('dev-island-projeto-');
    writePackageJson(root, { name: 'demo', scripts: { dev: 'vite' } });
    const deep = path.join(root, 'src', 'renderer', 'components');
    fs.mkdirSync(deep, { recursive: true });

    expect(findProjectRoot(deep)).toBe(path.resolve(root));
    expect(findProjectRoot(root)).toBe(path.resolve(root));
  });

  it('the nearest package.json wins over an outer one', () => {
    const outer = makeTempDir('dev-island-mono-');
    writePackageJson(outer, { name: 'mono', scripts: { build: 'tsc' } });
    const inner = path.join(outer, 'packages', 'app');
    fs.mkdirSync(inner, { recursive: true });
    writePackageJson(inner, { name: 'app', scripts: { dev: 'vite' } });

    expect(findProjectRoot(path.join(inner, 'src'))).toBe(path.resolve(inner));
  });

  it('a folder with no package.json anywhere above is ignored', () => {
    const empty = makeTempDir('dev-island-vazio-');
    expect(findProjectRoot(empty)).toBeNull();
    expect(discoverProject(empty, always)).toEqual({
      kind: 'ignored',
      reason: 'sem-package-json',
    });
  });

  it('an invalid package.json is ignored instead of crashing', () => {
    const root = makeTempDir('dev-island-quebrado-');
    writeFile(path.join(root, 'package.json'), '{ nao json');
    expect(discoverProject(root, always)).toEqual({
      kind: 'ignored',
      reason: 'package-json-invalido',
    });
  });

  it('never treats a dependency as the project root', () => {
    const root = makeTempDir('dev-island-dep-');
    writePackageJson(root, { name: 'demo', scripts: { dev: 'vite' } });
    const dep = path.join(root, 'node_modules', 'alguma-lib');
    fs.mkdirSync(dep, { recursive: true });
    writePackageJson(dep, { name: 'alguma-lib', scripts: { build: 'x' } });

    expect(isInsideNodeModules(dep)).toBe(true);
    // Walks straight past node_modules up to the real project.
    expect(findProjectRoot(dep)).toBe(path.resolve(root));
  });
});

describe('the first prompt configures the project by itself', () => {
  it('creates .dev-island/buttons.json from the package.json scripts', () => {
    const root = makeTempDir('dev-island-novo-');
    writePackageJson(root, { name: 'demo', scripts: { dev: 'vite', build: 'vite build' } });
    expect(fs.existsSync(projectConfigDir(root))).toBe(false);

    const outcome = discoverProject(path.join(root, 'src'), never);

    expect(outcome.kind).toBe('created');
    expect(fs.existsSync(projectButtonsFile(root))).toBe(true);
    expect(JSON.parse(readFile(projectButtonsFile(root)))).toEqual({
      buttons: [
        { name: 'Dev', script: 'npm run dev' },
        { name: 'Build', script: 'npm run build' },
      ],
    });
  });

  it('no init is needed: an unknown project is created and trusted', () => {
    const root = makeTempDir('dev-island-novo-');
    writePackageJson(root, { name: 'demo', scripts: { dev: 'vite' } });

    // `isAuthorized` says no, and the project is still created: a config
    // derived from the user's own package.json runs nothing by itself.
    const outcome = discoverProject(root, never);
    expect(outcome.kind).toBe('created');
  });

  it('a second, different project is discovered the same way', () => {
    const first = makeTempDir('dev-island-um-');
    const second = makeTempDir('dev-island-dois-');
    writePackageJson(first, { name: 'um', scripts: { dev: 'vite' } });
    writePackageJson(second, { name: 'dois', scripts: { test: 'vitest' } });

    const a = discoverProject(first, never);
    const b = discoverProject(second, never);

    expect(a.kind).toBe('created');
    expect(b.kind).toBe('created');
    expect(a.kind === 'created' && a.name).toBe('um');
    expect(b.kind === 'created' && b.name).toBe('dois');
    expect(JSON.parse(readFile(projectButtonsFile(second))).buttons).toEqual([
      { name: 'Test', script: 'npm run test' },
    ]);
  });

  it('uses the detected package manager', () => {
    const root = makeTempDir('dev-island-pnpm-');
    writePackageJson(root, { name: 'demo', packageManager: 'pnpm@9.0.0', scripts: { dev: 'vite' } });
    const outcome = discoverProject(root, never);
    expect(outcome.kind === 'created' && outcome.buttons).toEqual([
      { name: 'Dev', script: 'pnpm run dev' },
    ]);
  });
});

describe('an existing configuration is respected', () => {
  function projectWithConfig() {
    const root = makeTempDir('dev-island-existente-');
    writePackageJson(root, { name: 'demo', scripts: { dev: 'vite', test: 'vitest' } });
    writeButtonsFile(root, {
      buttons: [
        { name: 'Dev', script: 'npm run dev' },
        { name: 'Docker', script: 'docker compose up -d' },
      ],
    });
    return root;
  }

  it('adds only the missing scripts and keeps custom buttons in place', () => {
    const root = projectWithConfig();
    const outcome = discoverProject(root, always);

    expect(outcome.kind).toBe('synced');
    expect(outcome.kind === 'synced' && outcome.added).toEqual([
      { name: 'Test', script: 'npm run test' },
    ]);
    expect(JSON.parse(readFile(projectButtonsFile(root))).buttons).toEqual([
      { name: 'Dev', script: 'npm run dev' },
      { name: 'Docker', script: 'docker compose up -d' },
      { name: 'Test', script: 'npm run test' },
    ]);
  });

  it('discovering the same project twice adds nothing', () => {
    const root = projectWithConfig();
    discoverProject(root, always);
    const before = readFile(projectButtonsFile(root));
    const mtime = fs.statSync(projectButtonsFile(root)).mtimeMs;

    const again = discoverProject(root, always);
    expect(again.kind === 'synced' && again.added).toEqual([]);
    expect(readFile(projectButtonsFile(root))).toBe(before);
    expect(fs.statSync(projectButtonsFile(root)).mtimeMs).toBe(mtime);
  });

  it('a config nobody authorized is shown, never written', () => {
    const root = projectWithConfig();
    const before = readFile(projectButtonsFile(root));
    const mtime = fs.statSync(projectButtonsFile(root)).mtimeMs;

    const outcome = discoverProject(root, never);

    expect(outcome.kind).toBe('needs-authorization');
    // The commands travel to the widget so the user can see what they are.
    expect(outcome.kind === 'needs-authorization' && outcome.buttons).toEqual([
      { name: 'Dev', script: 'npm run dev' },
      { name: 'Docker', script: 'docker compose up -d' },
    ]);
    // ... and the file is left exactly as it was.
    expect(readFile(projectButtonsFile(root))).toBe(before);
    expect(fs.statSync(projectButtonsFile(root)).mtimeMs).toBe(mtime);
  });

  it('discovery never runs anything: it only reads and writes the config', () => {
    const root = makeTempDir('dev-island-seguro-');
    // A package.json whose scripts would be destructive if they ever ran.
    writePackageJson(root, {
      name: 'perigoso',
      scripts: { dev: 'shutdown /s /t 0', clean: 'rm -rf /' },
    });

    const outcome = discoverProject(root, never);

    expect(outcome.kind).toBe('created');
    // The commands are recorded as text, going through the package manager.
    expect(outcome.kind === 'created' && outcome.buttons).toEqual([
      { name: 'Dev', script: 'npm run dev' },
      { name: 'Clean', script: 'npm run clean' },
    ]);
    // Nothing from the script bodies is inlined anywhere.
    const written = readFile(projectButtonsFile(root));
    expect(written).not.toContain('shutdown');
    expect(written).not.toContain('rm -rf');
  });
});
