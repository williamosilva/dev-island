/**
 * What the smoke prints, and the tally the exit code comes from.
 */

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

export const red = (text) => `${RED}${text}${RESET}`;
export const dim = (text) => `${DIM}${text}${RESET}`;

const results = [];
let failures = 0;

export function check(area, label, ok, detail) {
  results.push({ area, ok });
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`} ${label}\n`);
  if (!ok && detail) process.stdout.write(`${dim(`    ${detail}`)}\n`);
}

export function section(title) {
  process.stdout.write(`\n${title}\n`);
}

export function failureCount() {
  return failures;
}

export function passedIn(area) {
  return results.filter((entry) => entry.area === area && entry.ok).length;
}
