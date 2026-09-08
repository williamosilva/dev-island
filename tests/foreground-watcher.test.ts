import { describe, expect, it } from 'vitest';

import { parseForegroundLine } from '../src/main/foreground-watcher';
import { buildForegroundScript } from '../src/shell/foreground-script';

describe('parseForegroundLine', () => {
  it('parses a report and normalises the process name', () => {
    const line = JSON.stringify({
      pid: 900,
      windowHandle: '0xa1b2c',
      processName: 'Code.exe',
      title: 'projeto - Visual Studio Code',
      minimized: false,
      x: 10,
      y: -8,
      width: 1920,
      height: 1080,
    });
    expect(parseForegroundLine(line)).toEqual({
      pid: 900,
      windowHandle: '0x00000000000A1B2C',
      processName: 'code.exe',
      title: 'projeto - Visual Studio Code',
      minimized: false,
      x: 10,
      y: -8,
      width: 1920,
      height: 1080,
    });
  });

  it('maps the literal null to "no foreground window"', () => {
    expect(parseForegroundLine('null')).toBeNull();
    expect(parseForegroundLine('  null  ')).toBeNull();
  });

  it('drops anything that is not a valid report', () => {
    for (const line of [
      '',
      '   ',
      'not json',
      '[]',
      '{}',
      '{"pid":"x","processName":"a.exe"}',
      // A report with no window handle is unusable for picking a project.
      '{"pid":1,"processName":"a.exe"}',
      '{"pid":1,"windowHandle":"nao-hex","processName":"a.exe"}',
    ]) {
      expect(parseForegroundLine(line)).toBeUndefined();
    }
  });

  it('defaults a missing geometry to zero instead of failing', () => {
    expect(
      parseForegroundLine(JSON.stringify({ pid: 1, windowHandle: '0x1', processName: 'a.exe' })),
    ).toEqual({
      pid: 1,
      windowHandle: '0x0000000000000001',
      processName: 'a.exe',
      title: '',
      minimized: false,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe('buildForegroundScript', () => {
  const script = buildForegroundScript(150);

  it('only reads window metadata', () => {
    expect(script).toContain('GetForegroundWindow');
    expect(script).toContain('GetWindowThreadProcessId');
    expect(script).toContain('IsIconic');
    expect(script).toContain('GetWindowRect');
    expect(script).toContain('GetWindowText');
    expect(script).toContain("'0x' + $handle.ToInt64().ToString('X16')");
    // Nothing that could activate, move or close someone else's window.
    for (const forbidden of ['SetForegroundWindow', 'ShowWindow', 'SetWindowPos', 'CloseWindow']) {
      expect(script).not.toContain(forbidden);
    }
  });

  it('emits only on change and honours the poll interval', () => {
    expect(script).toContain('if ($line -ne $last)');
    expect(script).toContain('Start-Sleep -Milliseconds 150');
    expect(buildForegroundScript(40)).toContain('Start-Sleep -Milliseconds 50');
  });

  it('is emitted with Windows line endings', () => {
    expect(script.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
  });
});
