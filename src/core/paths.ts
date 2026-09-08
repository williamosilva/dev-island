import * as os from 'node:os';
import * as path from 'node:path';

import { BUTTONS_FILE, DATA_DIR_ENV, PRODUCT_ID, PROJECT_DIR } from '../shared/branding';

/**
 * Per-user data directory. Authorized projects, the pipe token and the
 * PowerShell hook script live here — never inside a project repository.
 *
 * Honours {@link DATA_DIR_ENV} so tests (and the example project) can run
 * against a throwaway directory without touching the real machine state.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DATA_DIR_ENV];
  if (override && override.trim()) return path.resolve(override.trim());
  const appData = env.APPDATA;
  if (appData && appData.trim()) return path.join(appData.trim(), PRODUCT_ID);
  return path.join(os.homedir(), `.${PRODUCT_ID}`);
}

export function registryFile(dataDir: string): string {
  return path.join(dataDir, 'projects.json');
}

export function tokenFile(dataDir: string): string {
  return path.join(dataDir, 'pipe-token');
}

export function runtimeFile(dataDir: string): string {
  return path.join(dataDir, 'runtime.json');
}

/**
 * UI preferences (theme). Lives in the per-user data directory — the same
 * folder Electron reports as `app.getPath('userData')` once the app name is
 * set — never inside a project.
 */
export function uiPreferencesFile(dataDir: string): string {
  return path.join(dataDir, 'ui-preferences.json');
}

export function windowStateFile(dataDir: string): string {
  return path.join(dataDir, 'window-state.json');
}

/**
 * How to start the background process, recorded by `setup` so the shell hook
 * can launch it without depending on PATH.
 */
export function launcherFile(dataDir: string): string {
  return path.join(dataDir, 'launcher.json');
}

/**
 * A notification the hook could not deliver because the app was not running.
 * The app picks it up on startup, so the very first prompt after login still
 * lands on the right project.
 */
export function pendingNotificationFile(dataDir: string): string {
  return path.join(dataDir, 'pending-notification.json');
}

/** Timestamp of the last launch attempt, so two prompts cannot race. */
export function launchLockFile(dataDir: string): string {
  return path.join(dataDir, 'launching');
}

export function shellDir(dataDir: string): string {
  return path.join(dataDir, 'shell');
}

export function hookScriptFile(dataDir: string): string {
  return path.join(shellDir(dataDir), `${PRODUCT_ID}-hook.ps1`);
}

export function foregroundScriptFile(dataDir: string): string {
  return path.join(shellDir(dataDir), `${PRODUCT_ID}-foreground.ps1`);
}

export function projectConfigDir(projectPath: string): string {
  return path.join(projectPath, PROJECT_DIR);
}

export function projectButtonsFile(projectPath: string): string {
  return path.join(projectConfigDir(projectPath), BUTTONS_FILE);
}

/**
 * Canonical form used to compare project paths.
 * Windows paths are case-insensitive, so comparison is lowercased.
 */
export function normalizeProjectPath(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  const withoutTrailing =
    resolved.length > 3 && (resolved.endsWith('\\') || resolved.endsWith('/'))
      ? resolved.slice(0, -1)
      : resolved;
  return process.platform === 'win32' ? withoutTrailing.toLowerCase() : withoutTrailing;
}
