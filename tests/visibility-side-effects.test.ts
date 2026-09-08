import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeButtonsFile } from '../src/core/buttons-config';
import { ProjectRegistry } from '../src/core/registry';
import { PtyManager } from '../src/main/pty-manager';
import {
  VisibilityController,
  type ForegroundWindow,
  type VisibilityContext,
  type WidgetWindowPort,
} from '../src/main/visibility';
import { WidgetState } from '../src/main/widget-state';
import { makeTempDir, removeTempDirs, writePackageJson } from './helpers';

afterEach(removeTempDirs);

const VS_CODE: ForegroundWindow = {
  pid: 900,
  windowHandle: '0x000000000000AAAA',
  processName: 'code.exe',
  title: 'projeto',
  minimized: false,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
};

const CHROME: ForegroundWindow = { ...VS_CODE, pid: 901, processName: 'chrome.exe' };

function setup() {
  const dataDir = makeTempDir('dev-island-data-');
  const projectDir = makeTempDir('dev-island-project-');
  writePackageJson(projectDir, { name: 'demo', scripts: { dev: 'vite' } });
  writeButtonsFile(projectDir, { buttons: [{ name: 'Dev', script: 'npm run dev' }] });

  const registry = new ProjectRegistry(dataDir);
  registry.authorize(projectDir, 'demo');

  const pty = new PtyManager();
  const state = new WidgetState(registry, pty);
  state.activate(projectDir);

  const calls: string[] = [];
  let visible = false;
  const port: WidgetWindowPort = {
    isDestroyed: () => false,
    isVisible: () => visible,
    showInactive: () => {
      visible = true;
      calls.push('showInactive');
    },
    hide: () => {
      visible = false;
      calls.push('hide');
    },
    setAlwaysOnTop: (flag) => calls.push(`alwaysOnTop:${flag}`),
    positionOver: () => calls.push('positionOver'),
  };

  const context: VisibilityContext = {
    hasActiveProject: () => state.activeProject !== null,
    hasProjectConfig: () => state.hasProjectConfig,
    hasLiveTerminal: () => true,
    hasPendingAuthorization: () => state.hasPendingAuthorization,
    preview: () => false,
    dismissed: () => false,
  };

  return {
    dataDir,
    projectDir: path.resolve(projectDir),
    pty,
    state,
    calls,
    controller: new VisibilityController(port, context, 4242),
    isVisible: () => visible,
  };
}

describe('hiding the widget leaves everything else running', () => {
  it('never touches the PTY manager', () => {
    const env = setup();
    const stop = vi.spyOn(env.pty, 'stop');
    const clear = vi.spyOn(env.pty, 'clear');
    const restart = vi.spyOn(env.pty, 'restart');
    const start = vi.spyOn(env.pty, 'start');
    const disposeAll = vi.spyOn(env.pty, 'disposeAll');

    env.controller.handleForeground(VS_CODE);
    expect(env.isVisible()).toBe(true);

    env.controller.handleForeground(CHROME);
    expect(env.isVisible()).toBe(false);

    for (const spy of [stop, clear, restart, start, disposeAll]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('keeps the active project, its buttons and its captured output', () => {
    const env = setup();
    const key = env.state.sessionKey('any-button');

    env.controller.handleForeground(VS_CODE);
    const before = env.state.getState();

    env.controller.handleForeground(CHROME);
    const after = env.state.getState();

    expect(after.project).toEqual(before.project);
    expect(after.buttons).toEqual(before.buttons);
    expect(env.state.activeProject?.path).toBe(env.projectDir);
    // Buffers live in the PTY manager and are untouched by a visibility change.
    expect(env.pty.buffer(key)).toBe('');
    expect(env.pty.snapshot(key)).toEqual({ status: 'idle', exitCode: null });
  });

  it('only flips visibility and always-on-top, never rebuilds the window', () => {
    const env = setup();
    env.controller.handleForeground(VS_CODE);
    env.calls.length = 0;

    env.controller.handleForeground(CHROME);
    expect(env.calls).toEqual(['hide', 'alwaysOnTop:false']);

    // Showing again for the same VS Code window must not re-run the default
    // placement: that is what used to throw away a dragged position.
    env.controller.handleForeground(VS_CODE);
    expect(env.calls).toEqual(['hide', 'alwaysOnTop:false', 'alwaysOnTop:true', 'showInactive']);
    expect(env.calls).not.toContain('positionOver');
  });
});
