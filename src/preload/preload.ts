import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { BoundsDirection, DevIslandApi, WindowBounds } from '../shared/api';
import { BRIDGE_KEY, IPC } from '../shared/ipc';
import type { ActionResult, AppState, ThemeName } from '../shared/types';

/**
 * The entire surface the renderer gets. No Node, no `require`, no arbitrary
 * channels: every function below maps to one validated main-process handler.
 */
const api: DevIslandApi = {
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.getState),
  getBuffer: (id: string): Promise<string> => ipcRenderer.invoke(IPC.getBuffer, id),

  run: (id: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.run, id),
  stop: (id: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.stop, id),
  restart: (id: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.restart, id),
  clear: (id: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.clear, id),

  addButton: (name: string, script: string): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.addButton, name, script),
  deleteButton: (id: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.deleteButton, id),
  reorderButtons: (orderedIds: readonly string[]): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.reorderButtons, [...orderedIds]),
  resolvePending: (accept: boolean): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.resolvePending, accept),
  setTheme: (theme: ThemeName): Promise<ActionResult> => ipcRenderer.invoke(IPC.setTheme, theme),

  sendInput: (id: string, data: string): void => ipcRenderer.send(IPC.ptyInput, id, data),
  resizePty: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send(IPC.ptyResize, id, cols, rows),
  resizeWindow: (width: number, height: number, animate: boolean): void =>
    ipcRenderer.send(IPC.windowResize, width, height, animate),
  setManualBounds: (bounds: WindowBounds, direction: BoundsDirection): void =>
    ipcRenderer.send(IPC.windowManualBounds, bounds, direction),
  commitBounds: (): void => ipcRenderer.send(IPC.windowCommitBounds),
  useAutoSize: (): void => ipcRenderer.send(IPC.windowAutoSize),
  hideWindow: (): void => ipcRenderer.send(IPC.windowHide),

  onStateChanged: (listener: (state: AppState) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, state: AppState): void => listener(state);
    ipcRenderer.on(IPC.stateChanged, handler);
    return () => ipcRenderer.off(IPC.stateChanged, handler);
  },
  onPtyData: (listener: (id: string, chunk: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, id: string, chunk: string): void =>
      listener(id, chunk);
    ipcRenderer.on(IPC.ptyData, handler);
    return () => ipcRenderer.off(IPC.ptyData, handler);
  },
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, api);
