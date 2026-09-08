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
  step(`inicializador registrado: ${launcher.appRoot}`);

  let migrated = false;
  for (const install of installShellIntegration({ dataDir })) {
    step(
      install.profileUpdated
        ? `perfil atualizado: ${install.profilePath}`
        : `perfil já atualizado: ${install.profilePath}`,
    );
    if (install.backupPath) step(`backup: ${install.backupPath}`);
    if (install.profileUpdated) migrated = true;
  }
  step(`hook do PowerShell na versão ${SHELL_BLOCK_VERSION}`);

  if (options.noStart) {
    info('Widget não iniciado (--no-start).');
    return 0;
  }

  if (await isAppRunning(dataDir)) {
    step('widget já estava em execução');
  } else if (!(await launchApp({ dataDir }))) {
    info(`Não foi possível iniciar o widget. Tente "${PRODUCT_ID} start".`);
    return 1;
  } else {
    step('widget iniciado em segundo plano');
  }

  info('configuração global concluída');
  info('abra um PowerShell integrado do VS Code em qualquer projeto Node');
  if (migrated) {
    info('feche os terminais integrados já abertos para que carreguem o novo hook');
  }
  return 0;
}
