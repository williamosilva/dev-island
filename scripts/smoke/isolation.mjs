/**
 * What the smoke must leave exactly as it found it.
 *
 * The baseline is taken before the run starts and compared after it ends, so
 * these are measurements of the real machine rather than claims about it.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { check } from './report.mjs';
import { readRunnerLog, RUNNER_SCRIPT } from './workspace.mjs';

const NETWORK_CALL = /https?:|net\.|fetch\(|dns\./;
const INSTALL_ARGUMENT = /install|download/i;

/** Where the user's own Dev Island keeps its state. */
const realUserData = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'dev-island')
  : path.join(os.homedir(), '.dev-island');

let baseline = null;

function stamp(target) {
  try {
    return fs.statSync(target).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * The profiles `dev-island setup` would edit.
 *
 * The product asks each PowerShell host for `$PROFILE.CurrentUserAllHosts`
 * rather than guessing, so watching the same answers is what makes this check
 * mean anything: a hard-coded path would miss a Documents folder redirected to
 * OneDrive and would report "unchanged" about a file nobody was going to
 * touch. Asking is read-only — `-NoProfile` runs none of the user's own code.
 */
function realProfilePaths() {
  const found = [path.join(os.homedir(), 'Documents', 'WindowsPowerShell', 'profile.ps1')];
  for (const host of ['powershell.exe', 'pwsh.exe']) {
    const answer = spawnSync(
      host,
      ['-NoProfile', '-NonInteractive', '-Command', '$PROFILE.CurrentUserAllHosts'],
      { encoding: 'utf8', windowsHide: true, timeout: 15_000 },
    );
    const first = answer.stdout?.split(/\r?\n/)[0]?.trim();
    if (!first || !path.isAbsolute(first)) continue;
    if (!found.some((existing) => existing.toLowerCase() === first.toLowerCase())) found.push(first);
  }
  return found;
}

/** Call once, before the run touches anything. */
export function captureBaseline() {
  const profiles = realProfilePaths();
  baseline = {
    path: process.env.PATH,
    userData: stamp(realUserData),
    profiles: new Map(profiles.map((file) => [file, stamp(file)])),
  };
}

export function checkIsolation() {
  check(
    'safety',
    'No network access',
    // The fake runners are one Node file that only writes to the log.
    !NETWORK_CALL.test(fs.readFileSync(RUNNER_SCRIPT, 'utf8')),
    'o runner falso não pode conter chamadas de rede',
  );

  check(
    'safety',
    'Real userData unchanged',
    baseline.userData === stamp(realUserData),
    `${realUserData} mudou durante a execução`,
  );

  const changed = [...baseline.profiles].find(([file, before]) => before !== stamp(file));
  check(
    'safety',
    'PowerShell profile unchanged',
    changed === undefined,
    `${changed?.[0]} mudou durante a execução`,
  );

  check(
    'safety',
    'PATH unchanged',
    process.env.PATH === baseline.path,
    'o PATH do processo pai foi modificado',
  );

  check(
    'safety',
    'No install was attempted',
    readRunnerLog().every((entry) => !entry.args.some((argument) => INSTALL_ARGUMENT.test(argument))),
    'algum executor recebeu um argumento de instalação',
  );
}
