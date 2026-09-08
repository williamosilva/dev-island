import { resolveDataDir } from '../../core/paths';
import { ProjectRegistry } from '../../core/registry';
import { detectVsCodeEnv } from '../../core/vscode-env';
import { isAppRunning, sendRequest } from '../../localipc/client';
import { ensureToken } from '../../localipc/token';
import { launchApp } from '../app-launcher';
import { heading, info, step } from '../ui';

export interface StartOptions {
  cwd: string;
  /** Injected in tests. */
  env?: NodeJS.ProcessEnv;
}

export async function runStart(options: StartOptions): Promise<number> {
  const dataDir = resolveDataDir();
  ensureToken(dataDir);
  heading('start');

  // A project only becomes active when a VS Code integrated terminal says so.
  const vsCode = detectVsCodeEnv(options.env ?? process.env);
  const authorized = new ProjectRegistry(dataDir).isAuthorized(options.cwd);
  const activatePath = vsCode.insideVsCode && authorized ? options.cwd : undefined;
  const shellPid = activatePath ? process.ppid : null;

  if (await isAppRunning(dataDir)) {
    if (activatePath) {
      await sendRequest(dataDir, 'activate', { cwd: activatePath, shellPid });
      step('projeto ativado pelo terminal integrado do VS Code');
    } else {
      // Re-runs the visibility rules and undoes a previous "Fechar".
      await sendRequest(dataDir, 'show');
    }
    step('widget já estava em execução');
    return 0;
  }

  const started = await launchApp({ dataDir, activatePath, shellPid });
  if (!started) {
    info('Não foi possível iniciar o widget.');
    return 1;
  }
  step('widget iniciado em segundo plano');
  if (!activatePath) {
    step('o widget aparecerá quando o projeto for detectado no terminal integrado do VS Code');
  }
  return 0;
}
