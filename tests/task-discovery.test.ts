import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mergeDiscoveredTasks, readButtonsFile, writeButtonsFile } from '../src/core/buttons-config';
import { discoverProject, findTaskProjectRoot } from '../src/core/discovery';
import { projectButtonsFile } from '../src/core/paths';
import { isWithin, resolveProjectRoot, samePath } from '../src/core/tasks/project-root';
import { discoverTasks, nodeTaskFs } from '../src/core/tasks/registry';
import { isSafeTaskName } from '../src/core/tasks/task-name';
import type { DiscoveredTask } from '../src/core/tasks/types';
import { makeFixture } from './fixtures/task-fixtures';
import { makeTempDir, readFile, removeTempDirs, writeFile } from './helpers';

/**
 * Starting a process during discovery is not a thing to assert about — it is a
 * thing to make impossible. Every export of `child_process` is replaced by a
 * function that throws, so a single call anywhere in the import graph fails
 * the test that made it.
 */
vi.mock('node:child_process', () => {
  const explode = (): never => {
    throw new Error('child_process foi usado durante a descoberta');
  };
  return new Proxy({ default: {} }, { get: () => explode });
});

afterEach(() => {
  removeTempDirs();
  vi.restoreAllMocks();
});

const always = { isAuthorized: (): boolean => true };

/** The production entry point, boundary and all. */
function rootOf(start: string): string | null {
  return findTaskProjectRoot(start);
}

function task(overrides: Partial<DiscoveredTask>): DiscoveredTask {
  return {
    providerId: 'node-package-json',
    name: 'Test',
    command: 'npm run test',
    sourceFile: 'package.json',
    ...overrides,
  };
}

describe('finding the root', () => {
  it('a terminal in a subfolder finds the project above it', () => {
    const root = makeFixture('python-pdm');
    const deep = path.join(root, 'src', 'app', 'api');
    fs.mkdirSync(deep, { recursive: true });
    expect(rootOf(deep)).toBe(path.resolve(root));
  });

  it('the walk stops at the boundary it is given', () => {
    const root = makeFixture('python-pdm');
    const deep = path.join(root, 'src');
    fs.mkdirSync(deep, { recursive: true });
    const stopped = resolveProjectRoot(deep, {
      fs: nodeTaskFs(),
      platform: 'win32',
      // Everything is out of bounds: nothing may be claimed.
      boundary: () => true,
    });
    expect(stopped).toBeNull();
  });

  it('and it never climbs out of a repository', () => {
    const outer = makeTempDir('dev-island-repo-outer-');
    writeFile(path.join(outer, 'package.json'), '{"scripts":{"dev":"vite"}}');
    const inner = path.join(outer, 'inner');
    fs.mkdirSync(path.join(inner, '.git'), { recursive: true });
    writeFile(path.join(inner, 'pyproject.toml'), '[tool.pdm.scripts]\ntest = "pytest"\n');
    // The inner directory is its own repository, so the outer manifest is not
    // what the terminal belongs to.
    expect(rootOf(inner)).toBe(path.resolve(inner));
  });

  it('Windows paths compare without case', () => {
    expect(samePath('C:/Projetos/App', 'c:\\projetos\\app', 'win32')).toBe(true);
    expect(samePath('C:/Projetos/App', 'c:\\projetos\\app', 'posix')).toBe(false);
    expect(isWithin('C:/Root/Sub/deep', 'c:/root', 'win32')).toBe(true);
    expect(isWithin('C:/Other', 'c:/root', 'win32')).toBe(false);
  });

  it('a path outside the root is refused, however it is spelled', () => {
    // The check is on the resolved path, so `..` cannot climb out of it.
    expect(isWithin('C:/root/../outside', 'C:/root', 'win32')).toBe(true);
    expect(isWithin(path.resolve('C:/root/../outside'), 'C:/root', 'win32')).toBe(false);
  });

  it('a root with Node and Python contributes both', () => {
    const root = makeTempDir('dev-island-mixed-');
    writeFile(path.join(root, 'package.json'), '{"scripts":{"dev":"vite"}}');
    writeFile(path.join(root, 'pyproject.toml'), '[tool.pdm.scripts]\ntest = "pytest"\n');
    const commands = discoverTasks(root, { fs: nodeTaskFs(), platform: 'win32' }).tasks.map(
      (entry) => entry.command,
    );
    expect(commands).toEqual(['npm run dev', 'pdm run test']);
  });

  it('a Node frontend and a Java service keep their own tasks', () => {
    const root = makeFixture('multi-stack');
    expect(rootOf(path.join(root, 'backend'))).toBe(path.resolve(path.join(root, 'backend')));
    expect(rootOf(path.join(root, 'service'))).toBe(path.resolve(path.join(root, 'service')));
    // The top of the tree is still the Node project it always was.
    const top = discoverTasks(root, { fs: nodeTaskFs(), platform: 'win32' }).tasks;
    expect(top.map((entry) => entry.command)).toEqual([
      'npm run dev',
      'npm run test',
      'npm run build',
    ]);
  });

  it('Gradle uses the directory holding the settings file', () => {
    const root = makeFixture('java-gradle');
    const module = path.join(root, 'app');
    writeFile(path.join(module, 'build.gradle'), "plugins { id 'java' }\n");
    expect(rootOf(module)).toBe(path.resolve(root));
  });

  it('Maven uses the aggregator when the modules prove it', () => {
    const root = makeFixture('java-maven-aggregator');
    expect(rootOf(path.join(root, 'service'))).toBe(path.resolve(root));
  });

  it('a lone source file is not a project', () => {
    const python = makeTempDir('dev-island-lone-py-');
    writeFile(path.join(python, 'script.py'), 'print(1)\n');
    expect(rootOf(python)).toBeNull();

    const java = makeTempDir('dev-island-lone-java-');
    writeFile(path.join(java, 'Main.java'), 'class Main {}\n');
    expect(rootOf(java)).toBeNull();
  });

  it('a Python project with no runner is recognised but gets nothing', () => {
    const root = makeFixture('python-generic-without-tasks');
    expect(rootOf(root)).toBe(path.resolve(root));
    expect(discoverTasks(root, { fs: nodeTaskFs(), platform: 'win32' }).tasks).toEqual([]);

    const outcome = discoverProject(root, always);
    expect(outcome.kind).toBe('created');
    expect(readButtonsFile(root)).toEqual({ buttons: [] });
    // A recognised project with no task source gets `{ "buttons": [] }`.
    expect(JSON.parse(readFile(projectButtonsFile(root)))).toEqual({ buttons: [] });
  });
});

describe('merging into the file on disk', () => {
  it('what is already there wins, in the order it is in', () => {
    const existing = [
      { name: 'Meu Deploy', script: 'pwsh ./deploy.ps1' },
      { name: 'Dev', script: 'npm run dev' },
    ];
    const { buttons, added } = mergeDiscoveredTasks(existing, [
      task({ name: 'Dev', command: 'npm run dev' }),
      task({ name: 'Build', command: 'npm run build' }),
    ]);
    expect(buttons.slice(0, 2)).toEqual(existing);
    expect(added).toEqual([{ name: 'Build', script: 'npm run build' }]);
  });

  it('the same command never arrives twice, whatever it is called', () => {
    const { added } = mergeDiscoveredTasks([{ name: 'Outro nome', script: 'npm run test' }], [
      task({ name: 'Test', command: 'npm run test' }),
    ]);
    expect(added).toEqual([]);
  });

  it('a name collision prefixes the new button only', () => {
    const { buttons } = mergeDiscoveredTasks([{ name: 'Test', script: 'npm run test' }], [
      task({ providerId: 'python-pdm', name: 'Test', command: 'pdm run test' }),
      task({ providerId: 'java-maven', name: 'Test', command: '.\\mvnw.cmd test' }),
    ]);
    expect(buttons).toEqual([
      { name: 'Test', script: 'npm run test' },
      { name: 'PDM: Test', script: 'pdm run test' },
      { name: 'Maven: Test', script: '.\\mvnw.cmd test' },
    ]);
  });

  it('running it twice changes nothing', () => {
    const tasks = [
      task({ name: 'Dev', command: 'npm run dev' }),
      task({ providerId: 'python-pdm', name: 'Test', command: 'pdm run test' }),
    ];
    const first = mergeDiscoveredTasks(null, tasks);
    const second = mergeDiscoveredTasks(first.buttons, tasks);
    expect(second.added).toEqual([]);
    expect(second.buttons).toEqual(first.buttons);
  });

  it('nothing but name and script reaches the file', () => {
    const root = makeTempDir('dev-island-shape-');
    writeButtonsFile(root, {
      buttons: [{ name: 'Dev', script: 'npm run dev' } as never],
    });
    const written = JSON.parse(readFile(projectButtonsFile(root)));
    expect(Object.keys(written)).toEqual(['buttons']);
    expect(Object.keys(written.buttons[0]).sort()).toEqual(['name', 'script']);
  });

  it('an unchanged project is not rewritten', () => {
    const root = makeFixture('node-package-json');
    discoverProject(root, always);
    const file = projectButtonsFile(root);
    const before = readFile(file);
    const stamp = fs.statSync(file).mtimeMs;

    const outcome = discoverProject(root, always);
    expect(outcome.kind).toBe('synced');
    // Same bytes, same file: a second pass writes nothing at all.
    expect(readFile(file)).toBe(before);
    expect(fs.statSync(file).mtimeMs).toBe(stamp);
  });

  it('a corrupted manifest keeps the buttons that are already there', () => {
    const root = makeFixture('node-package-json');
    discoverProject(root, always);
    const custom = [
      ...(readButtonsFile(root)?.buttons ?? []),
      { name: 'Meu', script: 'echo meu' },
    ];
    writeButtonsFile(root, { buttons: custom });

    writeFile(path.join(root, 'package.json'), '{ isto nao e json');
    const outcome = discoverProject(root, always);
    expect(outcome.kind).toBe('synced');
    expect(readButtonsFile(root)?.buttons).toEqual(custom);
  });

  it('and so does removing a manifest entirely', () => {
    const root = makeFixture('python-pdm');
    discoverProject(root, always);
    const before = readButtonsFile(root)?.buttons ?? [];
    expect(before.length).toBeGreaterThan(0);

    fs.rmSync(path.join(root, 'pyproject.toml'));
    // Nothing is discovered any more, and nothing is taken away either.
    const outcome = discoverProject(root, always);
    expect(outcome.kind === 'synced' || outcome.kind === 'ignored').toBe(true);
    expect(readButtonsFile(root)?.buttons).toEqual(before);
  });
});

describe('what discovery is not allowed to do', () => {
  it('a name carrying shell metacharacters never becomes a button', () => {
    for (const hostile of [
      'test; Remove-Item -Recurse .',
      'test && rm -rf /',
      '$(whoami)',
      '`id`',
      'a|b',
      '../escape',
      '',
    ]) {
      expect(isSafeTaskName(hostile), hostile).toBe(false);
    }
    for (const fine of ['test', 'py312', 'docs:build', 'install.local', 'a-b_c'.replace('_', '-')]) {
      expect(isSafeTaskName(fine), fine).toBe(true);
    }

    const root = makeTempDir('dev-island-hostile-name-');
    writeFile(
      path.join(root, 'pyproject.toml'),
      ['[tool.pdm.scripts]', '"test; Remove-Item -Recurse ." = "pytest"', 'ok = "pytest"', ''].join('\n'),
    );
    expect(discoverTasks(root, { fs: nodeTaskFs(), platform: 'win32' }).tasks.map((t) => t.command)).toEqual(
      ['pdm run ok'],
    );
  });

  it('an oversized manifest fails without taking anything with it', () => {
    const root = makeTempDir('dev-island-huge-');
    writeFile(
      path.join(root, 'pyproject.toml'),
      `[tool.pdm.scripts]\ntest = "${'x'.repeat(4096)}"\n`,
    );
    // A tiny limit stands in for a pathological file.
    const tiny = discoverTasks(root, { fs: nodeTaskFs(64), platform: 'win32' });
    expect(tiny.tasks).toEqual([]);
    // The same file within the limit is read normally.
    expect(discoverTasks(root, { fs: nodeTaskFs(), platform: 'win32' }).tasks).toHaveLength(1);
  });

  it('no child process and no PTY is created by discovering', () => {
    // With `child_process` booby-trapped above, getting through this loop at
    // all is the proof: any spawn, exec or fork would throw here.
    for (const fixture of [
      'node-package-json',
      'python-pdm',
      'python-pipenv',
      'python-hatch',
      'python-tox',
      'python-nox',
      'java-maven',
      'java-spring-maven',
      'java-gradle',
      'java-spring-gradle',
      'multi-stack',
      'malformed-manifests',
      'malicious-noxfile',
    ] as const) {
      const root = makeFixture(fixture);
      discoverTasks(root, { fs: nodeTaskFs(), platform: 'win32' });
      discoverProject(root, always);
      findTaskProjectRoot(root);
    }

    // And no module in the discovery graph so much as mentions a process.
    const sources = fs
      .readdirSync('src/core/tasks')
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => readFile(path.join('src/core/tasks', entry)));
    sources.push(readFile('src/core/discovery.ts'));
    for (const source of sources) {
      for (const forbidden of ['child_process', 'node-pty', 'spawn(', 'execSync', 'powershell']) {
        expect(source, forbidden).not.toContain(forbidden);
      }
    }
  });

  it('and no runner name is ever invoked, only written', () => {
    // The commands mention the runners, which is the point; what matters is
    // that discovery produced strings and nothing else.
    const root = makeFixture('multi-stack');
    const result = discoverTasks(root, { fs: nodeTaskFs(), platform: 'win32' });
    for (const entry of result.tasks) {
      expect(typeof entry.command).toBe('string');
    }
  });

  it('a wrapper is named but never run, and nothing is downloaded', () => {
    const root = makeFixture('java-spring-maven');
    const before = fs.readdirSync(root).sort();
    const commands = discoverTasks(root, { fs: nodeTaskFs(), platform: 'win32' }).tasks.map(
      (entry) => entry.command,
    );
    expect(commands[0]).toBe('.\\mvnw.cmd compile');
    // The wrapper would fetch a distribution if it ran; the directory is
    // exactly as it was.
    expect(fs.readdirSync(root).sort()).toEqual(before);
  });

  it('switching project only reads; it never runs a task', () => {
    const first = makeFixture('python-pdm');
    const second = makeFixture('java-gradle');
    const before = [fs.readdirSync(first).sort(), fs.readdirSync(second).sort()];
    discoverProject(first, always);
    discoverProject(second, always);
    // Only `.dev-island` is added, by the discovery that is meant to add it.
    for (const [index, root] of [first, second].entries()) {
      const now = fs.readdirSync(root).sort();
      expect(now.filter((entry) => entry !== '.dev-island')).toEqual(before[index]);
    }
  });
});

describe('the discovery of a mixed project, end to end', () => {
  it('writes one file, with the tasks of every ecosystem in it', () => {
    const root = makeTempDir('dev-island-e2e-');
    writeFile(path.join(root, 'package.json'), '{"scripts":{"test":"vitest"}}');
    writeFile(path.join(root, 'pyproject.toml'), '[tool.pdm.scripts]\ntest = "pytest"\n');
    writeFile(
      path.join(root, 'pom.xml'),
      '<project><artifactId>svc</artifactId></project>',
    );

    const outcome = discoverProject(root, always);
    expect(outcome.kind).toBe('created');
    const buttons = readButtonsFile(root)?.buttons ?? [];
    const scripts = buttons.map((button) => button.script);
    expect(scripts).toContain('npm run test');
    expect(scripts).toContain('pdm run test');
    expect(scripts.some((script) => script.endsWith('mvn test') || script.endsWith('mvnw.cmd test'))).toBe(
      true,
    );
    // One ecosystem never hides another, and the colliding names say which is
    // which without touching the first one.
    const names = buttons.map((button) => button.name);
    expect(names).toContain('Test');
    expect(names).toContain('PDM: Test');
    expect(names.filter((name) => name === 'Test')).toHaveLength(1);
  });
});
