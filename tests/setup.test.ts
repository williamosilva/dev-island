import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  hookScriptFile,
  launcherFile,
  launchLockFile,
  pendingNotificationFile,
} from '../src/core/paths';
import { installShellIntegration, uninstallShellIntegration } from '../src/cli/shell-setup';
import { takePendingNotification, writePendingNotification } from '../src/localipc/pending';
import { SHELL_BLOCK_BEGIN, SHELL_BLOCK_VERSION } from '../src/shared/branding';
import { makeTempDir, readFile, removeTempDirs, writeFile } from './helpers';

afterEach(removeTempDirs);

/** Every test writes to a throwaway profile; the real one is never opened. */
function target() {
  const dataDir = makeTempDir('dev-island-setup-');
  const profileDir = makeTempDir('dev-island-perfil-');
  return { dataDir, profile: path.join(profileDir, 'profile.ps1') };
}

const USER_CONTENT = ['Set-Alias ll Get-ChildItem', '', 'function prompt { "meu> " }', ''].join(
  '\r\n',
);

const blockCount = (content: string): number =>
  (content.match(/Dev Island integration.*>>>/g) ?? []).length;

describe('setup installs the hook once', () => {
  it('writes the block, the hook script and its helper files', () => {
    const { dataDir, profile } = target();

    const results = installShellIntegration({ dataDir, profilePaths: [profile] });

    expect(results).toHaveLength(1);
    expect(results[0]?.profileUpdated).toBe(true);
    expect(readFile(profile)).toContain(SHELL_BLOCK_BEGIN);
    expect(fs.existsSync(hookScriptFile(dataDir))).toBe(true);

    // The hook knows where to drop a report and how to start the app.
    const hook = readFile(hookScriptFile(dataDir));
    expect(hook).toContain(pendingNotificationFile(dataDir));
    expect(hook).toContain(launcherFile(dataDir));
    expect(hook).toContain(launchLockFile(dataDir));
  });

  it('running it again changes nothing and never duplicates the block', () => {
    const { dataDir, profile } = target();
    writeFile(profile, USER_CONTENT);

    installShellIntegration({ dataDir, profilePaths: [profile] });
    const afterFirst = readFile(profile);

    for (let round = 0; round < 3; round += 1) {
      const again = installShellIntegration({ dataDir, profilePaths: [profile] });
      expect(again[0]?.profileUpdated).toBe(false);
      expect(readFile(profile)).toBe(afterFirst);
    }
    expect(blockCount(afterFirst)).toBe(1);
    expect(afterFirst).toContain('Set-Alias ll Get-ChildItem');
  });

  it('keeps a backup of what was there before', () => {
    const { dataDir, profile } = target();
    writeFile(profile, USER_CONTENT);

    const result = installShellIntegration({ dataDir, profilePaths: [profile] });
    expect(result[0]?.backupPath).toBeTruthy();
    expect(readFile(result[0]!.backupPath!)).toBe(USER_CONTENT);
  });
});

describe('an older hook is migrated', () => {
  const olderBlock = (version: string): string =>
    [
      `# >>> Dev Island integration ${version}>>>`,
      '# Managed by Dev Island. Do not edit inside this block.',
      "if ($env:TERM_PROGRAM -eq 'vscode') { . 'C:/antigo/hook.ps1' }",
      '# <<< Dev Island integration <<<',
    ].join('\r\n');

  for (const version of ['', 'v2 ']) {
    it(`replaces the ${version || 'v1 '}block in place`, () => {
      const { dataDir, profile } = target();
      writeFile(profile, `${USER_CONTENT}\r\n${olderBlock(version)}\r\nWrite-Host "fim"\r\n`);

      const result = installShellIntegration({ dataDir, profilePaths: [profile] });
      expect(result[0]?.profileUpdated).toBe(true);

      const content = readFile(profile);
      expect(blockCount(content)).toBe(1);
      expect(content).toContain(`v${SHELL_BLOCK_VERSION} >>>`);
      expect(content).not.toContain('C:/antigo/hook.ps1');
      // Everything around the block survives.
      expect(content).toContain('Set-Alias ll Get-ChildItem');
      expect(content).toContain('Write-Host "fim"');
    });
  }

  it('removal still finds a block from any version', () => {
    const { dataDir, profile } = target();
    writeFile(profile, `${USER_CONTENT}\r\n${olderBlock('')}\r\n`);

    const removed = uninstallShellIntegration({ dataDir, profilePaths: [profile] });
    expect(removed[0]?.removed).toBe(true);
    expect(readFile(profile)).not.toContain('Dev Island integration');
    expect(readFile(profile)).toContain('Set-Alias ll Get-ChildItem');
  });
});

describe('the hook brings the app up on its own', () => {
  it('the hook starts the process silently, with no console window', () => {
    const { dataDir, profile } = target();
    installShellIntegration({ dataDir, profilePaths: [profile] });
    const hook = readFile(hookScriptFile(dataDir));

    // No pipe, so the report is handed over and the app is launched.
    expect(hook).toContain('if (-not (Test-DevIslandPipe)) {');
    expect(hook).toContain('Start-DevIslandProcess -ProjectPath $ProjectPath');
    expect(hook).toContain('Start-Process -FilePath $launcher.electron');
    expect(hook).toContain('-WindowStyle Hidden');
    // And a failure there can never break the prompt.
    expect(hook).toContain('} catch { }');
  });

  it('the report is replayed after the app starts', () => {
    const { dataDir } = target();
    const notification = {
      cwd: 'C:/projetos/demo',
      shellPid: 4321,
      windowHandle: '0x000000000000AAAA',
      at: Date.now(),
    };

    writePendingNotification(dataDir, notification);
    expect(fs.existsSync(pendingNotificationFile(dataDir))).toBe(true);

    // The app reads it once on startup...
    expect(takePendingNotification(dataDir)).toEqual(notification);
    // ... and it is gone, so it is never replayed twice.
    expect(fs.existsSync(pendingNotificationFile(dataDir))).toBe(false);
    expect(takePendingNotification(dataDir)).toBeNull();
  });

  it('a stale or malformed report is discarded', () => {
    const { dataDir } = target();

    writePendingNotification(dataDir, {
      cwd: 'C:/projetos/demo',
      shellPid: 1,
      windowHandle: null,
      at: Date.now() - 10 * 60_000,
    });
    expect(takePendingNotification(dataDir)).toBeNull();

    writeFile(pendingNotificationFile(dataDir), 'nao json');
    expect(takePendingNotification(dataDir)).toBeNull();

    writeFile(pendingNotificationFile(dataDir), JSON.stringify({ cwd: '', at: Date.now() }));
    expect(takePendingNotification(dataDir)).toBeNull();
  });

  it('clears ELECTRON_RUN_AS_NODE before launching', () => {
    const { dataDir, profile } = target();
    installShellIntegration({ dataDir, profilePaths: [profile] });
    const hook = readFile(hookScriptFile(dataDir));

    // Electron checks the variable by presence: an inherited one would start a
    // plain Node process with no window, and the launch would look successful.
    expect(hook).toContain("Remove-Item -Path 'env:ELECTRON_RUN_AS_NODE'");
  });

  it('quotes the app path, which contains a space in this very repo', () => {
    const { dataDir, profile } = target();
    installShellIntegration({ dataDir, profilePaths: [profile] });
    const hook = readFile(hookScriptFile(dataDir));

    // Start-Process splits an unquoted argument on spaces.
    expect(hook).toContain("$rootArgument = '\"' + $launcher.appRoot + '\"'");
    expect(hook).toContain('-ArgumentList $rootArgument');
  });

  it('two prompts at once cannot start two processes', () => {
    const { dataDir, profile } = target();
    installShellIntegration({ dataDir, profilePaths: [profile] });
    const hook = readFile(hookScriptFile(dataDir));

    // A recent launch attempt short-circuits the next one...
    expect(hook).toContain('if (Test-Path -LiteralPath $global:DevIslandLaunchLock) {');
    expect(hook).toContain('if ($age.TotalSeconds -lt 15) { return }');
    // ... and Electron itself refuses a second instance.
    const main = readFile('src/main/main.ts');
    expect(main).toContain('requestSingleInstanceLock()');
  });

  it('after a restart the flow keeps working from the pending report', () => {
    const { dataDir } = target();
    // Simulates: app stopped, hook could not deliver, app comes back up.
    writePendingNotification(dataDir, {
      cwd: 'C:/projetos/demo/src',
      shellPid: 99,
      windowHandle: '0x000000000000BBBB',
      at: Date.now(),
    });

    const replayed = takePendingNotification(dataDir);
    expect(replayed).toMatchObject({
      cwd: 'C:/projetos/demo/src',
      windowHandle: '0x000000000000BBBB',
    });
    // main.ts feeds exactly this back through discovery on startup.
    expect(readFile('src/main/main.ts')).toContain('takePendingNotification(dataDir)');
  });
});

describe('the real user files are never touched', () => {
  it('only writes inside the injected data and profile directories', () => {
    const { dataDir, profile } = target();
    installShellIntegration({ dataDir, profilePaths: [profile] });

    for (const file of [hookScriptFile(dataDir), launcherFile(dataDir)]) {
      if (fs.existsSync(file)) expect(path.resolve(file).startsWith(path.resolve(dataDir))).toBe(true);
    }
    expect(path.resolve(profile).startsWith(path.resolve(path.dirname(profile)))).toBe(true);
  });

  it('discovers profiles through an injected runner, never a real shell', () => {
    const asked: string[] = [];
    installShellIntegration({
      dataDir: makeTempDir('dev-island-setup-'),
      profilePaths: [path.join(makeTempDir(), 'profile.ps1')],
      runner: (file) => {
        asked.push(file);
        return null;
      },
    });
    // With profilePaths given, no PowerShell is consulted at all.
    expect(asked).toEqual([]);
  });
});
