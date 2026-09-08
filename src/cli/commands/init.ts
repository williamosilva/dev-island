import * as fs from 'node:fs';

import { hookScriptFile, projectButtonsFile, resolveDataDir } from '../../core/paths';
import { initializeProject } from '../../core/project-service';
import { ProjectRegistry } from '../../core/registry';
import { detectVsCodeEnv } from '../../core/vscode-env';
import { isAppRunning, sendRequest } from '../../localipc/client';
import { PRODUCT_ID } from '../../shared/branding';
import { heading, info, step } from '../ui';

export interface InitOptions {
  cwd: string;
  /** Do not talk to the widget. */
  noStart?: boolean;
  /** Injected in tests. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Explicit sync/repair of the project in the current directory.
 *
 * This is **not** part of the normal flow any more: `dev-island setup` is run
 * once, and every project is then discovered on its own when a VS Code
 * integrated terminal draws its prompt. `init` stays for the times you want to
 * force a sync, re-authorize a folder, or check what would be generated.
 */
export async function runInit(options: InitOptions): Promise<number> {
  const dataDir = resolveDataDir();
  heading(`sincronizando ${options.cwd}`);

  const result = initializeProject(options.cwd);
  step(`gerenciador de pacotes: ${result.project.packageManager}`);
  step(`scripts encontrados: ${result.project.scripts.length}`);
  step(
    result.created
      ? `criado ${projectButtonsFile(result.project.path)}`
      : `atualizado ${projectButtonsFile(result.project.path)}`,
  );
  if (result.added.length > 0) {
    step(`botões adicionados: ${result.added.map((button) => button.name).join(', ')}`);
  } else if (!result.created) {
    step('nenhum botão novo (configuração preservada)');
  }

  new ProjectRegistry(dataDir).authorize(result.project.path, result.project.name);
  step('projeto autorizado');

  // The global hook is `setup`'s job; `init` never touches the profile.
  if (!fs.existsSync(hookScriptFile(dataDir))) {
    info(`integração do shell ausente: rode "${PRODUCT_ID} setup" uma vez`);
  }

  if (options.noStart) return 0;

  const vsCode = detectVsCodeEnv(options.env ?? process.env);
  if (vsCode.insideVsCode && (await isAppRunning(dataDir))) {
    await sendRequest(dataDir, 'activate', {
      cwd: result.project.path,
      shellPid: process.ppid,
    });
    step('projeto ativado no widget');
  }
  return 0;
}
