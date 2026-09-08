import { resolveDataDir } from '../../core/paths';
import { isAppRunning } from '../../localipc/client';
import { PRODUCT_ID, SHELL_BLOCK_VERSION } from '../../shared/branding';
import { launchApp, writeLauncherInfo } from '../app-launcher';
import { installShellIntegration } from '../shell-setup';
import { heading, info, step } from '../ui';

export interface SetupOptions {
  /** Do not launch the widget (used by manual testing). */
  noStart?: boolean;
}

/**
 * One-time global configuration.
 *
 * After this, every project opened in a VS Code integrated terminal is
 * discovered on its own: `init` is no longer part of the normal flow.
 * Running it again is safe — the managed block is replaced in place, never
 * duplicated, and an older version of the hook is migrated to the current one.
 */
export async function runSetup(options: SetupOptions = {}): Promise<number> {
  const dataDir = resolveDataDir();
  heading('setup');

  const launcher = writeLauncherInfo(dataDir);
  step(`launcher recorded: ${launcher.appRoot}`);

  let migrated = false;
  for (const install of installShellIntegration({ dataDir })) {
    step(
      install.profileUpdated
        ? `profile updated: ${install.profilePath}`
        : `profile already up to date: ${install.profilePath}`,
    );
    if (install.backupPath) step(`backup: ${install.backupPath}`);
    if (install.profileUpdated) migrated = true;
  }
  step(`PowerShell hook at version ${SHELL_BLOCK_VERSION}`);

  if (options.noStart) {
    info('Widget not started (--no-start).');
    return 0;
  }

  if (await isAppRunning(dataDir)) {
    step('widget was already running');
  } else if (!(await launchApp({ dataDir }))) {
    info(`Could not start the widget. Try "${PRODUCT_ID} start".`);
    return 1;
  } else {
    step('widget started in the background');
  }

  info('global setup done');
  info('open a VS Code integrated PowerShell in any Node project');
  if (migrated) {
    info('close any open integrated terminal so it picks up the new hook');
  }
  return 0;
}
