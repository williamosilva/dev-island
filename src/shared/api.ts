import type { ActionResult, AppState, ThemeName } from './types';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `move` is the grip. */
export type BoundsDirection = 'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * The complete bridge exposed by the preload script.
 *
 * Declared here (in dependency-free shared code) so the preload and the
 * renderer are checked against the very same contract.
 */
export interface DevIslandApi {
  getState(): Promise<AppState>;
  getBuffer(id: string): Promise<string>;

  run(id: string): Promise<ActionResult>;
  stop(id: string): Promise<ActionResult>;
  restart(id: string): Promise<ActionResult>;
  clear(id: string): Promise<ActionResult>;

  addButton(name: string, script: string): Promise<ActionResult>;
  deleteButton(id: string): Promise<ActionResult>;
  reorderButtons(orderedIds: readonly string[]): Promise<ActionResult>;
  resolvePending(accept: boolean): Promise<ActionResult>;
  setTheme(theme: ThemeName): Promise<ActionResult>;

  sendInput(id: string, data: string): void;
  resizePty(id: string, cols: number, rows: number): void;
  /** `animate` steps the change instead of applying it at once. */
  resizeWindow(width: number, height: number, animate: boolean): void;
  setManualBounds(bounds: WindowBounds, direction: BoundsDirection): void;
  commitBounds(): void;
  useAutoSize(): void;
  hideWindow(): void;

  onStateChanged(listener: (state: AppState) => void): () => void;
  onPtyData(listener: (id: string, chunk: string) => void): () => void;
}
