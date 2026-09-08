#!/usr/bin/env node
/*
 * The one program every fake runner points at.
 *
 * `pdm.cmd`, `pipenv.cmd`, `hatch.cmd`, `tox.cmd`, `nox.cmd` and the fake
 * `mvnw.cmd` / `gradlew.bat` in the Java fixtures all call this with their own
 * name as the first argument. It prints what it was asked to do and appends
 * the same thing to a log the harness reads back.
 *
 * It is deliberately inert: no network, no downloads, no search for a JDK or a
 * Python, and nothing written outside the temporary directory the harness owns.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [, , runner, ...args] = process.argv;
const cwd = process.cwd();

const report = [
  'DEV ISLAND SMOKE',
  `runner: ${runner ?? '(desconhecido)'}`,
  `arguments: ${args.join(' ')}`,
  `cwd: ${cwd}`,
  'status: completed',
].join('\n');

process.stdout.write(`${report}\n`);

// The harness passes the log through the environment; without it the runner
// still prints, which is what the interactive mode shows in the terminal.
const logFile = process.env.DEV_ISLAND_SMOKE_LOG;
if (logFile) {
  const entry = JSON.stringify({ runner: runner ?? null, args, cwd, at: Date.now() });
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${entry}\n`, 'utf8');
  } catch {
    // A log that cannot be written must not make the runner fail: the point of
    // this program is to be harmless.
  }
}
