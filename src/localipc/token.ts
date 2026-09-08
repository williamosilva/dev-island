import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { tokenFile } from '../core/paths';

/**
 * Shared secret proving that a pipe client is the same user.
 * Stored in the per-user data directory with owner-only permissions.
 */
export function ensureToken(dataDir: string): string {
  const file = tokenFile(dataDir);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* falls through to creation */
  }

  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

export function readToken(dataDir: string): string | null {
  try {
    const existing = fs.readFileSync(tokenFile(dataDir), 'utf8').trim();
    return existing.length >= 32 ? existing : null;
  } catch {
    return null;
  }
}
