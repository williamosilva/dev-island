/** Types shared between the main process, the preload bridge and the renderer. */

/** Never inferred from VS Code. */
export type ThemeName = 'light' | 'dark';

export type SizeMode = 'auto' | 'manual';

/** Imposed by the active VS Code window, its monitor and the size mode. */
export interface LayoutLimits {
  sizeMode: SizeMode;
  /**
   * Width budget for the compact bar. In manual mode this is the width the
   * user chose, so widening the window shows more scripts.
   */
  maxWidth: number;
  maxHeight: number;
  panelHeight: number;
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * A button exactly as persisted in `.dev-island/buttons.json`.
 * No extra properties are ever written to disk.
 */
export interface ButtonConfig {
  name: string;
  script: string;
}

export interface ButtonsFile {
  buttons: ButtonConfig[];
}

export type ProcessStatus = 'idle' | 'running' | 'exited';

/** Never persisted: the extra fields are derived on every load. */
export interface ButtonView extends ButtonConfig {
  /** Stable hash of name+script. */
  id: string;
  /** True when the button does not correspond to a package.json script. */
  custom: boolean;
  status: ProcessStatus;
  exitCode: number | null;
}

export interface ProjectView {
  path: string;
  name: string;
  packageManager: PackageManager;
}

/** A config nobody authorized on this machine yet. */
export interface PendingAuthorization {
  path: string;
  name: string;
  /** Shown before anything may run. */
  buttons: ButtonConfig[];
}
export interface AppState {
  productName: string;
  project: ProjectView | null;
  pending: PendingAuthorization | null;
  buttons: ButtonView[];
  notice: string | null;
  /** Falls back to the system theme on first run only. */
  theme: ThemeName;
  layout: LayoutLimits;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}
