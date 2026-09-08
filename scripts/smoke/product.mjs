/**
 * Loading the product under test.
 *
 * The smoke drives Dev Island's own compiled discovery rather than a copy of
 * it, so what passes here is what the app does.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { dim } from './report.mjs';
import { PROJECT } from './workspace.mjs';

const require = createRequire(import.meta.url);

const TRAPPED = ['spawn', 'exec', 'execFile', 'execSync', 'spawnSync', 'fork'];

export function ensureBuild(needRenderer) {
  const mainFile = path.join(PROJECT, 'dist', 'main', 'main.js');
  const rendererFile = path.join(PROJECT, 'dist', 'renderer', 'index.html');
  if (fs.existsSync(mainFile) && (!needRenderer || fs.existsSync(rendererFile))) return;

  process.stdout.write(`${dim('Building the project…')}\n`);
  const built = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'run',
    needRenderer ? 'build' : 'build:node',
  ], { cwd: PROJECT, stdio: 'inherit', shell: false });
  if (built.status !== 0) throw new Error('the build failed');
}

/**
 * The discovery modules, with `child_process` booby-trapped.
 *
 * The built output is CommonJS, so replacing the exports of the cached
 * `child_process` module really does reach it: anything that tried to start a
 * process during discovery throws here instead of running. `restore` puts the
 * real functions back, and has to be called before the fake runners are used.
 */
export function loadDiscovery() {
  const childProcess = require('node:child_process');
  const original = new Map();
  for (const name of TRAPPED) {
    original.set(name, childProcess[name]);
    childProcess[name] = (...args) => {
      throw new Error(`discovery tried to start a process: ${name}(${String(args[0])})`);
    };
  }

  const built = (...segments) => require(path.join(PROJECT, 'dist', ...segments));
  const modules = {
    discovery: built('core', 'discovery.js'),
    toml: built('core', 'tasks', 'toml-lite.js'),
    ini: built('core', 'tasks', 'ini-lite.js'),
    xml: built('core', 'tasks', 'xml-lite.js'),
  };
  return {
    modules,
    restore: () => {
      for (const [name, fn] of original) childProcess[name] = fn;
    },
  };
}

/** Run the product's discovery and read back the buttons it wrote. */
export function runDiscovery(modules, directory) {
  const outcome = modules.discovery.discoverProject(directory, { isAuthorized: () => true });
  const file = path.join(directory, '.dev-island', 'buttons.json');
  const buttons = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).buttons : [];
  return { outcome, buttons };
}

export function loadProjectRegistry() {
  return require(path.join(PROJECT, 'dist', 'core', 'registry.js')).ProjectRegistry;
}
