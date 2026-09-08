import { app, nativeTheme, type BrowserWindow } from 'electron';

import { discoverProject } from '../core/discovery';
import { normalizeProjectPath, resolveDataDir } from '../core/paths';
import { ProjectRegistry } from '../core/registry';
import { clearRuntimeInfo, writeRuntimeInfo } from '../core/runtime';
import { takePendingNotification } from '../localipc/pending';
import { LocalIpcServer } from '../localipc/server';
import type { IpcRequest, IpcResponse } from '../localipc/protocol';
import { PRODUCT_ID } from '../shared/branding';
import { IPC } from '../shared/ipc';
import { DEFAULT_LAYOUT_LIMITS } from '../shared/layout';
import { PowerShellForegroundWatcher } from './foreground-watcher';
import { registerIpcHandlers } from './ipc-handlers';
import { PreferencesStore } from './preferences';
import { PtyManager } from './pty-manager';
import { TerminalRegistry } from './terminal-registry';
import {
  anchorFromForeground,
  isVsCodeProcess,
  VisibilityController,
  type ForegroundWindow,
  type VisibilityContext,
} from './visibility';
import { WindowProjectRegistry } from './window-projects';
import { WidgetState } from './widget-state';
import { createWidgetWindow, createWindowPort } from './widget-window';
import { WindowPlacement } from './window-placement';
import { WindowStateStore } from './window-state';

const ACTIVATE_FLAG = '--activate=';
const SHELL_PID_FLAG = '--shell-pid=';
const PREVIEW_FLAG = '--preview';

const REFRESH_INTERVAL_MS = 2000;

app.setName(PRODUCT_ID);
app.setAppUserModelId(`com.${PRODUCT_ID}.widget`);

const dataDir = resolveDataDir();
// With DEV_ISLAND_DATA_DIR set this completes the override, single-instance
// lock included, so an isolated run cannot collide with the real one.
app.setPath('userData', dataDir);

const registry = new ProjectRegistry(dataDir);
const pty = new PtyManager();
const terminals = new TerminalRegistry();
// Window handles die with their windows, so this is memory only.
const windowProjects = new WindowProjectRegistry();

const preferences = new PreferencesStore(dataDir, () => nativeTheme.shouldUseDarkColors);
const windowState = new WindowStateStore(dataDir);

let window: BrowserWindow | null = null;
let placement: WindowPlacement | null = null;

const state = new WidgetState(registry, pty, {
  theme: () => preferences.getTheme(),
  layout: () => placement?.limits ?? DEFAULT_LAYOUT_LIMITS,
});
let ipcServer: LocalIpcServer | null = null;
let watcher: PowerShellForegroundWatcher | null = null;
let visibility: VisibilityController | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let previewMode = false;
let dismissed = false;
let quitting = false;
let lastForeground: ForegroundWindow | null = null;
let lastVsCodeHandle: string | null = null;

function getWindow(): BrowserWindow | null {
  return window;
}

interface StartupArgs {
  activatePath: string | null;
  shellPid: number | null;
  preview: boolean;
}

function parseArgv(argv: readonly string[]): StartupArgs {
  const valueOf = (prefix: string): string | null => {
    const flag = argv.find((arg) => arg.startsWith(prefix));
    if (!flag) return null;
    const value = flag.slice(prefix.length).trim();
    return value.length > 0 ? value : null;
  };
  const rawPid = valueOf(SHELL_PID_FLAG);
  const parsedPid = rawPid === null ? Number.NaN : Number.parseInt(rawPid, 10);

  return {
    activatePath: valueOf(ACTIVATE_FLAG),
    shellPid: Number.isInteger(parsedPid) && parsedPid > 0 ? parsedPid : null,
    preview: argv.includes(PREVIEW_FLAG),
  };
}

function sendState(): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(IPC.stateChanged, state.getState());
}

function selectProject(projectPath: string): void {
  const current = state.activeProjectKey;
  if (current !== null && current === normalizeProjectPath(projectPath)) return;
  state.activate(projectPath);
}

function applyForeground(foreground: ForegroundWindow | null): void {
  lastForeground = foreground;

  const anchor = anchorFromForeground(foreground);
  if (anchor && placement?.setAnchor(anchor)) sendState();

  let foregroundHasProject = true;
  if (foreground && isVsCodeProcess(foreground.processName)) {
    lastVsCodeHandle = foreground.windowHandle;
    const projectPath = windowProjects.projectFor(foreground.windowHandle);
    if (projectPath) selectProject(projectPath);
    // Better nothing than the commands of a different window's project.
    foregroundHasProject = projectPath !== null;
  }

  visibility?.handleForeground(foreground, foregroundHasProject);
}

function rememberTerminal(
  projectPath: string,
  shellPid: number | null,
  windowHandle: string | null,
): void {
  dismissed = false;
  terminals.record(normalizeProjectPath(projectPath), shellPid);
  // An older hook or the CLI sends no handle: file it under the window in front.
  const handle = windowHandle ?? lastVsCodeHandle;
  if (handle) windowProjects.record(handle, projectPath, shellPid);
}

/** A prompt was drawn somewhere. Nothing is executed here. */
function handleTerminalReport(
  cwd: string,
  shellPid: number | null,
  preview: boolean,
  windowHandle: string | null,
): IpcResponse {
  if (preview) previewMode = true;

  const outcome = discoverProject(cwd, { isAuthorized: (root) => registry.isAuthorized(root) });

  if (outcome.kind === 'ignored') {
    return { ok: false, error: `nenhum projeto Node encontrado (${outcome.reason})` };
  }

  if (outcome.kind === 'needs-authorization') {
    state.requestAuthorization({
      path: outcome.root,
      name: outcome.name,
      buttons: outcome.buttons,
    });
    rememberTerminal(outcome.root, shellPid, windowHandle);
    applyForeground(lastForeground);
    return { ok: true, message: 'aguardando autorização' };
  }

  // Generated from the project's own manifests, so nothing ran to earn it.
  if (outcome.kind === 'created') registry.authorize(outcome.root, outcome.name);

  const activation = state.activate(outcome.root);
  if (activation.ignored) return { ok: false, error: 'projeto inválido' };

  rememberTerminal(outcome.root, shellPid, windowHandle);
  applyForeground(lastForeground);
  return {
    ok: true,
    message: outcome.kind === 'created' ? 'projeto descoberto' : 'ativo',
  };
}

function handleLocalRequest(request: IpcRequest): IpcResponse {
  switch (request.type) {
    case 'ping':
      return { ok: true, pid: process.pid };

    case 'show':
      // Clears a previous "Fechar"; the VS Code rules still have to allow it.
      dismissed = false;
      visibility?.refresh();
      return { ok: true };

    case 'activate':
      return handleTerminalReport(
        request.cwd,
        request.shellPid,
        request.preview,
        request.windowHandle,
      );

    case 'shutdown':
      setTimeout(() => app.quit(), 50);
      return { ok: true, message: 'encerrando' };

    default:
      return { ok: false, error: 'unknown request type' };
  }
}

const visibilityContext: VisibilityContext = {
  hasActiveProject: () => state.activeProject !== null,
  hasProjectConfig: () => state.hasProjectConfig,
  hasLiveTerminal: () => {
    const key = state.activeProjectKey;
    return key === null ? false : terminals.hasLiveTerminal(key);
  },
  hasPendingAuthorization: () => state.hasPendingAuthorization,
  preview: () => previewMode,
  dismissed: () => dismissed,
};

/** `"<project>|<buttonId>"` -> `buttonId`, only for the active project. */
function keyForActiveProject(key: string): string | null {
  const project = state.activeProject;
  if (!project) return null;
  const prefix = `${normalizeProjectPath(project.path)}|`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const args = parseArgv(argv);
    if (args.preview) previewMode = true;
    if (args.activatePath) handleTerminalReport(args.activatePath, args.shellPid, args.preview, null);
    else visibility?.refresh();
  });

  app.whenReady().then(async () => {
    const startup = parseArgv(process.argv);
    previewMode = startup.preview;

    window = createWidgetWindow();
    window.on('closed', () => {
      window = null;
    });
    window.webContents.on('did-finish-load', () => sendState());

    placement = new WindowPlacement(getWindow, windowState);
    placement.setProject(state.activeProject?.path ?? null);
    window.on('moved', () => placement?.handleMoved());

    registerIpcHandlers({
      state,
      pty,
      getWindow,
      placement,
      onDismiss: () => {
        dismissed = true;
        visibility?.refresh();
      },
      onThemeChange: (theme) => {
        preferences.setTheme(theme);
        sendState();
      },
      onLayoutChange: () => sendState(),
    });

    visibility = new VisibilityController(createWindowPort(getWindow, placement), visibilityContext);

    state.on('change', () => {
      placement?.setProject(state.activeProject?.path ?? null);
      sendState();
      visibility?.refresh();
    });

    // The active project only.
    pty.on('data', (key: string, chunk: string) => {
      const id = keyForActiveProject(key);
      if (id && window && !window.isDestroyed()) window.webContents.send(IPC.ptyData, id, chunk);
    });
    pty.on('status', () => sendState());

    if (startup.activatePath) {
      handleTerminalReport(startup.activatePath, startup.shellPid, startup.preview, null);
    }

    // A report the hook could not deliver because we were not running yet.
    const pendingReport = takePendingNotification(dataDir);
    if (pendingReport) {
      handleTerminalReport(
        pendingReport.cwd,
        pendingReport.shellPid,
        false,
        pendingReport.windowHandle,
      );
    }

    watcher = new PowerShellForegroundWatcher({
      dataDir,
      onError: (error) =>
        console.error(`[${PRODUCT_ID}] observador de primeiro plano:`, error.message),
    });
    watcher.onChange((foreground) => applyForeground(foreground));
    watcher.start();

    // Terminals die without telling anyone.
    refreshTimer = setInterval(() => {
      terminals.prune();
      windowProjects.prune();
      applyForeground(lastForeground);
    }, REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();

    ipcServer = new LocalIpcServer(dataDir, handleLocalRequest);
    try {
      await ipcServer.start();
      writeRuntimeInfo(dataDir, {
        pid: process.pid,
        pipe: ipcServer.pipeName,
        startedAt: new Date().toISOString(),
      });
    } catch (error) {
      // Another instance already owns the pipe: nothing to do here.
      console.error(`[${PRODUCT_ID}] falha ao abrir o canal local:`, (error as Error).message);
    }

    visibility.refresh();
  });

  // The widget lives in the background; hiding it must not quit the app.
  app.on('window-all-closed', () => {
    /* intentionally empty */
  });

  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    if (refreshTimer) clearInterval(refreshTimer);
    placement?.flush();
    watcher?.stop();
    pty.disposeAll();
    void ipcServer?.stop();
    clearRuntimeInfo(dataDir);
  });
}
