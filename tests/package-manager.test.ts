import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildScriptCommand,
  detectPackageManager,
  detectPackageManagerFrom,
  parsePackageManagerField,
} from '../src/core/package-manager';
import { makeTempDir, removeTempDirs, writeFile } from './helpers';

afterEach(removeTempDirs);

function probe(field: string | null, files: string[]) {
  return { packageManagerField: field, hasFile: (name: string) => files.includes(name) };
}

describe('parsePackageManagerField', () => {
  it('reads the manager out of a versioned field', () => {
    expect(parsePackageManagerField('pnpm@8.6.0')).toBe('pnpm');
    expect(parsePackageManagerField('yarn@4.1.0+sha512.abc')).toBe('yarn');
    expect(parsePackageManagerField('  NPM@10.2.0 ')).toBe('npm');
  });

  it('ignores unknown or malformed values', () => {
    expect(parsePackageManagerField('deno@1')).toBeNull();
    expect(parsePackageManagerField('')).toBeNull();
    expect(parsePackageManagerField(undefined)).toBeNull();
    expect(parsePackageManagerField(42 as unknown as string)).toBeNull();
  });
});

describe('detectPackageManagerFrom', () => {
  it('prefers the packageManager field over every lock file', () => {
    expect(detectPackageManagerFrom(probe('bun@1.1.0', ['pnpm-lock.yaml', 'package-lock.json']))).toBe(
      'bun',
    );
  });

  it('follows the documented lock file precedence', () => {
    expect(
      detectPackageManagerFrom(
        probe(null, ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'package-lock.json']),
      ),
    ).toBe('pnpm');
    expect(detectPackageManagerFrom(probe(null, ['yarn.lock', 'bun.lockb', 'package-lock.json']))).toBe(
      'yarn',
    );
    expect(detectPackageManagerFrom(probe(null, ['bun.lockb', 'package-lock.json']))).toBe('bun');
    expect(detectPackageManagerFrom(probe(null, ['bun.lock']))).toBe('bun');
    expect(detectPackageManagerFrom(probe(null, ['package-lock.json']))).toBe('npm');
  });

  it('falls back to npm when nothing is found', () => {
    expect(detectPackageManagerFrom(probe(null, []))).toBe('npm');
  });
});

describe('detectPackageManager (filesystem)', () => {
  it('detects pnpm from a real lock file', () => {
    const dir = makeTempDir();
    writeFile(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 6.0\n');
    expect(detectPackageManager(dir)).toBe('pnpm');
  });

  it('defaults to npm in an empty folder', () => {
    expect(detectPackageManager(makeTempDir())).toBe('npm');
  });
});

describe('buildScriptCommand', () => {
  it('uses the run form each manager expects', () => {
    expect(buildScriptCommand('npm', 'dev')).toBe('npm run dev');
    expect(buildScriptCommand('pnpm', 'dev')).toBe('pnpm run dev');
    expect(buildScriptCommand('yarn', 'dev')).toBe('yarn dev');
    expect(buildScriptCommand('bun', 'dev')).toBe('bun run dev');
  });

  it('quotes script names containing spaces', () => {
    expect(buildScriptCommand('npm', 'build all')).toBe('npm run "build all"');
  });
});
