import { resolveDataDir } from '../../core/paths';
import { clearRuntimeInfo, readRuntimeInfo } from '../../core/runtime';
import { isAppRunning, sendRequest } from '../../localipc/client';
import { heading, step } from '../ui';

export async function runStop(): Promise<number> {
  const dataDir = resolveDataDir();
  heading('stop');

  if (!(await isAppRunning(dataDir))) {
    if (readRuntimeInfo(dataDir)) clearRuntimeInfo(dataDir);
    step('nenhum processo em execução');
    return 0;
  }

  await sendRequest(dataDir, 'shutdown');

  // Give the app a moment to close its PTYs, then verify.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(250);
    if (!(await isAppRunning(dataDir))) {
      clearRuntimeInfo(dataDir);
      step('widget e terminais encerrados');
      return 0;
    }
  }

  const runtime = readRuntimeInfo(dataDir);
  if (runtime) {
    try {
      process.kill(runtime.pid);
      clearRuntimeInfo(dataDir);
      step(`processo ${runtime.pid} encerrado`);
      return 0;
    } catch {
      step(`não foi possível encerrar o processo ${runtime.pid}`);
      return 1;
    }
  }
  step('não foi possível confirmar o encerramento');
  return 1;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
