/**
 * How a one-off command is turned into a process for a given shell.
 *
 * The MVP only ships the Windows/PowerShell adapter, but every call site goes
 * through this registry so adding bash or zsh later is a new entry here and
 * nothing else.
 */
export interface ShellSpec {
  file: string;
  /** The user's command already placed among them. */
  args: string[];
}

export interface ShellAdapter {
  id: string;
  platform: NodeJS.Platform;
  termName: string;
  buildCommand(script: string): ShellSpec;
}

export const powerShellAdapter: ShellAdapter = {
  id: 'powershell',
  platform: 'win32',
  termName: 'xterm-256color',
  buildCommand(script) {
    return {
      file: 'powershell.exe',
      // -NoProfile keeps a user's profile (and our own hook) out of task output.
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    };
  },
};

const ADAPTERS: ShellAdapter[] = [powerShellAdapter];

export class UnsupportedPlatformError extends Error {
  constructor(platform: NodeJS.Platform) {
    super(`${platform} ainda não é suportado. O MVP cobre apenas Windows + PowerShell.`);
    this.name = 'UnsupportedPlatformError';
  }
}

export function resolveShellAdapter(platform: NodeJS.Platform = process.platform): ShellAdapter {
  const adapter = ADAPTERS.find((candidate) => candidate.platform === platform);
  if (!adapter) throw new UnsupportedPlatformError(platform);
  return adapter;
}
