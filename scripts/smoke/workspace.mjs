/**
 * The temporary environment one smoke run lives in, and its removal.
 *
 * Everything the run creates — the fixtures, the fake runners, the isolated
 * `userData` and the runner log — sits under a single `mkdtemp` directory, so
 * taking it away is one call and nothing outside it is ever written.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dim, red } from './report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT = path.resolve(HERE, '..', '..');
export const RUNNER_SCRIPT = path.join(HERE, 'fake-runner.cjs');

const PREFIX = 'dev-island-smoke-';

/** Written into a directory `--keep` preserved, so a later sweep skips it. */
const KEEP_MARKER = '.keep-me';

/** The Python runners a fixture may call. Java uses wrappers of its own. */
const FAKE_RUNNERS = ['pdm', 'pipenv', 'hatch', 'tox', 'nox'];

export const workspace = {
  root: null,
  fakeBin: null,
  userData: null,
  log: null,
  children: new Set(),
  keep: false,
};

/**
 * Remove what an earlier run left behind.
 *
 * A run interrupted with a real Ctrl+C cleans up on its way out, but a process
 * killed outright never gets the chance — so every run starts by sweeping away
 * the directories of the ones before it. A `--keep` directory is left alone.
 */
function sweepStaleWorkspaces() {
  let entries;
  try {
    entries = fs.readdirSync(os.tmpdir());
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(PREFIX)) continue;
    const directory = path.join(os.tmpdir(), entry);
    if (fs.existsSync(path.join(directory, KEEP_MARKER))) continue;
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      // Still in use by a run that is going on right now: leave it be.
    }
  }
}

export function setUpWorkspace() {
  sweepStaleWorkspaces();
  workspace.root = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
  workspace.fakeBin = path.join(workspace.root, 'fake-bin');
  workspace.userData = path.join(workspace.root, 'userdata');
  workspace.log = path.join(workspace.root, 'runner-log.jsonl');
  fs.mkdirSync(workspace.fakeBin, { recursive: true });
  fs.mkdirSync(workspace.userData, { recursive: true });

  for (const runner of FAKE_RUNNERS) {
    fs.writeFileSync(
      path.join(workspace.fakeBin, `${runner}.cmd`),
      ['@echo off', `node "${RUNNER_SCRIPT}" ${runner} %*`, ''].join('\r\n'),
      'utf8',
    );
  }
}

/** The environment a child gets: the fake runners first, everything else as is. */
export function childEnvironment(extra = {}) {
  return {
    ...process.env,
    PATH: `${workspace.fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
    DEV_ISLAND_SMOKE_LOG: workspace.log,
    ...extra,
  };
}

export function readRunnerLog() {
  if (!fs.existsSync(workspace.log)) return [];
  return fs
    .readFileSync(workspace.log, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

let cleaningUp = false;

export function cleanUp() {
  if (cleaningUp) return;
  cleaningUp = true;

  for (const child of workspace.children) {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    } catch {
      // Already gone.
    }
  }
  workspace.children.clear();
  if (!workspace.root) return;

  if (workspace.keep) {
    try {
      fs.writeFileSync(path.join(workspace.root, KEEP_MARKER), '', 'utf8');
    } catch {
      // Unmarked it may be swept later, but the path below is still printed.
    }
    process.stdout.write(`\n${dim(`Fixtures kept in ${workspace.root}`)}\n`);
    // Even with --keep the isolated instance state goes: only the fixtures are
    // worth looking at afterwards.
    fs.rmSync(workspace.userData, { recursive: true, force: true });
    return;
  }
  fs.rmSync(workspace.root, { recursive: true, force: true });
}

/** Leave nothing behind, however the run ends. */
export function cleanUpOnExit() {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      cleanUp();
      process.exit(130);
    });
  }
  process.on('exit', () => cleanUp());
  process.on('uncaughtException', (error) => {
    process.stderr.write(`${red(error instanceof Error ? error.stack : String(error))}\n`);
    cleanUp();
    process.exit(1);
  });
}
