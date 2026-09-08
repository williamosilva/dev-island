import { spawn } from 'node:child_process';
import * as path from 'node:path';

import { writeJsonAtomic } from '../core/fs-atomic';
import { launcherFile } from '../core/paths';
import { DATA_DIR_ENV } from '../shared/branding';
import { isAppRunning } from '../localipc/client';

/** Root of the installed package (dist/cli/app-launcher.js -> package root). */
export function packageRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

/** Absolute path of the Electron binary shipped as a dependency. */
export function electronBinary(): string {
  // The `electron` package exports the executable path when required from Node.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const resolved = require('electron') as unknown;
  if (typeof resolved !== 'string' || resolved.length === 0) {
    throw new Error('Electron not found. Run "npm ci" in the dev-island folder.');
  }
  return resolved;
}

export interface LauncherInfo {
  electron: string;
  appRoot: string;
  /**
   * Environment the launched process needs. Empty in normal use; it carries
   * {@link DATA_DIR_ENV} when the caller is running against an isolated data
   * directory, so a launch from the shell lands in the same place.
   */
  env?: Record<string, string>;
}

/**
 * Record how to start the background process.
 *
 * The shell hook reads this instead of relying on `dev-island` being on PATH,
 * so a fresh PowerShell can bring the app up after a reboot.
 */
export function writeLauncherInfo(dataDir: string): LauncherInfo {
  const override = process.env[DATA_DIR_ENV];
  const info: LauncherInfo = {
    electron: electronBinary(),
    appRoot: packageRoot(),
    ...(override && override.trim() ? { env: { [DATA_DIR_ENV]: override.trim() } } : {}),
  };
  writeJsonAtomic(launcherFile(dataDir), info);
  return info;
}

export interface LaunchOptions {
  dataDir: string;
  activatePath?: string | undefined;
  shellPid?: number | null;
  extraArgs?: readonly string[];
  timeoutMs?: number;
}

/**
 * Start the background app detached from this terminal and wait until it
 * answers on the local pipe.
 */
export async function launchApp(options: LaunchOptions): Promise<boolean> {
  const args = [packageRoot()];
  if (options.activatePath) args.push(`--activate=${options.activatePath}`);
  if (typeof options.shellPid === 'number') args.push(`--shell-pid=${options.shellPid}`);
  if (options.extraArgs) args.push(...options.extraArgs);

  const child = spawn(electronBinary(), args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: packageRoot(),
    env: guiEnvironment(),
  });
  child.unref();

  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (await isAppRunning(options.dataDir)) return true;
    await delay(400);
  }
  return false;
}

/**
 * Environment for the GUI process.
 *
 * Electron checks `ELECTRON_RUN_AS_NODE` by presence, not by value, so an
 * inherited (even empty) variable would silently start a plain Node process
 * with no `app` and no window. Some editors and CLI tools set it, so it is
 * removed here rather than trusted.
 */
function guiEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
