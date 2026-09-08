import { describe, expect, it } from 'vitest';

import {
  decideVisibility,
  isVsCodeProcess,
  VisibilityController,
  type Anchor,
  type DecisionInput,
  type ForegroundWindow,
  type VisibilityContext,
  type WidgetWindowPort,
} from '../src/main/visibility';

const OWN_PID = 4242;

function window(processName: string, pid: number, overrides: Partial<ForegroundWindow> = {}): ForegroundWindow {
  return {
    pid,
    windowHandle: `0x${pid.toString(16).toUpperCase().padStart(16, '0')}`,
    processName,
    title: processName,
    minimized: false,
    x: 100,
    y: 50,
    width: 1600,
    height: 900,
    ...overrides,
  };
}

const VS_CODE = window('code.exe', 900);
const CHROME = window('chrome.exe', 901);
const CMD = window('cmd.exe', 902);
const OWN_WINDOW = window('electron.exe', OWN_PID);

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    foreground: VS_CODE,
    ownPid: OWN_PID,
    lastExternalWasVsCode: true,
    hasActiveProject: true,
    hasProjectConfig: true,
    hasLiveTerminal: true,
    hasPendingAuthorization: false,
    preview: false,
    dismissed: false,
    foregroundHasProject: true,
    ...overrides,
  };
}

/** Records everything the controller is allowed to do to the window. */
function fakeWindow() {
  const calls: string[] = [];
  let visible = false;
  let onTop = false;
  let position: Anchor | null = null;

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
    setAlwaysOnTop: (flag) => {
      onTop = flag;
      calls.push(`alwaysOnTop:${flag}`);
    },
    positionOver: (anchor) => {
      position = anchor;
      calls.push('positionOver');
    },
  };

  return {
    port,
    calls,
    get visible() {
      return visible;
    },
    get onTop() {
      return onTop;
    },
    get position() {
      return position;
    },
  };
}

function fakeContext(overrides: Partial<Record<keyof VisibilityContext, boolean>> = {}) {
  const flags = {
    hasActiveProject: true,
    hasProjectConfig: true,
    hasLiveTerminal: true,
    hasPendingAuthorization: false,
    preview: false,
    dismissed: false,
    foregroundHasProject: true,
    ...overrides,
  };
  const context: VisibilityContext = {
    hasActiveProject: () => flags.hasActiveProject,
    hasProjectConfig: () => flags.hasProjectConfig,
    hasLiveTerminal: () => flags.hasLiveTerminal,
    hasPendingAuthorization: () => flags.hasPendingAuthorization,
    preview: () => flags.preview,
    dismissed: () => flags.dismissed,
  };
  return { context, flags };
}

describe('isVsCodeProcess', () => {
  it('recognises Code.exe regardless of case', () => {
    expect(isVsCodeProcess('code.exe')).toBe(true);
    expect(isVsCodeProcess('Code.exe')).toBe(true);
    expect(isVsCodeProcess(' CODE.EXE ')).toBe(true);
  });

  it('does not recognise anything else', () => {
    for (const name of ['chrome.exe', 'cmd.exe', 'explorer.exe', 'windowsterminal.exe', '']) {
      expect(isVsCodeProcess(name)).toBe(false);
    }
  });
});

describe('decideVisibility', () => {
  it('shows when VS Code owns the foreground and a project is active', () => {
    const decision = decideVisibility(input());
    expect(decision.visible).toBe(true);
    expect(decision.reason).toBe('vscode-in-foreground');
    expect(decision.anchor).toEqual({ x: 100, y: 50, width: 1600, height: 900 });
  });

  it('hides when Chrome owns the foreground', () => {
    const decision = decideVisibility(input({ foreground: CHROME }));
    expect(decision.visible).toBe(false);
    expect(decision.reason).toBe('another-app-in-foreground');
  });

  it('hides when an external CMD owns the foreground', () => {
    const decision = decideVisibility(input({ foreground: CMD }));
    expect(decision.visible).toBe(false);
    expect(decision.reason).toBe('another-app-in-foreground');
  });

  it('hides when VS Code is minimized', () => {
    const decision = decideVisibility(input({ foreground: { ...VS_CODE, minimized: true } }));
    expect(decision.visible).toBe(false);
    expect(decision.reason).toBe('window-minimized');
  });

  it('hides when nothing owns the foreground (VS Code closed)', () => {
    expect(decideVisibility(input({ foreground: null }))).toMatchObject({
      visible: false,
      reason: 'no-foreground-window',
    });
  });

  it('keeps the widget visible while the user interacts with it', () => {
    const decision = decideVisibility(
      input({ foreground: OWN_WINDOW, lastExternalWasVsCode: true }),
    );
    expect(decision.visible).toBe(true);
    expect(decision.reason).toBe('widget-interaction');
    expect(decision.anchor).toBeNull();
  });

  it('does not treat its own window as context when it came from Chrome', () => {
    expect(
      decideVisibility(input({ foreground: OWN_WINDOW, lastExternalWasVsCode: false })),
    ).toMatchObject({ visible: false, reason: 'widget-without-vscode-context' });
  });

  it('--preview shows the widget outside VS Code', () => {
    for (const foreground of [CHROME, CMD, null]) {
      expect(decideVisibility(input({ foreground, preview: true }))).toMatchObject({
        visible: true,
        reason: 'preview',
        anchor: null,
      });
    }
  });

  it('requires an active, configured project reached through a live terminal', () => {
    expect(decideVisibility(input({ hasActiveProject: false }))).toMatchObject({
      visible: false,
      reason: 'no-active-project',
    });
    expect(decideVisibility(input({ hasProjectConfig: false }))).toMatchObject({
      visible: false,
      reason: 'no-configuration',
    });
    expect(decideVisibility(input({ hasLiveTerminal: false }))).toMatchObject({
      visible: false,
      reason: 'no-live-terminal',
    });
  });

  it('preview does not bypass the missing-project checks', () => {
    expect(
      decideVisibility(input({ preview: true, hasActiveProject: false })),
    ).toMatchObject({ visible: false, reason: 'no-active-project' });
  });

  it('still shows an authorization prompt for a project that is not active yet', () => {
    const decision = decideVisibility(
      input({ hasActiveProject: false, hasProjectConfig: false, hasPendingAuthorization: true }),
    );
    expect(decision.visible).toBe(true);
    expect(decision.reason).toBe('vscode-in-foreground');
  });

  it('stays hidden after the user pressed Close', () => {
    expect(decideVisibility(input({ dismissed: true }))).toMatchObject({
      visible: false,
      reason: 'dismissed-by-user',
    });
  });
});

describe('VisibilityController', () => {
  it('shows over the VS Code window without stealing focus', () => {
    const view = fakeWindow();
    const { context } = fakeContext();
    const controller = new VisibilityController(view.port, context, OWN_PID);

    controller.handleForeground(VS_CODE);

    expect(view.visible).toBe(true);
    expect(view.onTop).toBe(true);
    expect(view.position).toEqual({ x: 100, y: 50, width: 1600, height: 900 });
    expect(view.calls).toContain('showInactive');
    // The port has no way to focus or activate the window at all.
    expect(Object.keys(view.port)).not.toContain('focus');
    expect(Object.keys(view.port)).not.toContain('show');
  });

  it('hides and drops always-on-top when another app takes over', () => {
    const view = fakeWindow();
    const { context } = fakeContext();
    const controller = new VisibilityController(view.port, context, OWN_PID);

    controller.handleForeground(VS_CODE);
    view.calls.length = 0;

    controller.handleForeground(CHROME);
    expect(view.visible).toBe(false);
    expect(view.onTop).toBe(false);
    expect(view.calls).toEqual(['hide', 'alwaysOnTop:false']);

    controller.handleForeground(CMD);
    expect(view.visible).toBe(false);
  });

  it('hides the window when VS Code is minimized', () => {
    const view = fakeWindow();
    const controller = new VisibilityController(view.port, fakeContext().context, OWN_PID);

    controller.handleForeground(VS_CODE);
    expect(view.visible).toBe(true);

    controller.handleForeground({ ...VS_CODE, minimized: true });
    expect(view.visible).toBe(false);
    expect(controller.decision.reason).toBe('window-minimized');
  });

  it('reappears without stealing focus when VS Code comes back', () => {
    const view = fakeWindow();
    const controller = new VisibilityController(view.port, fakeContext().context, OWN_PID);

    controller.handleForeground(VS_CODE);
    controller.handleForeground(CHROME);
    view.calls.length = 0;

    controller.handleForeground(VS_CODE);
    expect(view.visible).toBe(true);
    expect(view.calls.filter((call) => call === 'showInactive')).toHaveLength(1);
    expect(view.calls).not.toContain('focus');
  });

  it('survives a click on the widget itself', () => {
    const view = fakeWindow();
    const controller = new VisibilityController(view.port, fakeContext().context, OWN_PID);

    controller.handleForeground(VS_CODE);
    view.calls.length = 0;

    // Clicking the capsule makes Electron the foreground process.
    controller.handleForeground(OWN_WINDOW);
    expect(view.visible).toBe(true);
    expect(view.calls).not.toContain('hide');
    expect(controller.decision.reason).toBe('widget-interaction');

    // ... and switching to Chrome afterwards still hides it.
    controller.handleForeground(CHROME);
    expect(view.visible).toBe(false);
  });

  it('does not move a widget the user dragged while the anchor is unchanged', () => {
    const view = fakeWindow();
    const controller = new VisibilityController(view.port, fakeContext().context, OWN_PID);

    controller.handleForeground(VS_CODE);
    view.calls.length = 0;

    controller.handleForeground(VS_CODE);
    expect(view.calls).not.toContain('positionOver');

    // Moving the VS Code window does re-anchor it.
    controller.handleForeground({ ...VS_CODE, x: 800 });
    expect(view.calls).toContain('positionOver');
  });

  it('--preview shows the widget with Chrome in the foreground', () => {
    const view = fakeWindow();
    const { context } = fakeContext({ preview: true });
    const controller = new VisibilityController(view.port, context, OWN_PID);

    controller.handleForeground(CHROME);
    expect(view.visible).toBe(true);
    expect(controller.decision.reason).toBe('preview');
  });

  it('hides when the last terminal of the project is gone', () => {
    const view = fakeWindow();
    const { context, flags } = fakeContext();
    const controller = new VisibilityController(view.port, context, OWN_PID);

    controller.handleForeground(VS_CODE);
    expect(view.visible).toBe(true);

    flags.hasLiveTerminal = false;
    controller.refresh();
    expect(view.visible).toBe(false);
    expect(controller.decision.reason).toBe('no-live-terminal');
  });
});
