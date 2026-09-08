import * as crypto from 'node:crypto';

import type { ButtonConfig } from '../shared/types';

/**
 * Runtime-only identifier for a button.
 *
 * Ids are never written to `buttons.json`; they are derived from the two
 * fields the file actually stores, so the same button always gets the same id
 * across restarts and a rename produces a new one.
 */
export function buttonId(button: ButtonConfig): string {
  return crypto
    .createHash('sha1')
    .update(`${button.name}\u0000${button.script}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
}
