import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import { IPC } from '../shared/ipc';
import type { ActionResult } from '../shared/types';
import type { PtyManager } from './pty-manager';
import type { WidgetState } from './widget-state';
import type { BoundsDirection, WindowPlacement } from './window-placement';
import type { Rect } from './window-geometry';

export interface HandlerContext {
  state: WidgetState;
  pty: PtyManager;
  getWindow(): BrowserWindow | null;
  placement: WindowPlacement;
  /** The user pressed "Close": hide until a terminal reports a project again. */
  onDismiss?: () => void;
  /** Persist an explicit theme choice. Returns the theme actually applied. */
  onThemeChange?: (theme: unknown) => void;
  /** The size limits changed and the renderer has to be told. */
  onLayoutChange?: () => void;
}

const MAX_INPUT_LENGTH = 4096;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 10_000;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 100_000;
}

function isBounds(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false;
  const bounds = value as Record<string, unknown>;
  // Width and height are only range-checked here: pulling an edge past the
  // opposite one produces a negative intermediate value, and clamping it is
  // the main process's job.
  return (
    isCoordinate(bounds.x) &&
    isCoordinate(bounds.y) &&
    isCoordinate(bounds.width) &&
    isCoordinate(bounds.height)
  );
}

const DIRECTIONS: readonly string[] = ['move', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

function isDirection(value: unknown): value is BoundsDirection {
  return typeof value === 'string' && DIRECTIONS.includes(value);
}

/**
 * Every handler re-validates its arguments and resolves the button through the
 * active project's config. The renderer can only ever act on buttons that
 * currently exist in an authorized project.
 */
export function registerIpcHandlers(context: HandlerContext): void {
  const { state, pty } = context;

  /** Resolve a button id to the live command, or null when it is unknown. */
  const resolve = (
    id: unknown,
  ): { key: string; script: string; cwd: string } | null => {
    const button = state.findButton(id);
    const project = state.activeProject;
    if (!button || !project) return null;
    return { key: state.sessionKey(id as string), script: button.script, cwd: project.path };
  };

  const notFound: ActionResult = { ok: false, error: 'Button not found.' };

  ipcMain.handle(IPC.getState, () => state.getState());

  ipcMain.handle(IPC.getBuffer, (_event: IpcMainInvokeEvent, id: unknown) => {
    const target = resolve(id);
    return target ? pty.buffer(target.key) : '';
  });

  ipcMain.handle(IPC.run, (_event, id: unknown): ActionResult => {
    const target = resolve(id);
    if (!target) return notFound;
    // Already running: the caller just wants the terminal view, never a second process.
    if (pty.isRunning(target.key)) return { ok: true };
    pty.start(target);
    return { ok: true };
  });

  ipcMain.handle(IPC.stop, (_event, id: unknown): ActionResult => {
    const target = resolve(id);
    if (!target) return notFound;
    pty.stop(target.key);
    return { ok: true };
  });

  ipcMain.handle(IPC.restart, (_event, id: unknown): ActionResult => {
    const target = resolve(id);
    if (!target) return notFound;
    pty.restart(target);
    return { ok: true };
  });

  ipcMain.handle(IPC.clear, (_event, id: unknown): ActionResult => {
    const target = resolve(id);
    if (!target) return notFound;
    pty.clear(target.key);
    return { ok: true };
  });

  ipcMain.handle(IPC.addButton, (_event, name: unknown, script: unknown): ActionResult =>
    state.addButton(name, script),
  );

  ipcMain.handle(IPC.deleteButton, (_event, id: unknown): ActionResult => state.deleteButton(id));

  ipcMain.handle(IPC.reorderButtons, (_event, orderedIds: unknown): ActionResult =>
    state.reorderButtons(orderedIds),
  );

  ipcMain.handle(IPC.resolvePending, (_event, accept: unknown): ActionResult =>
    state.resolvePending(accept === true),
  );

  ipcMain.handle(IPC.setTheme, (_event, theme: unknown): ActionResult => {
    if (theme !== 'light' && theme !== 'dark') return { ok: false, error: 'Invalid theme.' };
    context.onThemeChange?.(theme);
    return { ok: true };
  });

  ipcMain.on(IPC.ptyInput, (_event, id: unknown, data: unknown) => {
    if (!isString(data) || data.length > MAX_INPUT_LENGTH) return;
    const target = resolve(id);
    if (!target) return;
    pty.write(target.key, data);
  });

  ipcMain.on(IPC.ptyResize, (_event, id: unknown, cols: unknown, rows: unknown) => {
    if (!isSize(cols) || !isSize(rows)) return;
    const target = resolve(id);
    if (!target) return;
    pty.resize(target.key, Math.floor(cols), Math.floor(rows));
  });

  ipcMain.on(IPC.windowResize, (_event, width: unknown, height: unknown, animate: unknown) => {
    if (!isSize(width) || !isSize(height)) return;
    // The renderer says whether this change is one the user should see happen;
    // how it happens is decided here, in one place.
    context.placement.applyContentSize(width, height, animate === true);
  });

  ipcMain.on(IPC.windowManualBounds, (_event, bounds: unknown, direction: unknown) => {
    if (!isBounds(bounds) || !isDirection(direction)) return;
    if (context.placement.applyManualBounds(bounds, direction)) context.onLayoutChange?.();
  });

  ipcMain.on(IPC.windowCommitBounds, () => {
    context.placement.commitManualBounds();
    context.onLayoutChange?.();
  });

  ipcMain.on(IPC.windowAutoSize, () => {
    if (context.placement.resetToAutoSize()) context.onLayoutChange?.();
  });

  ipcMain.on(IPC.windowHide, () => {
    const window = context.getWindow();
    if (window && !window.isDestroyed()) window.hide();
    context.onDismiss?.();
  });
}
