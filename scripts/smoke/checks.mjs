/**
 * The automatic battery: what every provider has to get right, proved against
 * fixtures nobody has to install anything to run.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildFixture, FIXTURES, MANIFEST_EDITS } from './fixtures.mjs';
import { checkIsolation } from './isolation.mjs';
import { ensureBuild, loadDiscovery, runDiscovery } from './product.mjs';
import { check, section } from './report.mjs';
import { childEnvironment, readRunnerLog, RUNNER_SCRIPT, workspace } from './workspace.mjs';

const SHELL = process.env.ComSpec ?? 'cmd.exe';

const asList = (pairs) => pairs.map(([name, command]) => `${name} → ${command}`).join('\n      ');

function buttonsFile(directory) {
  return path.join(directory, '.dev-island', 'buttons.json');
}

function checkDiscovery(modules, built) {
  section('Discovery');
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const directory = built.get(name);
    let ok = false;
    let detail = '';
    try {
      const { buttons } = runDiscovery(modules, directory);
      const actual = buttons.map((button) => [button.name, button.script]);
      ok = JSON.stringify(actual) === JSON.stringify(fixture.expected);
      if (!ok) {
        detail = `esperado:\n      ${asList(fixture.expected)}\n    obtido:\n      ${asList(actual)}`;
      }
      const root = modules.discovery.findTaskProjectRoot(directory);
      if (ok && fixture.expected.length > 0 && path.resolve(root ?? '') !== path.resolve(directory)) {
        ok = false;
        detail = `raiz resolvida ${root}, esperada ${directory}`;
      }
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    check('discovery', fixture.label, ok, detail);
  }
}

function checkIdempotence(modules, built) {
  section('Idempotence');
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const file = buttonsFile(built.get(name));
    const before = fs.readFileSync(file);
    const stamp = fs.statSync(file).mtimeMs;
    runDiscovery(modules, built.get(name));
    check(
      'idempotence',
      `${fixture.label} não é reescrito`,
      fs.readFileSync(file).equals(before) && fs.statSync(file).mtimeMs === stamp,
      'o arquivo mudou numa segunda descoberta',
    );
  }
}

function checkNothingRan(built) {
  section('Safety during discovery');
  const called = readRunnerLog();
  check(
    'safety',
    'No command executed during discovery',
    called.length === 0,
    `executores chamados: ${called.map((entry) => entry.runner).join(', ')}`,
  );

  const noxRoot = built.get('nox');
  const traces = (FIXTURES.nox.forbiddenAfterDiscovery ?? []).filter((file) =>
    fs.existsSync(path.join(noxRoot, file)),
  );
  check(
    'safety',
    'Hostile noxfile was not executed',
    traces.length === 0,
    `arquivos deixados para trás: ${traces.join(', ')}`,
  );
}

function checkFakeExecution(built) {
  section('Fake execution');
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    if (!fixture.run) continue;
    const directory = built.get(name);
    const before = readRunnerLog().length;
    const result = spawnSync(SHELL, ['/d', '/s', '/c', fixture.run.command], {
      cwd: directory,
      env: childEnvironment(),
      encoding: 'utf8',
      windowsHide: true,
    });

    const entries = readRunnerLog().slice(before);
    const entry = entries[0];
    const ok =
      result.status === 0 &&
      entries.length === 1 &&
      entry.runner === fixture.run.runner &&
      JSON.stringify(entry.args) === JSON.stringify(fixture.run.args) &&
      path.resolve(entry.cwd) === path.resolve(directory);
    check(
      'execution',
      fixture.run.command,
      ok,
      entry
        ? `runner=${entry.runner} args=${JSON.stringify(entry.args)} cwd=${entry.cwd}`
        : `nenhuma chamada registada (status ${result.status}) ${result.stderr ?? ''}`,
    );
  }
}

/**
 * Editing a manifest changes the buttons on the next discovery.
 *
 * There is no filesystem watcher: discovery runs when a terminal reports a
 * prompt. What matters is that the pass after the edit picks the new task up
 * without disturbing what is already on disk, so a button added by hand is
 * planted first and has to survive.
 */
function checkRediscovery(built) {
  section('Re-discovery after a manifest changes');
  const { modules, restore } = loadDiscovery();

  for (const [name, edit] of Object.entries(MANIFEST_EDITS)) {
    const directory = built.get(edit.fixture);
    const file = buttonsFile(directory);
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));
    before.buttons.push({ name: `Meu ${name}`, script: `echo ${name}` });
    fs.writeFileSync(file, `${JSON.stringify(before, null, 2)}\n`, 'utf8');

    const manifest = path.join(directory, edit.file);
    fs.writeFileSync(manifest, edit.apply(fs.readFileSync(manifest, 'utf8')), 'utf8');

    const { buttons } = runDiscovery(modules, directory);
    const pairs = buttons.map((button) => [button.name, button.script]);
    const hasNew = pairs.some(([label, command]) => label === edit.added[0] && command === edit.added[1]);
    const keptCustom = pairs.some(([label]) => label === `Meu ${name}`);
    const keptOrder =
      JSON.stringify(pairs.slice(0, before.buttons.length)) ===
      JSON.stringify(before.buttons.map((button) => [button.name, button.script]));
    check(
      'watcher',
      `${edit.file} → ${edit.added[0]}`,
      hasNew && keptCustom && keptOrder,
      `nova=${hasNew} personalizada=${keptCustom} ordem=${keptOrder}`,
    );
  }

  restore();
}

function checkParsers(modules) {
  section('Parsers');
  const { parseToml } = modules.toml;
  const { parseIni } = modules.ini;
  const { parseXml } = modules.xml;

  const toml = parseToml(
    [
      '# comentário no topo',
      '[tool.pdm.scripts]',
      'test = "pytest -q"  # comentário depois do valor',
      'hash = "echo #1"',
      '"chave entre aspas" = "x"',
      'lint = { cmd = "ruff check ." }',
      'itens = [',
      '  "a",',
      '  "b",',
      ']',
      '',
    ].join('\n'),
  );
  const scripts = toml?.tool?.pdm?.scripts ?? {};
  check(
    'parsers',
    'TOML: comentário após valor, `#` em string, chave entre aspas, array multilinha, tabela inline',
    scripts.test === 'pytest -q' &&
      scripts.hash === 'echo #1' &&
      scripts['chave entre aspas'] === 'x' &&
      scripts.lint?.cmd === 'ruff check .' &&
      Array.isArray(scripts.itens) &&
      scripts.itens.join(',') === 'a,b',
    JSON.stringify(scripts),
  );

  check(
    'parsers',
    'TOML: construção não suportada é recusada inteira, não pela metade',
    parseToml('x = """multi\nlinha"""') === null && parseToml('quebrado = ') === null,
    'uma sintaxe fora do subconjunto deveria devolver null',
  );

  const ini = parseIni(
    ['[tox]', 'envlist =', '    py311', '    py312', '', '[testenv:lint]', 'commands = ruff', ''].join('\n'),
  );
  check(
    'parsers',
    'INI: continuação indentada e seções nomeadas',
    ini.get('tox')?.get('envlist') === '\npy311\npy312' && ini.has('testenv:lint'),
    JSON.stringify([...(ini.get('tox')?.entries() ?? [])]),
  );

  const withNamespace = parseXml(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- comentário -->',
      '<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
      '  <artifactId>demo</artifactId>',
      '  <name>a &amp; b</name>',
      '</project>',
    ].join('\n'),
  );
  check(
    'parsers',
    'XML: namespace, comentário e entidade predefinida',
    withNamespace?.name === 'project' &&
      withNamespace.children.some((child) => child.name === 'artifactId' && child.text === 'demo') &&
      withNamespace.children.some((child) => child.name === 'name' && child.text === 'a & b'),
    JSON.stringify(withNamespace?.children?.map((child) => child.name)),
  );

  const doctype = parseXml(
    [
      '<?xml version="1.0"?>',
      '<!DOCTYPE project [<!ENTITY xxe SYSTEM "file:///C:/Windows/win.ini">]>',
      '<project><artifactId>&xxe;</artifactId></project>',
    ].join('\n'),
  );
  check(
    'parsers',
    'XML: DOCTYPE e entidade externa recusados',
    doctype === null && parseXml('<project><a>&custom;</a></project>') === null,
    'um documento com entidade externa deveria ser recusado',
  );

  check(
    'parsers',
    'XML: conteúdo malformado é recusado',
    parseXml('<project><a></project>') === null,
    'markup inválido deveria devolver null',
  );
}

export function runAutomatic() {
  ensureBuild(false);
  const { modules, restore } = loadDiscovery();

  const built = new Map();
  for (const name of Object.keys(FIXTURES)) {
    built.set(name, buildFixture(name, workspace.root, RUNNER_SCRIPT));
  }

  checkDiscovery(modules, built);
  checkIdempotence(modules, built);
  checkNothingRan(built);

  // From here on the fake runners are meant to be called, so the trap goes.
  restore();

  checkFakeExecution(built);
  checkRediscovery(built);
  checkParsers(modules);

  section('Safety');
  checkIsolation();
  return true;
}
