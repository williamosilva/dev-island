import {
  hookScriptFile,
  launcherFile,
  launchLockFile,
  pendingNotificationFile,
  tokenFile,
} from '../core/paths';
import { pipeShortNameFor } from '../localipc/protocol';
import { ensureToken } from '../localipc/token';
import {
  installPowerShellIntegration,
  removePowerShellIntegration,
  type InstallResult,
  type RemoveResult,
} from '../shell/powershell-integration';
import { discoverProfilePaths, type CommandRunner } from '../shell/profile-discovery';

export interface ShellSetupOptions {
  dataDir: string;
  /** Injected in tests so no real PowerShell is ever queried. */
  runner?: CommandRunner | undefined;
  /** Injected in tests so no real profile is ever touched. */
  profilePaths?: readonly string[] | undefined;
}

function resolveProfiles(options: ShellSetupOptions): string[] {
  if (options.profilePaths) return [...options.profilePaths];
  return discoverProfilePaths(options.runner);
}

/** Install the managed block into every PowerShell profile we can find. */
export function installShellIntegration(options: ShellSetupOptions): InstallResult[] {
  ensureToken(options.dataDir);
  const hookScriptPath = hookScriptFile(options.dataDir);
  return resolveProfiles(options).map((profilePath) =>
    installPowerShellIntegration({
      profilePath,
      hookScriptPath,
      pipeShortName: pipeShortNameFor(options.dataDir),
      tokenFilePath: tokenFile(options.dataDir),
      pendingFilePath: pendingNotificationFile(options.dataDir),
      launcherFilePath: launcherFile(options.dataDir),
      launchLockPath: launchLockFile(options.dataDir),
    }),
  );
}

/** Remove only the managed block, leaving everything else in place. */
export function uninstallShellIntegration(options: ShellSetupOptions): RemoveResult[] {
  const hookScriptPath = hookScriptFile(options.dataDir);
  return resolveProfiles(options).map((profilePath) =>
    removePowerShellIntegration({ profilePath, hookScriptPath }),
  );
}
