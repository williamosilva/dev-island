import { describe, expect, it } from 'vitest';

import { buildHookScript } from '../src/shell/hook-script';

const script = buildHookScript({
  pipeShortName: 'dev-island-abc123',
  tokenFilePath: 'C:\\data\\pipe-token',
  pendingFilePath: 'C:\\data\\pending-notification.json',
  launcherFilePath: 'C:\\data\\launcher.json',
  launchLockPath: 'C:\\data\\launching',
});

describe('buildHookScript', () => {
  it('does nothing outside the VS Code integrated terminal', () => {
    expect(script).toContain("if ($env:TERM_PROGRAM -ne 'vscode') { return }");
  });

  it('embeds the pipe name and the token file', () => {
    expect(script).toContain("'dev-island-abc123'");
    expect(script).toContain("'C:\\data\\pipe-token'");
  });

  it('reports every directory, leaving discovery to the app', () => {
    // No config filter any more: the app walks up to the nearest package.json.
    expect(script).not.toContain('DevIslandConfigRelative');
    expect(script).toContain('Send-DevIslandLocation -ProjectPath $current');
  });

  it('starts the app itself when nobody is listening', () => {
    expect(script).toContain('if (-not (Test-DevIslandPipe)) {');
    expect(script).toContain('Start-DevIslandProcess -ProjectPath $ProjectPath');
    expect(script).toContain("'C:\\data\\pending-notification.json'");
    expect(script).toContain("'C:\\data\\launcher.json'");
    expect(script).toContain('-WindowStyle Hidden');
  });

  it('reports the PowerShell PID so the app can track that terminal', () => {
    expect(script).toContain('shellPid     = $PID');
  });

  it('reports the VS Code window that owns the foreground', () => {
    expect(script).toContain('$handle = Get-DevIslandVsCodeWindow');
    expect(script).toContain('windowHandle = $handle');
    expect(script).toContain('GetForegroundWindow');
    // Only a real VS Code window may be associated with a project.
    expect(script).toContain("-ine 'Code.exe'");
    // The handle travels as hex text, never as a number.
    expect(script).toContain("'0x' + $handle.ToInt64().ToString('X16')");
  });

  it('skips a directory it already reported', () => {
    expect(script).toContain('$current -ne $global:DevIslandLastPath');
  });

  it('wraps the existing prompt instead of replacing it', () => {
    expect(script).toContain('if (-not (Test-Path function:global:DevIslandOriginalPrompt))');
    // The original prompt is stored as a function, so it must be called by
    // name: `& $global:DevIslandOriginalPrompt` would dereference a variable
    // that does not exist and break every prompt in the session.
    expect(script).toMatch(/^\s*DevIslandOriginalPrompt\s*$/m);
    expect(script).not.toContain('& $global:DevIslandOriginalPrompt');
  });

  it('is emitted with Windows line endings', () => {
    expect(script).toContain('\r\n');
    expect(script.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
  });

  it('never lets a failure escape into the shell', () => {
    expect(script).toContain('} catch { }');
    expect(script).toContain('$client.Connect(300)');
  });
});
