import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { discoverTasks, nodeTaskFs, PROVIDERS } from '../src/core/tasks/registry';
import { gradleProvider, mavenProvider } from '../src/core/tasks/java-providers';
import { scanGradlePlugins } from '../src/core/tasks/gradle-scan';
import { scanNoxSessions } from '../src/core/tasks/python-scan';
import { parseToml } from '../src/core/tasks/toml-lite';
import { parseXml } from '../src/core/tasks/xml-lite';
import { parseIni } from '../src/core/tasks/ini-lite';
import type { DiscoveredTask, TaskPlatform } from '../src/core/tasks/types';
import { listFiles, makeFixture } from './fixtures/task-fixtures';
import { makeTempDir, removeTempDirs, writeFile } from './helpers';

afterEach(() => removeTempDirs());

/** Discovery over a real directory, with the platform pinned. */
function tasksIn(root: string, platform: TaskPlatform = 'win32'): DiscoveredTask[] {
  return discoverTasks(root, { fs: nodeTaskFs(), platform }).tasks;
}

function commandsIn(root: string, platform: TaskPlatform = 'win32'): string[] {
  return tasksIn(root, platform).map((task) => task.command);
}

function namesIn(root: string, platform: TaskPlatform = 'win32'): string[] {
  return tasksIn(root, platform).map((task) => task.name);
}

describe('Node', () => {
  it('finds every script, in declaration order', () => {
    const root = makeFixture('node-package-json');
    expect(namesIn(root)).toEqual(['Dev', 'Test', 'Build']);
    expect(commandsIn(root)).toEqual(['npm run dev', 'npm run test', 'npm run build']);
  });

  it('a long or punctuated script name still works', () => {
    const root = makeTempDir('dev-island-node-long-');
    writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          'install:local:dry': 'npm pack --dry-run',
          'vscode:prepublish': 'npm run compile',
        },
      }),
    );
    expect(commandsIn(root)).toEqual([
      'npm run install:local:dry',
      'npm run vscode:prepublish',
    ]);
  });

  it('the package manager decision is the existing one', () => {
    const root = makeTempDir('dev-island-node-pm-');
    writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    writeFile(path.join(root, 'pnpm-lock.yaml'), '');
    expect(commandsIn(root)).toEqual(['pnpm run dev']);

    const withField = makeTempDir('dev-island-node-field-');
    writeFile(
      path.join(withField, 'package.json'),
      JSON.stringify({ packageManager: 'yarn@4.1.0', scripts: { dev: 'vite' } }),
    );
    expect(commandsIn(withField)).toEqual(['yarn dev']);
  });
});

describe('PDM', () => {
  const root = (): string => makeFixture('python-pdm');

  it('every shape of script is found, whatever its body is', () => {
    // string, cmd, shell, call and composite all declare a name; that is all
    // the discovery needs from them.
    expect(namesIn(root())).toEqual(
      expect.arrayContaining(['Dev', 'Test', 'Lint', 'Format', 'Shellish', 'Called', 'Quality']),
    );
  });

  it('the reserved `_` key is not a script', () => {
    expect(namesIn(root())).not.toContain('_');
    expect(commandsIn(root()).some((command) => command.includes('env_file'))).toBe(false);
  });

  it('the command is always `pdm run <name>`', () => {
    for (const task of tasksIn(root()).filter((entry) => entry.providerId === 'python-pdm')) {
      expect(task.command).toMatch(/^pdm run [A-Za-z0-9][A-Za-z0-9._:-]*$/);
    }
  });

  it('and the body of a script is never copied into it', () => {
    const commands = commandsIn(root()).join(' ');
    for (const body of ['fastapi', 'pytest', 'ruff', 'wc -l', 'foo_package']) {
      expect(commands, body).not.toContain(body);
    }
  });

  it('`[project.scripts]` is not mistaken for a task', () => {
    expect(namesIn(root())).not.toContain('Acme');
  });
});

describe('Pipenv', () => {
  it('the section is read and the command is canonical', () => {
    const root = makeFixture('python-pipenv');
    const pipenv = tasksIn(root).filter((task) => task.providerId === 'python-pipenv');
    expect(pipenv.map((task) => task.name)).toEqual([
      'Start',
      'Test',
      'Lint',
      'Migrate',
      'Entry',
    ]);
    expect(pipenv.map((task) => task.command)).toEqual([
      'pipenv run start',
      'pipenv run test',
      'pipenv run lint',
      'pipenv run migrate',
      'pipenv run entry',
    ]);
  });

  it('no Pipfile body reaches the command', () => {
    const commands = commandsIn(makeFixture('python-pipenv')).join(' ');
    expect(commands).not.toContain('python app.py');
    expect(commands).not.toContain('manage.py');
  });
});

describe('Hatch', () => {
  it('default and named environments, string and list bodies', () => {
    const tasks = tasksIn(makeFixture('python-hatch')).filter(
      (task) => task.providerId === 'python-hatch',
    );
    expect(tasks.map((task) => `${task.name} => ${task.command}`)).toEqual([
      'Test => hatch run test',
      'Lint => hatch run lint',
      'Docs: Build => hatch run docs:build',
      'Docs: Serve => hatch run docs:serve',
    ]);
  });

  it('hatch.toml is supported too', () => {
    const tasks = tasksIn(makeFixture('python-hatch-toml'));
    expect(tasks.map((task) => task.command)).toEqual(['hatch run test', 'hatch run ci:all']);
  });
});

describe('tox', () => {
  it('envlist and named environments, without duplicates', () => {
    const commands = commandsIn(makeFixture('python-tox'));
    expect(commands).toEqual([
      'tox run -e py311',
      'tox run -e py312',
      'tox run -e lint',
      'tox run -e docs',
    ]);
  });

  it('env_list in TOML is read as well', () => {
    expect(commandsIn(makeFixture('python-tox-toml'))).toEqual([
      'tox run -e py312',
      'tox run -e type',
    ]);
  });

  it('a single plain factor group is expanded', () => {
    const root = makeTempDir('dev-island-tox-factor-');
    writeFile(path.join(root, 'tox.ini'), '[tox]\nenvlist = py{311,312}\n');
    expect(commandsIn(root)).toEqual(['tox run -e py311', 'tox run -e py312']);
  });

  it('anything generative is skipped, with a diagnostic', () => {
    const root = makeTempDir('dev-island-tox-generative-');
    writeFile(path.join(root, 'tox.ini'), '[tox]\nenvlist = py{310,311}-django{42,50}\n[testenv:lint]\n');
    const result = discoverTasks(root, { fs: nodeTaskFs(), platform: 'win32' });
    expect(result.tasks.map((task) => task.command)).toEqual(['tox run -e lint']);
    expect(result.diagnostics.some((entry) => entry.message.includes('py{310,311}-django{42,50}'))).toBe(
      true,
    );
  });
});

describe('Nox', () => {
  it('plain, called and explicitly named sessions', () => {
    const commands = commandsIn(makeFixture('python-nox'));
    expect(commands).toEqual([
      'nox --sessions tests',
      'nox --sessions docs',
      'nox --sessions quality',
    ]);
  });

  it('a dynamic name is skipped rather than guessed', () => {
    expect(commandsIn(makeFixture('python-nox'))).not.toContain('nox --sessions generated');
    expect(commandsIn(makeFixture('python-nox')).some((c) => c.includes('dynamic'))).toBe(false);
  });

  it('comments and strings do not create sessions', () => {
    const { sessions } = scanNoxSessions(
      [
        '# @nox.session',
        '# def commented(session): pass',
        'TEXT = """',
        '@nox.session',
        'def in_a_string(session): pass',
        '"""',
        '@nox.session',
        'def real(session): pass',
      ].join('\n'),
    );
    expect(sessions.map((session) => session.name)).toEqual(['real']);
  });

  it('a hostile noxfile is read as text and leaves no trace', () => {
    const root = makeFixture('malicious-noxfile');
    const before = listFiles(root);
    const commands = commandsIn(root);
    // The one real session is found; the top-level code never ran.
    expect(commands).toEqual(['nox --sessions safe']);
    expect(listFiles(root)).toEqual(before);
    expect(listFiles(root)).not.toContain('PWNED.txt');
    expect(listFiles(root)).not.toContain('owned.txt');
  });
});

describe('Maven', () => {
  it('the safe phases, and nothing destructive', () => {
    const root = makeFixture('java-maven');
    const commands = commandsIn(root, 'posix');
    expect(commands).toEqual(['mvn compile', 'mvn test', 'mvn package', 'mvn verify']);
    for (const forbidden of ['clean', 'install', 'deploy', 'release', 'publish']) {
      expect(commands.join(' '), forbidden).not.toContain(forbidden);
    }
  });

  it('the wrapper wins over the tool on the PATH, per platform', () => {
    const withWrapper = makeFixture('java-spring-maven');
    expect(commandsIn(withWrapper, 'win32')[0]).toBe('.\\mvnw.cmd compile');
    expect(commandsIn(withWrapper, 'posix')[0]).toBe('./mvnw compile');
    expect(commandsIn(makeFixture('java-maven'), 'win32')[0]).toBe('mvn compile');
  });

  it('Spring Boot only when the plugin is really applied', () => {
    expect(commandsIn(makeFixture('java-spring-maven'), 'win32')).toContain(
      '.\\mvnw.cmd spring-boot:run',
    );
    // The plain fixture declares it under pluginManagement only.
    expect(commandsIn(makeFixture('java-maven'), 'win32').join(' ')).not.toContain('spring-boot:run');
  });

  it('invalid XML yields no tasks instead of wrong ones', () => {
    const root = makeFixture('malformed-manifests');
    const result = discoverTasks(root, { fs: nodeTaskFs(), platform: 'win32' });
    expect(result.tasks.filter((task) => task.providerId === 'java-maven')).toEqual([]);
    expect(result.diagnostics.some((entry) => entry.providerId === 'java-maven')).toBe(true);
  });

  it('an external entity is refused, not resolved', () => {
    const hostile = [
      '<?xml version="1.0"?>',
      '<!DOCTYPE project [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>',
      '<project><artifactId>&xxe;</artifactId></project>',
    ].join('\n');
    expect(parseXml(hostile)).toBeNull();
    // A custom entity without a doctype is refused as well.
    expect(parseXml('<project><artifactId>&custom;</artifactId></project>')).toBeNull();
    // The five predefined ones still decode.
    const fine = parseXml('<project><artifactId>a &amp; b</artifactId></project>');
    expect(fine?.children[0]?.text).toBe('a & b');
  });
});

describe('Gradle', () => {
  it('the wrapper wins, per platform', () => {
    const withWrapper = makeFixture('java-gradle');
    expect(commandsIn(withWrapper, 'win32')[0]).toBe('.\\gradlew.bat build');
    expect(commandsIn(withWrapper, 'posix')[0]).toBe('./gradlew build');
    expect(commandsIn(makeFixture('java-application-gradle'), 'win32')[0]).toBe('gradle build');
  });

  it('the Java plugin gives Build, Test and Check (Groovy DSL)', () => {
    expect(commandsIn(makeFixture('java-gradle'), 'win32')).toEqual([
      '.\\gradlew.bat build',
      '.\\gradlew.bat test',
      '.\\gradlew.bat check',
    ]);
  });

  it('the Application plugin adds Run (Kotlin DSL)', () => {
    expect(commandsIn(makeFixture('java-application-gradle'), 'win32')).toEqual([
      'gradle build',
      'gradle test',
      'gradle check',
      'gradle run',
    ]);
  });

  it('Spring Boot adds bootRun', () => {
    expect(commandsIn(makeFixture('java-spring-gradle'), 'win32')).toContain(
      '.\\gradlew.bat bootRun',
    );
  });

  it('`apply plugin:` is recognised too', () => {
    const root = makeTempDir('dev-island-gradle-apply-');
    writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'x'\n");
    writeFile(
      path.join(root, 'build.gradle'),
      ["apply plugin: 'java'", "apply plugin: 'application'", ''].join('\n'),
    );
    expect(commandsIn(root, 'win32')).toEqual([
      'gradle build',
      'gradle test',
      'gradle check',
      'gradle run',
    ]);
  });

  it('a plugin that cannot be proved produces nothing', () => {
    const root = makeTempDir('dev-island-gradle-dynamic-');
    writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'x'\n");
    writeFile(
      path.join(root, 'build.gradle'),
      ['plugins {', '    id(myConventionPlugin)', '}', ''].join('\n'),
    );
    const result = discoverTasks(root, { fs: nodeTaskFs(), platform: 'win32' });
    expect(result.tasks).toEqual([]);
  });

  it('nothing destructive is ever offered', () => {
    const commands = [
      ...commandsIn(makeFixture('java-gradle'), 'win32'),
      ...commandsIn(makeFixture('java-spring-gradle'), 'win32'),
      ...commandsIn(makeFixture('java-application-gradle'), 'win32'),
    ].join(' ');
    for (const forbidden of ['clean', 'publish', 'wrapper', 'init', 'uploadArchives']) {
      expect(commands, forbidden).not.toContain(forbidden);
    }
  });

  it('a comment cannot smuggle a plugin in', () => {
    const scan = scanGradlePlugins(["// plugins { id 'application' }", 'plugins {', "  id 'java'", '}'].join('\n'));
    expect([...scan.plugins]).toEqual(['java']);
  });
});

describe('the parsers refuse what they cannot prove', () => {
  it('TOML: tables, dotted keys, inline tables and arrays', () => {
    const parsed = parseToml(
      ['[a.b]', 'x = "1"', 'y = ["p", "q"]', 'z = { cmd = "run", n = 2 }', ''].join('\n'),
    );
    expect(parsed).not.toBeNull();
    expect((parsed as Record<string, never>)['a']).toBeDefined();
    // Anything outside the subset is a refusal, not a partial read.
    expect(parseToml('x = """multi\nline"""')).toBeNull();
    // An array of tables is skipped rather than refused: a Pipfile always
    // has one, and nothing inside it can declare a task.
    const withArray = parseToml("[[source]]\nurl = 'x'\n\n[scripts]\ntest = 'pytest'\n");
    expect((withArray?.scripts as Record<string, string>).test).toBe('pytest');
    expect(withArray?.source).toBeUndefined();
    expect(parseToml('broken = ')).toBeNull();
  });

  it('TOML: a `#` inside a string is not a comment', () => {
    const parsed = parseToml('[scripts]\nhash = "echo #1"\n');
    expect((parsed?.scripts as Record<string, string>).hash).toBe('echo #1');
  });

  it('INI: continuation lines belong to their key', () => {
    const document = parseIni(['[tox]', 'envlist =', '    py311', '    py312', ''].join('\n'));
    expect(document.get('tox')?.get('envlist')).toBe('\npy311\npy312');
  });

  it('every provider is registered exactly once', () => {
    const ids = PROVIDERS.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'node-package-json',
      'python-pdm',
      'python-pipenv',
      'python-hatch',
      'python-tox',
      'python-nox',
      'java-maven',
      'java-gradle',
    ]);
    // Maven and Gradle watch their wrappers too, so a wrapper appearing
    // switches the command over.
    const root = makeFixture('java-spring-maven');
    const context = {
      directory: root,
      fs: nodeTaskFs(),
      platform: 'win32' as const,
      report: () => undefined,
    };
    const match = mavenProvider.detect(context)!;
    expect(mavenProvider.watchedFiles(match, context).map((file) => path.basename(file))).toEqual([
      'pom.xml',
      'mvnw',
      'mvnw.cmd',
    ]);
    const gradleRoot = makeFixture('java-gradle');
    const gradleContext = { ...context, directory: gradleRoot };
    const gradleMatch = gradleProvider.detect(gradleContext)!;
    expect(
      gradleProvider.watchedFiles(gradleMatch, gradleContext).map((file) => path.basename(file)),
    ).toEqual(['settings.gradle', 'build.gradle', 'gradlew', 'gradlew.bat']);
  });
});
