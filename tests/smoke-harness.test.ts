import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { makeTempDir, readFile, removeTempDirs, writeFile } from './helpers';

afterEach(() => removeTempDirs());

const PROJECT = process.cwd();
const HARNESS = path.join(PROJECT, 'scripts', 'smoke-providers.mjs');
const RUNNER = path.join(PROJECT, 'scripts', 'smoke', 'fake-runner.cjs');
const SHELL = process.env.ComSpec ?? 'cmd.exe';
const onWindows = process.platform === 'win32';

/** A `.cmd` shim exactly like the ones the harness writes. */
function writeShim(directory: string, runner: string): string {
  const file = path.join(directory, `${runner}.cmd`);
  writeFile(file, ['@echo off', `node "${RUNNER}" ${runner} %*`, ''].join('\r\n'));
  return file;
}

/** Run a command the way Dev Island would, with the fake runners on PATH. */
function runThroughShim(
  command: string,
  cwd: string,
  fakeBin: string,
  log: string,
): { status: number | null; stdout: string } {
  const result = spawnSync(SHELL, ['/d', '/s', '/c', command], {
    cwd,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
      DEV_ISLAND_SMOKE_LOG: log,
    },
    encoding: 'utf8',
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout ?? '' };
}

/**
 * Every file the smoke is made of, discovered rather than listed.
 *
 * The checks below are about the whole harness, so a module added later has to
 * be covered by them without anyone remembering to add it here.
 */
function smokeFiles(): Array<[string, string]> {
  const directory = path.join(PROJECT, 'scripts', 'smoke');
  const files = [HARNESS, ...fs.readdirSync(directory).map((name) => path.join(directory, name))];
  return files
    .filter((file) => /\.(mjs|cjs|js)$/.test(file))
    .map((file) => [path.basename(file), readFile(file)]);
}

function smokeSources(): string[] {
  return smokeFiles().map(([, source]) => source);
}

function readLog(file: string): Array<{ runner: string; args: string[]; cwd: string }> {
  if (!fs.existsSync(file)) return [];
  return readFile(file)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe.skipIf(!onWindows)('the fake runners', () => {
  it('each shim reports its own name and keeps the argument order', () => {
    const directory = makeTempDir('dev-island-shim-');
    const log = path.join(directory, 'log.jsonl');
    for (const runner of ['pdm', 'pipenv', 'hatch', 'tox', 'nox']) writeShim(directory, runner);

    const cases: Array<[string, string, string[]]> = [
      ['pdm run test', 'pdm', ['run', 'test']],
      ['pipenv run start', 'pipenv', ['run', 'start']],
      ['hatch run docs:serve', 'hatch', ['run', 'docs:serve']],
      ['tox run -e py311', 'tox', ['run', '-e', 'py311']],
      ['nox --sessions quality', 'nox', ['--sessions', 'quality']],
    ];
    for (const [command, runner, args] of cases) {
      const before = readLog(log).length;
      const result = runThroughShim(command, directory, directory, log);
      expect(result.status, command).toBe(0);
      expect(result.stdout).toContain('DEV ISLAND SMOKE');
      const entry = readLog(log)[before]!;
      expect(entry.runner).toBe(runner);
      expect(entry.args).toEqual(args);
    }
  });

  it('the working directory is the fixture the command ran in', () => {
    const bin = makeTempDir('dev-island-bin-');
    const fixture = makeTempDir('dev-island-fixture-');
    const log = path.join(bin, 'log.jsonl');
    writeShim(bin, 'pdm');
    runThroughShim('pdm run test', fixture, bin, log);
    expect(path.resolve(readLog(log)[0]!.cwd)).toBe(path.resolve(fixture));
  });

  it('and it works from a path containing spaces', () => {
    const bin = path.join(makeTempDir('dev-island-space-'), 'pasta com espaços');
    fs.mkdirSync(bin, { recursive: true });
    const fixture = path.join(makeTempDir('dev-island-space-fx-'), 'projeto com espaços');
    fs.mkdirSync(fixture, { recursive: true });
    const log = path.join(bin, 'log.jsonl');
    writeShim(bin, 'pdm');
    const result = runThroughShim('pdm run test', fixture, bin, log);
    expect(result.status).toBe(0);
    expect(path.resolve(readLog(log)[0]!.cwd)).toBe(path.resolve(fixture));
  });

  it('the Java wrappers never look for a JDK or reach the network', () => {
    const source = readFile(RUNNER);
    for (const forbidden of ['JAVA_HOME', 'java', 'https:', 'http:', 'net.', 'dns', 'fetch(']) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    // The wrapper a fixture gets is one line calling that same file.
    const directory = makeTempDir('dev-island-wrapper-');
    writeFile(
      path.join(directory, 'mvnw.cmd'),
      ['@echo off', `node "${RUNNER}" maven %*`, ''].join('\r\n'),
    );
    const log = path.join(directory, 'log.jsonl');
    const result = runThroughShim('.\\mvnw.cmd verify', directory, directory, log);
    expect(result.status).toBe(0);
    expect(readLog(log)[0]).toMatchObject({ runner: 'maven', args: ['verify'] });
  });
});

describe.skipIf(!onWindows)('the real environment is left alone', () => {
  it('PATH, userData and the PowerShell profile are untouched by a run', () => {
    const profile = path.join(os.homedir(), 'Documents', 'WindowsPowerShell', 'profile.ps1');
    const userData = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'dev-island')
      : path.join(os.homedir(), '.dev-island');
    const stamp = (target: string): number | null => {
      try {
        return fs.statSync(target).mtimeMs;
      } catch {
        return null;
      }
    };

    const pathBefore = process.env.PATH;
    const profileBefore = stamp(profile);
    const userDataBefore = stamp(userData);

    const result = spawnSync(process.execPath, [HARNESS], {
      cwd: PROJECT,
      encoding: 'utf8',
      timeout: 240_000,
    });

    expect(result.status, result.stdout ?? '').toBe(0);
    expect(process.env.PATH).toBe(pathBefore);
    expect(stamp(profile)).toBe(profileBefore);
    expect(stamp(userData)).toBe(userDataBefore);
    // The harness says so itself, having measured the same things.
    expect(result.stdout).toContain('PATH unchanged');
    expect(result.stdout).toContain('Real userData unchanged');
    expect(result.stdout).toContain('PowerShell profile unchanged');
  }, 300_000);
});

describe.skipIf(!onWindows)('lifetime and clean-up', () => {
  /** Temporary directories the harness owns, by name. */
  function smokeDirectories(): string[] {
    return fs
      .readdirSync(os.tmpdir())
      .filter((entry) => entry.startsWith('dev-island-smoke-'))
      .map((entry) => path.join(os.tmpdir(), entry));
  }

  it('an interrupted run leaves no files and no processes behind', async () => {
    const before = new Set(smokeDirectories());
    const child = spawn(process.execPath, [HARNESS, '--open', 'pdm'], {
      cwd: PROJECT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait until the window has been asked for, then interrupt.
    const started = await new Promise<boolean>((resolve) => {
      let output = '';
      const timer = setTimeout(() => resolve(false), 90_000);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('Ctrl+C')) {
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
    expect(started).toBe(true);

    const created = smokeDirectories().filter((entry) => !before.has(entry));
    expect(created.length).toBeGreaterThan(0);

    child.kill('SIGINT');
    await new Promise((resolve) => child.on('exit', resolve));
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // On Windows `kill('SIGINT')` is not a console Ctrl+C: it terminates the
    // process outright, so no handler of its own can run. A real Ctrl+C does
    // reach the handler, and either way the next run sweeps up what an
    // interrupted one could not — which is what makes the clean-up reliable
    // rather than best-effort.
    const survivors = created.filter((directory) => fs.existsSync(directory));
    const sweep = spawnSync(process.execPath, [HARNESS], {
      cwd: PROJECT,
      encoding: 'utf8',
      timeout: 240_000,
    });
    expect(sweep.status, sweep.stdout).toBe(0);
    for (const directory of survivors) {
      expect(fs.existsSync(directory), `${directory} sobreviveu à varredura`).toBe(false);
    }
    // And nothing the interrupted run started is still going. Only processes
    // pointing at the workspaces this test created count: the developer's own
    // Dev Island is very likely running, and it is none of this test's
    // business.
    const alive = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ForEach-Object { $_.CommandLine }`,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    const ours = (alive.stdout ?? '')
      .split(/\r?\n/)
      .filter((line) => created.some((directory) => line.includes(path.basename(directory))));
    expect(ours).toEqual([]);
  }, 420_000);

  it('a failure on the way through still cleans up', () => {
    const before = new Set(smokeDirectories());
    // An unknown provider fails after the workspace has been created.
    const result = spawnSync(process.execPath, [HARNESS, '--open', 'nao-existe'], {
      cwd: PROJECT,
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Provedor desconhecido');
    expect(smokeDirectories().filter((entry) => !before.has(entry))).toEqual([]);
  }, 150_000);

  it('--keep leaves the fixtures and nothing else', () => {
    const before = new Set(smokeDirectories());
    const result = spawnSync(process.execPath, [HARNESS, '--keep'], {
      cwd: PROJECT,
      encoding: 'utf8',
      timeout: 240_000,
    });
    expect(result.status, result.stdout).toBe(0);
    const kept = smokeDirectories().filter((entry) => !before.has(entry));
    expect(kept).toHaveLength(1);
    const root = kept[0]!;
    try {
      expect(result.stdout).toContain(root);
      // The fixtures are there…
      expect(fs.existsSync(path.join(root, 'python-pdm', 'pyproject.toml'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'java-gradle', 'gradlew.bat'))).toBe(true);
      // …and the isolated instance state is not.
      expect(fs.existsSync(path.join(root, 'userdata'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);

  it('a second run starts from nothing', () => {
    const first = spawnSync(process.execPath, [HARNESS], {
      cwd: PROJECT,
      encoding: 'utf8',
      timeout: 240_000,
    });
    const second = spawnSync(process.execPath, [HARNESS], {
      cwd: PROJECT,
      encoding: 'utf8',
      timeout: 240_000,
    });
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    // Same verdict both times, and nothing left behind — except a directory a
    // `--keep` run deliberately marked, which the sweep must never remove.
    expect(second.stdout).toContain('12/12 providers passed');
    const leftovers = smokeDirectories().filter(
      (directory) => !fs.existsSync(path.join(directory, '.keep-me')),
    );
    expect(leftovers).toEqual([]);
  }, 600_000);
});

describe('the harness itself', () => {
  it('--open refuses a provider it does not have', () => {
    const result = spawnSync(process.execPath, [HARNESS, '--open', 'perl'], {
      cwd: PROJECT,
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Provedor desconhecido: perl');
    expect(result.stderr).toContain('pdm');
  }, 150_000);

  it('it never touches the real instance', () => {
    const sources = smokeSources().join('\n');
    // Every isolated path comes from the temporary workspace, and the data
    // directory is redirected with the variable the product already honours.
    expect(sources).toContain('DEV_ISLAND_DATA_DIR: workspace.userData');
    expect(sources).toContain('fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))');
    // Nothing addresses the real one.
    expect(sources).not.toContain('APPDATA, "dev-island"');
    expect(sources).not.toMatch(/writeFileSync\([^)]*APPDATA/);
  });

  it('it needs no network', () => {
    for (const [name, source] of smokeFiles()) {
      for (const forbidden of ['node:http', 'node:https', 'fetch(', 'node:dns', 'node:net']) {
        expect(source, `${name} ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('and it starts no installation', () => {
    const sources = smokeSources().join('\n');
    for (const forbidden of ['pip install', 'pipx', 'uv tool', 'winget', 'choco', 'sdkman']) {
      expect(sources.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    // Three things may be started: the project's build, the Windows shell that
    // runs a fake runner, and the read-only question "where is your profile?",
    // which is how the isolation check learns what to watch.
    expect(sources).toContain("const SHELL = process.env.ComSpec ?? 'cmd.exe';");
    const spawns = [...sources.matchAll(/spawnSync\(\s*([^,]+),\s*\[?([^\]]*)/g)].map(
      (match) => `${match[1]} ${match[2]}`,
    );
    for (const call of spawns) {
      expect(
        call.includes('npm') ||
          call.includes('SHELL') ||
          call.includes('$PROFILE.CurrentUserAllHosts'),
        call,
      ).toBe(true);
    }
  });

  it('the package script is the single command the user runs', () => {
    const manifest = JSON.parse(readFile(path.join(PROJECT, 'package.json'))) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.scripts['smoke:providers']).toBe('node scripts/smoke-providers.mjs');
    // No dependency was added for any of this.
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['electron', 'node-pty']);
    expect(Object.keys(manifest.devDependencies)).not.toContain('tsx');
    expect(Object.keys(manifest.devDependencies)).not.toContain('ts-node');
  });
});
