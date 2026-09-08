/**
 * Opening the real widget on a fake project.
 *
 * An isolated Electron instance is started in preview mode over one fixture,
 * so the buttons can be clicked and the fake runners answer in the widget's
 * own terminal.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { buildFixture, FIXTURES, OPENABLE } from './fixtures.mjs';
import { ensureBuild, loadDiscovery, loadProjectRegistry, runDiscovery } from './product.mjs';
import { red } from './report.mjs';
import { childEnvironment, PROJECT, readRunnerLog, RUNNER_SCRIPT, workspace } from './workspace.mjs';

const require = createRequire(import.meta.url);

export async function runInteractive(name) {
  const fixture = FIXTURES[name];
  if (!fixture) {
    process.stderr.write(
      `${red(`Provedor desconhecido: ${name}`)}\nDisponíveis: ${OPENABLE.join(', ')}\n`,
    );
    return false;
  }

  ensureBuild(true);
  const directory = buildFixture(name, workspace.root, RUNNER_SCRIPT);

  const { modules, restore } = loadDiscovery();
  const { buttons } = runDiscovery(modules, directory);
  restore();

  // Authorise the fixture in the *temporary* registry, so the window opens on
  // the capsule rather than on the authorisation panel. This touches only the
  // isolated userData; the real registry is never read or written.
  const ProjectRegistry = loadProjectRegistry();
  new ProjectRegistry(workspace.userData).authorize(directory, path.basename(directory));

  process.stdout.write(`\nProvider: ${fixture.label}\n`);
  process.stdout.write(`Fixture: ${directory}\n\n`);
  process.stdout.write('Expected buttons:\n');
  if (buttons.length === 0) process.stdout.write('- (nenhum: use o formulário do +)\n');
  for (const button of buttons) process.stdout.write(`- ${button.name} → ${button.script}\n`);
  process.stdout.write('\nClique num botão do Dev Island.\n');
  process.stdout.write('Nenhum Python ou Java é instalado ou executado.\n');
  process.stdout.write('O × da cápsula esconde o widget, como no app real.\n');
  process.stdout.write('Pressione Ctrl+C aqui para terminar e limpar tudo.\n\n');

  const child = spawn(
    require('electron'),
    ['.', '--preview', `--activate=${directory}`, `--shell-pid=${process.pid}`],
    {
      cwd: PROJECT,
      // Its own userData, registry, named pipe and single-instance lock, so it
      // cannot reach the instance the developer is running.
      env: childEnvironment({
        DEV_ISLAND_DATA_DIR: workspace.userData,
        ELECTRON_RUN_AS_NODE: undefined,
      }),
      stdio: 'inherit',
    },
  );
  workspace.children.add(child);

  const status = await new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 0)));
  workspace.children.delete(child);

  const calls = readRunnerLog();
  process.stdout.write(`\n${calls.length} chamada(s) registada(s) pelos executores falsos:\n`);
  for (const call of calls) {
    process.stdout.write(`  runner=${call.runner} args=${call.args.join(' ')} cwd=${call.cwd}\n`);
  }
  return status === 0 || status === null;
}
