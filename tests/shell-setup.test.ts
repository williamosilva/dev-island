import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { installShellIntegration, uninstallShellIntegration } from '../src/cli/shell-setup';
import { hookScriptFile, tokenFile } from '../src/core/paths';
import { discoverProfilePaths, fallbackProfilePath } from '../src/shell/profile-discovery';
import { SHELL_BLOCK_BEGIN } from '../src/shared/branding';
import { makeTempDir, readFile, removeTempDirs, writeFile } from './helpers';

afterEach(removeTempDirs);

describe('discoverProfilePaths', () => {
  it('asks every PowerShell host and de-duplicates the answers', () => {
    const asked: string[] = [];
    const paths = discoverProfilePaths((file) => {
      asked.push(file);
      return file === 'pwsh.exe' ? 'C:\\Users\\x\\Documents\\PowerShell\\profile.ps1' : null;
    });
    expect(asked).toEqual(['powershell.exe', 'pwsh.exe']);
    expect(paths).toEqual(['C:\\Users\\x\\Documents\\PowerShell\\profile.ps1']);
  });

  it('ignores relative answers and falls back when no host replies', () => {
    expect(discoverProfilePaths(() => 'nao-absoluto')).toEqual([fallbackProfilePath()]);
    expect(discoverProfilePaths(() => null)).toEqual([fallbackProfilePath()]);
  });
});

describe('shell setup with injected profile paths', () => {
  it('installs into every given profile and removes only its own block', () => {
    const dataDir = makeTempDir('dev-island-data-');
    const profileDir = makeTempDir('dev-island-profiles-');
    const profiles = [
      path.join(profileDir, 'WindowsPowerShell', 'profile.ps1'),
      path.join(profileDir, 'PowerShell', 'profile.ps1'),
    ];
    writeFile(profiles[0]!, 'Write-Host "perfil 5.1"\r\n');

    const installed = installShellIntegration({ dataDir, profilePaths: profiles });
    expect(installed).toHaveLength(2);
    expect(installed.every((result) => result.profileUpdated)).toBe(true);
    expect(fs.existsSync(tokenFile(dataDir))).toBe(true);
    expect(fs.existsSync(hookScriptFile(dataDir))).toBe(true);
    for (const profile of profiles) expect(readFile(profile)).toContain(SHELL_BLOCK_BEGIN);

    const removed = uninstallShellIntegration({ dataDir, profilePaths: profiles });
    expect(removed.every((result) => result.removed)).toBe(true);
    expect(readFile(profiles[0]!)).toContain('Write-Host "perfil 5.1"');
    for (const profile of profiles) expect(readFile(profile)).not.toContain(SHELL_BLOCK_BEGIN);
    expect(fs.existsSync(hookScriptFile(dataDir))).toBe(false);
  });

  it('reuses the same token across installs', () => {
    const dataDir = makeTempDir('dev-island-data-');
    const profile = path.join(makeTempDir(), 'profile.ps1');
    installShellIntegration({ dataDir, profilePaths: [profile] });
    const token = readFile(tokenFile(dataDir));
    installShellIntegration({ dataDir, profilePaths: [profile] });
    expect(readFile(tokenFile(dataDir))).toBe(token);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });
});
