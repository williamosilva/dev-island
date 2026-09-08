import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

/** Injected so tests never shell out to a real PowerShell. */
export type CommandRunner = (file: string, args: readonly string[]) => string | null;

/** PowerShell hosts the MVP knows about, in install order. */
export const POWERSHELL_HOSTS = ['powershell.exe', 'pwsh.exe'] as const;

const PROFILE_QUERY = ['-NoProfile', '-NonInteractive', '-Command', '$PROFILE.CurrentUserAllHosts'];

export const defaultRunner: CommandRunner = (file, args) => {
  try {
    return execFileSync(file, [...args], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

/**
 * Ask each installed PowerShell host where its profile lives.
 *
 * Querying the shell instead of guessing is what makes this correct when
 * Documents is redirected to OneDrive, and it transparently covers both
 * Windows PowerShell 5.1 and PowerShell 7.
 */
export function discoverProfilePaths(runner: CommandRunner = defaultRunner): string[] {
  const found: string[] = [];
  for (const host of POWERSHELL_HOSTS) {
    const output = runner(host, PROFILE_QUERY);
    if (!output) continue;
    const first = output.split(/\r?\n/)[0]?.trim();
    if (!first || !path.isAbsolute(first)) continue;
    if (!found.some((existing) => existing.toLowerCase() === first.toLowerCase())) {
      found.push(first);
    }
  }
  return found.length > 0 ? found : [fallbackProfilePath()];
}

/** Used only when no PowerShell host answered. */
export function fallbackProfilePath(): string {
  return path.join(os.homedir(), 'Documents', 'WindowsPowerShell', 'profile.ps1');
}
