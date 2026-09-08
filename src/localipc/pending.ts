import * as fs from 'node:fs';

import { writeJsonAtomic } from '../core/fs-atomic';
import { pendingNotificationFile } from '../core/paths';

/** A notification is only worth replaying while it is fresh. */
const MAX_AGE_MS = 60_000;

export interface PendingNotification {
  cwd: string;
  shellPid: number | null;
  windowHandle: string | null;
  /** Epoch milliseconds, so staleness is easy to judge. */
  at: number;
}

/**
 * Handoff for the cold-start case.
 *
 * When the hook finds nobody listening it drops the report here and starts the
 * app, instead of blocking the prompt on retries. The app reads the file once
 * on startup, so the first prompt after a login still shows the right project.
 */
export function writePendingNotification(dataDir: string, notification: PendingNotification): void {
  writeJsonAtomic(pendingNotificationFile(dataDir), notification);
}

/** Read and delete. Returns null when absent, malformed or stale. */
export function takePendingNotification(
  dataDir: string,
  now: number = Date.now(),
): PendingNotification | null {
  const file = pendingNotificationFile(dataDir);
  let parsed: unknown = null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    // PowerShell may prefix a BOM; JSON.parse would reject it.
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    parsed = null;
  }
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Left behind it would be read again, which the timestamp check catches.
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const raw = parsed as Record<string, unknown>;
  if (typeof raw.cwd !== 'string' || raw.cwd.trim().length === 0) return null;
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0;
  if (now - at > MAX_AGE_MS) return null;

  const shellPid =
    typeof raw.shellPid === 'number' && Number.isInteger(raw.shellPid) && raw.shellPid > 0
      ? raw.shellPid
      : null;
  const windowHandle =
    typeof raw.windowHandle === 'string' && /^0x[0-9a-f]{1,16}$/i.test(raw.windowHandle.trim())
      ? raw.windowHandle.trim()
      : null;

  return { cwd: raw.cwd.trim(), shellPid, windowHandle, at };
}
