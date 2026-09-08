#!/usr/bin/env node
/**
 * Validate every task provider without installing Python or Java.
 *
 *     npm run smoke:providers
 *     npm run smoke:providers -- --open pdm
 *     npm run smoke:providers -- --keep
 *
 * Nothing here needs a runtime that is not already on the machine. The Python
 * runners are `.cmd` shims that call one small Node program, the Maven and
 * Gradle wrappers inside the fixtures are the same shim under another name,
 * and every file lives in a temporary directory that is removed at the end.
 *
 * The real environment is left exactly as it was: `PATH` is extended only for
 * the child processes this script starts, `userData` is redirected with the
 * variable the product already honours, and the PowerShell profile is never
 * touched.
 */

import * as fs from 'node:fs';

import { runAutomatic } from './smoke/checks.mjs';
import { FIXTURES, OPENABLE } from './smoke/fixtures.mjs';
import { runInteractive } from './smoke/interactive.mjs';
import { captureBaseline } from './smoke/isolation.mjs';
import { check, failureCount, passedIn, red } from './smoke/report.mjs';
import { cleanUp, cleanUpOnExit, setUpWorkspace, workspace } from './smoke/workspace.mjs';

/** Only true once the clean-up has run, so it is measured rather than promised. */
function reportAfterCleanUp() {
  const target = workspace.keep ? workspace.userData : workspace.root;
  check(
    'safety',
    workspace.keep ? 'Temporary instance removed (--keep)' : 'Temporary files removed',
    !fs.existsSync(target),
    `${target} ainda existe`,
  );

  const alive = [...workspace.children].filter(
    (child) => child.exitCode === null && child.signalCode === null,
  );
  check('safety', 'No residual processes', alive.length === 0, `${alive.length} processo(s) ativo(s)`);

  const failures = failureCount();
  const total = Object.keys(FIXTURES).length;
  process.stdout.write(
    `\nResult: ${passedIn('discovery')}/${total} providers passed${
      failures === 0 ? '' : ` — ${failures} verificações falharam`
    }\n`,
  );
}

async function main() {
  const argv = process.argv.slice(2);
  workspace.keep = argv.includes('--keep');
  const openAt = argv.indexOf('--open');
  const openName = openAt === -1 ? null : argv[openAt + 1];

  if (openAt !== -1 && !openName) {
    process.stderr.write(`${red('--open exige um provedor')}\nDisponíveis: ${OPENABLE.join(', ')}\n`);
    process.exit(2);
  }

  captureBaseline();
  cleanUpOnExit();
  setUpWorkspace();
  process.stdout.write('Dev Island provider smoke\n');

  let ok = false;
  try {
    ok = openName ? await runInteractive(openName) : runAutomatic();
  } finally {
    cleanUp();
    if (!openName) reportAfterCleanUp();
  }
  process.exit(ok && failureCount() === 0 ? 0 : 1);
}

void main();
