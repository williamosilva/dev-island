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
      step('project activated from the VS Code integrated terminal');
    } else {
      // Re-runs the visibility rules and undoes a previous "Close".
      await sendRequest(dataDir, 'show');
    }
    step('widget was already running');
    return 0;
  }

  const started = await launchApp({ dataDir, activatePath, shellPid });
  if (!started) {
    info('Could not start the widget.');
    return 1;
  }
  step('widget started in the background');
  if (!activatePath) {
    step('the widget appears once the project is detected in a VS Code integrated terminal');
  }
  return 0;
}
