import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SHELL_BLOCK_BEGIN, SHELL_BLOCK_END } from '../src/shared/branding';
import {
  BACKUP_SUFFIX,
  buildProfileBlock,
  containsManagedBlock,
  installPowerShellIntegration,
  removePowerShellIntegration,
  stripManagedBlock,
} from '../src/shell/powershell-integration';
import { makeTempDir, readFile, removeTempDirs, writeFile } from './helpers';

afterEach(removeTempDirs);

/**
 * Every test here works on a throwaway profile inside a temp directory.
 * The real PowerShell profile is never read or written.
 */
function makeTarget() {
  const dir = makeTempDir('dev-island-profile-');
  return {
    dir,
    profilePath: path.join(dir, 'Documents', 'PowerShell', 'profile.ps1'),
    hookScriptPath: path.join(dir, 'data', 'shell', 'dev-island-hook.ps1'),
    pipeShortName: 'dev-island-testpipe',
    tokenFilePath: path.join(dir, 'data', 'pipe-token'),
    pendingFilePath: path.join(dir, 'data', 'pending-notification.json'),
    launcherFilePath: path.join(dir, 'data', 'launcher.json'),
    launchLockPath: path.join(dir, 'data', 'launching'),
  };
}

const USER_CONTENT = [
  'Set-Alias ll Get-ChildItem',
  '',
  'function prompt { "meu-prompt> " }',
  '',
].join('\r\n');

describe('installPowerShellIntegration', () => {
  it('creates the profile and the hook script when nothing exists', () => {
    const target = makeTarget();
    const result = installPowerShellIntegration(target);

    expect(result.profileUpdated).toBe(true);
    expect(result.hookUpdated).toBe(true);
    expect(result.backupPath).toBeNull();

    const profile = readFile(target.profilePath);
    expect(profile).toContain(SHELL_BLOCK_BEGIN);
    expect(profile).toContain(SHELL_BLOCK_END);
    expect(profile).toContain(target.hookScriptPath);

    const hook = readFile(target.hookScriptPath);
    expect(hook).toContain("$env:TERM_PROGRAM -ne 'vscode'");
    expect(hook).toContain(target.pipeShortName);
    expect(hook).toContain(target.tokenFilePath);
  });

  it('preserves existing content and backs it up before the first change', () => {
    const target = makeTarget();
    writeFile(target.profilePath, USER_CONTENT);

    const result = installPowerShellIntegration(target);
    expect(result.backupPath).toBe(`${target.profilePath}${BACKUP_SUFFIX}`);
    expect(readFile(result.backupPath!)).toBe(USER_CONTENT);

    const profile = readFile(target.profilePath);
    expect(profile).toContain('Set-Alias ll Get-ChildItem');
    expect(profile).toContain('function prompt { "meu-prompt> " }');
    expect(profile).toContain(SHELL_BLOCK_BEGIN);
  });

  it('is idempotent: a second run changes nothing', () => {
    const target = makeTarget();
    writeFile(target.profilePath, USER_CONTENT);

    installPowerShellIntegration(target);
    const afterFirst = readFile(target.profilePath);

    const second = installPowerShellIntegration(target);
    expect(second.profileUpdated).toBe(false);
    expect(second.hookUpdated).toBe(false);
    expect(readFile(target.profilePath)).toBe(afterFirst);

    const third = installPowerShellIntegration(target);
    expect(third.profileUpdated).toBe(false);
    expect(readFile(target.profilePath)).toBe(afterFirst);
    expect(readFile(target.profilePath).match(new RegExp(SHELL_BLOCK_BEGIN, 'g'))).toHaveLength(1);
  });

  it('does not take a second backup on later runs', () => {
    const target = makeTarget();
    writeFile(target.profilePath, USER_CONTENT);
    installPowerShellIntegration(target);

    writeFile(`${target.profilePath}${BACKUP_SUFFIX}`, 'backup original');
    installPowerShellIntegration(target);
    expect(readFile(`${target.profilePath}${BACKUP_SUFFIX}`)).toBe('backup original');
  });

  it('keeps CRLF line endings', () => {
    const target = makeTarget();
    writeFile(target.profilePath, USER_CONTENT);
    installPowerShellIntegration(target);
    const profile = readFile(target.profilePath);
    expect(profile).toContain('\r\n');
    expect(profile.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
  });
});

describe('block versioning', () => {
  const V1_BLOCK = [
    '# >>> Dev Island integration >>>',
    '# Managed by Dev Island. Do not edit inside this block.',
    "if ($env:TERM_PROGRAM -eq 'vscode') { . 'C:/antigo/hook.ps1' }",
    '# <<< Dev Island integration <<<',
  ].join('\r\n');

  it('replaces a block written by an older version instead of stacking one', () => {
    const target = makeTarget();
    writeFile(target.profilePath, `${USER_CONTENT}\r\n${V1_BLOCK}\r\nWrite-Host "depois"\r\n`);

    const result = installPowerShellIntegration(target);
    expect(result.profileUpdated).toBe(true);

    const profile = readFile(target.profilePath);
    expect(profile).toContain(SHELL_BLOCK_BEGIN);
    expect(profile).toMatch(/integration v\d+ >>>/);
    // Exactly one managed block, and the old hook path is gone.
    expect(profile.match(/Dev Island integration.*>>>/g)).toHaveLength(1);
    expect(profile).not.toContain('C:/antigo/hook.ps1');
    // Everything the user wrote survives.
    expect(profile).toContain('Set-Alias ll Get-ChildItem');
    expect(profile).toContain('Write-Host "depois"');
  });

  it('still removes a block written by an older version', () => {
    const target = makeTarget();
    writeFile(target.profilePath, `${USER_CONTENT}\r\n${V1_BLOCK}\r\n`);

    const result = removePowerShellIntegration(target);
    expect(result.removed).toBe(true);
    expect(readFile(target.profilePath)).not.toContain('Dev Island integration');
    expect(readFile(target.profilePath)).toContain('Set-Alias ll Get-ChildItem');
  });

  it('carries the version in the begin marker', () => {
    expect(SHELL_BLOCK_BEGIN).toMatch(/^# >>> Dev Island integration v\d+ >>>$/);
  });
});

describe('stripManagedBlock', () => {
  it('removes only the managed block', () => {
    const content = `${USER_CONTENT}\r\n${buildProfileBlock('C:\\hook.ps1')}\r\nWrite-Host "depois"\r\n`;
    const stripped = stripManagedBlock(content);

    expect(stripped.removed).toBe(true);
    expect(stripped.unterminated).toBe(false);
    expect(stripped.content).toContain('Set-Alias ll Get-ChildItem');
    expect(stripped.content).toContain('Write-Host "depois"');
    expect(stripped.content).not.toContain(SHELL_BLOCK_BEGIN);
    expect(stripped.content).not.toContain('C:\\hook.ps1');
  });

  it('removes every managed block if the file somehow has more than one', () => {
    const block = buildProfileBlock('C:\\hook.ps1');
    const stripped = stripManagedBlock(`${block}\n\nWrite-Host "meio"\n\n${block}\n`);
    expect(stripped.content).not.toContain(SHELL_BLOCK_BEGIN);
    expect(stripped.content).toContain('Write-Host "meio"');
  });

  it('refuses to touch a block whose end marker is missing', () => {
    const content = `Write-Host "antes"\n${SHELL_BLOCK_BEGIN}\n. C:\\hook.ps1\n`;
    const stripped = stripManagedBlock(content);
    expect(stripped.removed).toBe(false);
    expect(stripped.unterminated).toBe(true);
    expect(stripped.content).toContain('. C:\\hook.ps1');
  });

  it('leaves an untouched profile exactly as it was', () => {
    const stripped = stripManagedBlock(USER_CONTENT);
    expect(stripped.removed).toBe(false);
    expect(stripped.content).toBe(USER_CONTENT);
  });
});

describe('removePowerShellIntegration', () => {
  it('removes the block and the hook script, keeping user content', () => {
    const target = makeTarget();
    writeFile(target.profilePath, USER_CONTENT);
    installPowerShellIntegration(target);

    const result = removePowerShellIntegration(target);
    expect(result.removed).toBe(true);
    expect(result.hookScriptRemoved).toBe(true);
    expect(fs.existsSync(target.hookScriptPath)).toBe(false);

    const profile = readFile(target.profilePath);
    expect(containsManagedBlock(profile)).toBe(false);
    expect(profile).toContain('Set-Alias ll Get-ChildItem');
    expect(profile).toContain('function prompt { "meu-prompt> " }');
  });

  it('restores the profile to its original content', () => {
    const target = makeTarget();
    writeFile(target.profilePath, USER_CONTENT);
    installPowerShellIntegration(target);
    removePowerShellIntegration(target);
    expect(readFile(target.profilePath).replace(/(\r?\n)+$/, '')).toBe(
      USER_CONTENT.replace(/(\r?\n)+$/, ''),
    );
  });

  it('is a no-op on a profile it never touched', () => {
    const target = makeTarget();
    writeFile(target.profilePath, USER_CONTENT);
    const result = removePowerShellIntegration(target);
    expect(result.removed).toBe(false);
    expect(readFile(target.profilePath)).toBe(USER_CONTENT);
  });

  it('does nothing when the profile does not exist', () => {
    const target = makeTarget();
    const result = removePowerShellIntegration(target);
    expect(result.removed).toBe(false);
    expect(fs.existsSync(target.profilePath)).toBe(false);
  });
});
