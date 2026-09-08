import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { registryFile } from '../src/core/paths';
import { ProjectRegistry } from '../src/core/registry';
import { makeTempDir, removeTempDirs, writeFile } from './helpers';

afterEach(removeTempDirs);

describe('ProjectRegistry', () => {
  it('starts empty and reports unknown projects as unauthorized', () => {
    const registry = new ProjectRegistry(makeTempDir());
    expect(registry.list()).toEqual([]);
    expect(registry.isAuthorized('C:\\qualquer\\projeto')).toBe(false);
  });

  it('authorizes a project and stores it outside the repository', () => {
    const dataDir = makeTempDir();
    const projectDir = makeTempDir();
    const registry = new ProjectRegistry(dataDir);

    registry.authorize(projectDir, 'demo');
    expect(registry.isAuthorized(projectDir)).toBe(true);
    expect(fs.existsSync(registryFile(dataDir))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'projects.json'))).toBe(false);
  });

  it('does not duplicate an entry and keeps the first authorization date', () => {
    const dataDir = makeTempDir();
    const projectDir = makeTempDir();
    const registry = new ProjectRegistry(dataDir);

    const first = registry.authorize(projectDir, 'demo');
    const second = registry.authorize(projectDir, 'demo-renomeado');

    expect(registry.list()).toHaveLength(1);
    expect(second.authorizedAt).toBe(first.authorizedAt);
    expect(registry.list()[0]?.name).toBe('demo-renomeado');
  });

  it('revokes an entry', () => {
    const dataDir = makeTempDir();
    const projectDir = makeTempDir();
    const registry = new ProjectRegistry(dataDir);

    registry.authorize(projectDir, 'demo');
    expect(registry.revoke(projectDir)).toBe(true);
    expect(registry.isAuthorized(projectDir)).toBe(false);
    expect(registry.revoke(projectDir)).toBe(false);
  });

  it('survives a corrupted registry file', () => {
    const dataDir = makeTempDir();
    writeFile(registryFile(dataDir), 'not json at all');
    const registry = new ProjectRegistry(dataDir);
    expect(registry.list()).toEqual([]);
  });
});
