/**
 * The projects the smoke test discovers, and what each one is expected to
 * produce.
 *
 * Every fixture is inert. The Python manifests declare commands that would be
 * nonsense to run (`comando-interno-nao-executado`) precisely because nothing
 * ever runs them: the Dev Island command is built from the task *name*, and
 * the runner is a fake one. The Java wrappers are small batch files that
 * forward to the same fake runner, so no JDK, Maven or Gradle is needed and
 * nothing is downloaded.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const INERT = 'comando-interno-nao-executado';

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf8');
}

function fakeWrapper(file, runner, runnerScript) {
  // Not `%~dp0`: the runner lives outside the fixture, so the absolute path is
  // baked in and quoted, which also proves a path with spaces works.
  write(file, ['@echo off', `node "${runnerScript}" ${runner} %*`, ''].join('\r\n'));
}

const pom = (extra = '') =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- um comentário, que o leitor de XML precisa ignorar -->',
    '<project xmlns="http://maven.apache.org/POM/4.0.0"',
    '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <modelVersion>4.0.0</modelVersion>',
    '  <groupId>com.example.smoke</groupId>',
    '  <artifactId>smoke</artifactId>',
    '  <version>0.0.0</version>',
    extra,
    '</project>',
    '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');

const SPRING_PLUGIN = [
  '  <build>',
  '    <plugins>',
  '      <plugin>',
  '        <groupId>org.springframework.boot</groupId>',
  '        <artifactId>spring-boot-maven-plugin</artifactId>',
  '      </plugin>',
  '    </plugins>',
  '  </build>',
].join('\n');

/**
 * Every fixture: how to build it, and exactly which buttons it must produce.
 *
 * `expected` is the whole list, in order, as `name → command`. Comparing the
 * whole list is what makes a provider quietly dropping or renaming a task a
 * failure rather than a shrug.
 */
export const FIXTURES = {
  node: {
    label: 'Node',
    directory: 'node-package-json',
    build(root) {
      write(
        path.join(root, 'package.json'),
        `${JSON.stringify(
          {
            name: 'smoke-node',
            private: true,
            scripts: {
              dev: 'node -e "console.log(\'NODE DEV OK\')"',
              test: 'node -e "console.log(\'NODE TEST OK\')"',
            },
          },
          null,
          2,
        )}\n`,
      );
    },
    expected: [
      ['Dev', 'npm run dev'],
      ['Test', 'npm run test'],
    ],
  },

  pdm: {
    label: 'PDM',
    directory: 'python-pdm',
    build(root) {
      write(
        path.join(root, 'pyproject.toml'),
        [
          '[project]',
          'name = "smoke-pdm"',
          'version = "0.0.0"',
          '',
          '[tool.pdm.scripts]',
          `dev = "${INERT}"`,
          `test = "${INERT}"   # comentário depois do valor`,
          `lint = { cmd = "${INERT}" }`,
          '',
        ].join('\n'),
      );
    },
    expected: [
      ['Dev', 'pdm run dev'],
      ['Test', 'pdm run test'],
      ['Lint', 'pdm run lint'],
    ],
    run: { command: 'pdm run test', runner: 'pdm', args: ['run', 'test'] },
  },

  pipenv: {
    label: 'Pipenv',
    directory: 'python-pipenv',
    build(root) {
      write(
        path.join(root, 'Pipfile'),
        [
          '[[source]]',
          'url = "https://pypi.org/simple"',
          'verify_ssl = true',
          '',
          '[packages]',
          '',
          '[scripts]',
          `start = "${INERT}"`,
          `test = "${INERT}"`,
          `lint = {cmd = "${INERT}"}`,
          '',
        ].join('\n'),
      );
    },
    expected: [
      ['Start', 'pipenv run start'],
      ['Test', 'pipenv run test'],
      ['Lint', 'pipenv run lint'],
    ],
    run: { command: 'pipenv run test', runner: 'pipenv', args: ['run', 'test'] },
  },

  hatch: {
    label: 'Hatch',
    directory: 'python-hatch',
    build(root) {
      write(
        path.join(root, 'pyproject.toml'),
        [
          '[project]',
          'name = "smoke-hatch"',
          'version = "0.0.0"',
          '',
          '[tool.hatch.envs.default.scripts]',
          `test = "${INERT}"`,
          `lint = "${INERT}"`,
          '',
          '[tool.hatch.envs.docs.scripts]',
          `build = "${INERT}"`,
          `serve = "${INERT}"`,
          '',
        ].join('\n'),
      );
    },
    expected: [
      ['Test', 'hatch run test'],
      ['Lint', 'hatch run lint'],
      ['Docs: Build', 'hatch run docs:build'],
      ['Docs: Serve', 'hatch run docs:serve'],
    ],
    run: { command: 'hatch run docs:serve', runner: 'hatch', args: ['run', 'docs:serve'] },
  },

  tox: {
    label: 'tox',
    directory: 'python-tox',
    build(root) {
      write(
        path.join(root, 'tox.ini'),
        [
          '[tox]',
          'envlist = py311, py312, lint',
          '',
          '[testenv]',
          `commands = ${INERT}`,
          '',
          '[testenv:lint]',
          `commands = ${INERT}`,
          '',
        ].join('\n'),
      );
    },
    expected: [
      ['Tox: Py311', 'tox run -e py311'],
      ['Tox: Py312', 'tox run -e py312'],
      ['Tox: Lint', 'tox run -e lint'],
    ],
    run: { command: 'tox run -e py311', runner: 'tox', args: ['run', '-e', 'py311'] },
  },

  nox: {
    label: 'Nox',
    directory: 'python-nox',
    build(root) {
      // Top-level code that would leave a trace if it ever ran. It must not.
      write(
        path.join(root, 'noxfile.py'),
        [
          'import os',
          'from pathlib import Path',
          'import nox',
          '',
          'Path("PWNED.txt").write_text("este código não pode rodar")',
          'os.system("echo NAO_PODE_EXECUTAR")',
          '',
          '',
          '@nox.session',
          'def tests(session):',
          `    session.run("${INERT}")`,
          '',
          '',
          '@nox.session(name="quality")',
          'def lint_and_typecheck(session):',
          `    session.run("${INERT}")`,
          '',
        ].join('\n'),
      );
    },
    expected: [
      ['Tests', 'nox --sessions tests'],
      ['Quality', 'nox --sessions quality'],
    ],
    run: { command: 'nox --sessions quality', runner: 'nox', args: ['--sessions', 'quality'] },
    forbiddenAfterDiscovery: ['PWNED.txt', 'owned.txt'],
  },

  maven: {
    label: 'Maven',
    directory: 'java-maven',
    build(root, runnerScript) {
      write(path.join(root, 'pom.xml'), pom());
      fakeWrapper(path.join(root, 'mvnw.cmd'), 'maven', runnerScript);
    },
    expected: [
      ['Compile', '.\\mvnw.cmd compile'],
      ['Test', '.\\mvnw.cmd test'],
      ['Package', '.\\mvnw.cmd package'],
      ['Verify', '.\\mvnw.cmd verify'],
    ],
    run: { command: '.\\mvnw.cmd verify', runner: 'maven', args: ['verify'] },
  },

  'spring-maven': {
    label: 'Spring Boot Maven',
    directory: 'java-spring-maven',
    build(root, runnerScript) {
      write(path.join(root, 'pom.xml'), pom(SPRING_PLUGIN));
      fakeWrapper(path.join(root, 'mvnw.cmd'), 'maven', runnerScript);
    },
    expected: [
      ['Compile', '.\\mvnw.cmd compile'],
      ['Test', '.\\mvnw.cmd test'],
      ['Package', '.\\mvnw.cmd package'],
      ['Verify', '.\\mvnw.cmd verify'],
      ['Spring Boot: Run', '.\\mvnw.cmd spring-boot:run'],
    ],
    run: {
      command: '.\\mvnw.cmd spring-boot:run',
      runner: 'maven',
      args: ['spring-boot:run'],
    },
  },

  gradle: {
    label: 'Gradle',
    directory: 'java-gradle',
    build(root, runnerScript) {
      write(path.join(root, 'settings.gradle'), "rootProject.name = 'smoke-gradle'\n");
      write(
        path.join(root, 'build.gradle'),
        ['plugins {', "    id 'java'", "    id 'application'", '}', ''].join('\n'),
      );
      fakeWrapper(path.join(root, 'gradlew.bat'), 'gradle', runnerScript);
    },
    expected: [
      ['Build', '.\\gradlew.bat build'],
      ['Test', '.\\gradlew.bat test'],
      ['Check', '.\\gradlew.bat check'],
      ['Run', '.\\gradlew.bat run'],
    ],
    run: { command: '.\\gradlew.bat run', runner: 'gradle', args: ['run'] },
  },

  'spring-gradle': {
    label: 'Spring Boot Gradle',
    directory: 'java-spring-gradle',
    build(root, runnerScript) {
      write(path.join(root, 'settings.gradle'), "rootProject.name = 'smoke-spring-gradle'\n");
      write(
        path.join(root, 'build.gradle'),
        [
          'plugins {',
          "    id 'java'",
          "    id 'org.springframework.boot' version '0.0.0-smoke'",
          '}',
          '',
        ].join('\n'),
      );
      fakeWrapper(path.join(root, 'gradlew.bat'), 'gradle', runnerScript);
    },
    expected: [
      ['Build', '.\\gradlew.bat build'],
      ['Test', '.\\gradlew.bat test'],
      ['Check', '.\\gradlew.bat check'],
      ['Spring Boot: Run', '.\\gradlew.bat bootRun'],
    ],
    run: { command: '.\\gradlew.bat bootRun', runner: 'gradle', args: ['bootRun'] },
  },

  'python-empty': {
    label: 'Python without tasks',
    directory: 'python-generic',
    build(root) {
      write(
        path.join(root, 'pyproject.toml'),
        [
          '[project]',
          'name = "smoke-python-empty"',
          'version = "0.0.0"',
          '',
          '[project.scripts]',
          'meu-cli = "meu_pacote.cli:main"',
          '',
        ].join('\n'),
      );
    },
    expected: [],
  },

  mixed: {
    label: 'Mixed project',
    directory: 'multi-stack',
    build(root, runnerScript) {
      write(
        path.join(root, 'package.json'),
        `${JSON.stringify({ name: 'smoke-mixed', private: true, scripts: { test: 'node -e ""' } }, null, 2)}\n`,
      );
      write(
        path.join(root, 'pyproject.toml'),
        ['[tool.pdm.scripts]', `test = "${INERT}"`, `dev = "${INERT}"`, ''].join('\n'),
      );
      write(path.join(root, 'pom.xml'), pom());
      fakeWrapper(path.join(root, 'mvnw.cmd'), 'maven', runnerScript);
    },
    // One ecosystem never hides another, and the colliding names say which is
    // which without the first one changing.
    expected: [
      ['Test', 'npm run test'],
      ['PDM: Test', 'pdm run test'],
      ['Dev', 'pdm run dev'],
      ['Compile', '.\\mvnw.cmd compile'],
      ['Maven: Test', '.\\mvnw.cmd test'],
      ['Package', '.\\mvnw.cmd package'],
      ['Verify', '.\\mvnw.cmd verify'],
    ],
  },
};

/** The fixtures the interactive mode accepts, in the order they are listed. */
export const OPENABLE = Object.keys(FIXTURES);

/**
 * Build one fixture under `root`.
 * Returns its absolute directory.
 */
export function buildFixture(name, root, runnerScript) {
  const fixture = FIXTURES[name];
  if (!fixture) throw new Error(`fixture desconhecida: ${name}`);
  const directory = path.join(root, fixture.directory);
  fs.mkdirSync(directory, { recursive: true });
  fixture.build(directory, runnerScript);
  return directory;
}

/**
 * Manifest edits used to prove a change is picked up by a later discovery,
 * with the buttons already on disk left alone.
 */
export const MANIFEST_EDITS = {
  node: {
    fixture: 'node',
    file: 'package.json',
    apply(current) {
      const parsed = JSON.parse(current);
      parsed.scripts.lint = 'node -e "console.log(\'NODE LINT OK\')"';
      return `${JSON.stringify(parsed, null, 2)}\n`;
    },
    added: ['Lint', 'npm run lint'],
  },
  pdm: {
    fixture: 'pdm',
    file: 'pyproject.toml',
    apply: (current) => `${current}typecheck = "${INERT}"\n`,
    added: ['Typecheck', 'pdm run typecheck'],
  },
  pipenv: {
    fixture: 'pipenv',
    file: 'Pipfile',
    apply: (current) => `${current}format = "${INERT}"\n`,
    added: ['Format', 'pipenv run format'],
  },
  maven: {
    fixture: 'maven',
    file: 'pom.xml',
    // Applying the Spring Boot plugin is the change Maven can actually show:
    // its phases are fixed, so a new task has to come from a plugin.
    apply: (current) => current.replace('</project>', `${SPRING_PLUGIN}\n</project>`),
    added: ['Spring Boot: Run', '.\\mvnw.cmd spring-boot:run'],
  },
  gradle: {
    fixture: 'gradle',
    file: 'build.gradle',
    apply: (current) =>
      current.replace(
        "    id 'application'",
        "    id 'application'\n    id 'org.springframework.boot' version '0.0.0-smoke'",
      ),
    added: ['Spring Boot: Run', '.\\gradlew.bat bootRun'],
  },
};
