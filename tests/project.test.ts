import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadProject, ProjectError, readPackageJson, readScripts } from '../src/core/project';
import { makeTempDir, removeTempDirs, writeFile, writePackageJson } from './helpers';

afterEach(removeTempDirs);

describe('readScripts', () => {
  it('keeps package.json declaration order', () => {
    expect(readScripts({ scripts: { build: 'tsc', dev: 'vite', test: 'vitest' } })).toEqual([
      'build',
      'dev',
      'test',
    ]);
  });

  it('drops entries that are not usable commands', () => {
    expect(
      readScripts({ scripts: { dev: 'vite', empty: '   ', broken: 42, nested: { a: 1 } } }),
    ).toEqual(['dev']);
  });

  it('returns an empty list when there is no scripts object', () => {
    expect(readScripts({})).toEqual([]);
    expect(readScripts({ scripts: null })).toEqual([]);
    expect(readScripts({ scripts: ['dev'] })).toEqual([]);
  });
});

describe('readPackageJson', () => {
  it('fails with a clear message when the file is missing', () => {
    const dir = makeTempDir();
    expect(() => readPackageJson(dir)).toThrow(ProjectError);
    expect(() => readPackageJson(dir)).toThrow(/No package.json/);
  });

  it('fails when the file is not valid JSON', () => {
    const dir = makeTempDir();
    writeFile(path.join(dir, 'package.json'), '{ not json');
    expect(() => readPackageJson(dir)).toThrow(/is not valid JSON/);
  });

  it('fails when the file is not an object', () => {
    const dir = makeTempDir();
    writeFile(path.join(dir, 'package.json'), '[]');
    expect(() => readPackageJson(dir)).toThrow(/objeto JSON/);
  });
});

describe('loadProject', () => {
  it('combines name, package manager and scripts', () => {
    const dir = makeTempDir();
    writePackageJson(dir, {
      name: 'my-app',
      packageManager: 'pnpm@9.0.0',
      scripts: { dev: 'next dev', build: 'next build' },
    });

    const project = loadProject(dir);
    expect(project.name).toBe('my-app');
    expect(project.packageManager).toBe('pnpm');
    expect(project.scripts).toEqual(['dev', 'build']);
    expect(project.path).toBe(path.resolve(dir));
  });

  it('falls back to the folder name', () => {
    const dir = makeTempDir();
    writePackageJson(dir, { scripts: {} });
    expect(loadProject(dir).name).toBe(path.basename(dir));
  });
});
