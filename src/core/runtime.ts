import * as fs from 'node:fs';

import { readJsonIfExists, writeJsonAtomic } from './fs-atomic';
import { runtimeFile } from './paths';

export interface RuntimeInfo {
  pid: number;
  pipe: string;
  startedAt: string;
}

/** Record of the background app process, used by `start`/`stop`. */
export function writeRuntimeInfo(dataDir: string, info: RuntimeInfo): void {
  writeJsonAtomic(runtimeFile(dataDir), info);
}

export function readRuntimeInfo(dataDir: string): RuntimeInfo | null {
  let parsed: unknown;
  try {
    parsed = readJsonIfExists<unknown>(runtimeFile(dataDir));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { pid, pipe, startedAt } = parsed as Record<string, unknown>;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  return {
    pid,
    pipe: typeof pipe === 'string' ? pipe : '',
    startedAt: typeof startedAt === 'string' ? startedAt : '',
  };
}

export function clearRuntimeInfo(dataDir: string): void {
  try {
    fs.rmSync(runtimeFile(dataDir), { force: true });
  } catch {
    // A stale file only costs the next start one failed connection attempt.
  }
}
