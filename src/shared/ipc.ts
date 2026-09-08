/** Channel names for the renderer <-> main bridge. Keep this list minimal. */
export const IPC = {
  /** renderer -> main (invoke) */
  getState: 'di:get-state',
  getBuffer: 'di:get-buffer',
  run: 'di:run',
  stop: 'di:stop',
  restart: 'di:restart',
  clear: 'di:clear',
  addButton: 'di:add-button',
  deleteButton: 'di:delete-button',
  reorderButtons: 'di:reorder-buttons',
  resolvePending: 'di:resolve-pending',
  setTheme: 'di:set-theme',
  /** renderer -> main (send) */
  ptyInput: 'di:pty-input',
  ptyResize: 'di:pty-resize',
  windowResize: 'di:window-resize',
  windowManualBounds: 'di:window-manual-bounds',
  windowCommitBounds: 'di:window-commit-bounds',
  windowAutoSize: 'di:window-auto-size',
  windowHide: 'di:window-hide',
  /** main -> renderer */
  stateChanged: 'di:state-changed',
  ptyData: 'di:pty-data',
} as const;

export const BRIDGE_KEY = 'devIsland';
