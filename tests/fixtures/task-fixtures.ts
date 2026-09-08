/**
 * Throwaway project trees, one per ecosystem.
 *
 * Everything here is inert: the wrappers are batch and shell files that only
 * echo their arguments, the noxfile is read as text and never imported, and no
 * fixture installs an environment or downloads a distribution. If a test ever
 * managed to execute one of these, it would leave a harmless trace rather than
 * do something real — which is exactly what the "nothing runs during
 * discovery" tests check for.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { makeTempDir, writeFile } from '../helpers';

export type FixtureName =
  | 'node-package-json'
  | 'python-pdm'
  | 'python-pipenv'
  | 'python-hatch'
  | 'python-hatch-toml'
  | 'python-tox'
  | 'python-tox-toml'
  | 'python-nox'
  | 'python-generic-without-tasks'
  | 'java-maven'
  | 'java-spring-maven'
  | 'java-maven-aggregator'
  | 'java-gradle'
  | 'java-application-gradle'
  | 'java-spring-gradle'
  | 'multi-stack'
  | 'malformed-manifests'
  | 'malicious-noxfile';

/** A wrapper that only prints what it was asked to do. */
function fakeWrappers(root: string): void {
  writeFile(path.join(root, 'mvnw.cmd'), '@echo off\r\necho fake mvnw %*\r\n');
  writeFile(path.join(root, 'mvnw'), '#!/bin/sh\necho "fake mvnw $@"\n');
  writeFile(path.join(root, 'gradlew.bat'), '@echo off\r\necho fake gradlew %*\r\n');
  writeFile(path.join(root, 'gradlew'), '#!/bin/sh\necho "fake gradlew $@"\n');
}

const BUILDERS: Record<FixtureName, (root: string) => void> = {
  'node-package-json': (root) => {
    writeFile(
      path.join(root, 'package.json'),
      JSON.stringify(
        { name: 'demo', scripts: { dev: 'vite', test: 'vitest', build: 'tsc && vite build' } },
        null,
        2,
      ),
    );
  },

  'python-pdm': (root) => {
    writeFile(
      path.join(root, 'pyproject.toml'),
      [
        '[project]',
        'name = "demo"',
        '',
        '[tool.pdm.scripts]',
        '_.env_file = ".env"',
        'dev = "fastapi dev app/main.py"',
        'test = "pytest -q"',
        'lint = "ruff check ."',
        'format = { cmd = "ruff format ." }',
        'shellish = { shell = "cat error.log|wc -l" }',
        'called = { call = "foo_package.bar_module:main" }',
        'quality = { composite = ["lint", "test"] }',
        '',
        '[project.scripts]',
        'acme = "acme.cli:main"',
        '',
      ].join('\n'),
    );
  },

  'python-pipenv': (root) => {
    writeFile(
      path.join(root, 'Pipfile'),
      [
        '[[source]]',
        'url = "https://pypi.org/simple"',
        '',
        '[scripts]',
        'start = "python app.py"',
        'test = "pytest -q"',
        'lint = "ruff check ."',
        'migrate = {cmd = "python manage.py migrate"}',
        'entry = {call = "package.module:function"}',
        '',
      ].join('\n'),
    );
  },

  'python-hatch': (root) => {
    writeFile(
      path.join(root, 'pyproject.toml'),
      [
        '[project]',
        'name = "demo"',
        '',
        '[tool.hatch.envs.default.scripts]',
        'test = "pytest -q"',
        'lint = "ruff check ."',
        '',
        '[tool.hatch.envs.docs.scripts]',
        'build = "mkdocs build"',
        'serve = ["mkdocs build", "mkdocs serve"]',
        '',
      ].join('\n'),
    );
  },

  'python-hatch-toml': (root) => {
    writeFile(
      path.join(root, 'hatch.toml'),
      ['[envs.default.scripts]', 'test = "pytest"', '', '[envs.ci.scripts]', 'all = "pytest -x"', ''].join(
        '\n',
      ),
    );
  },

  'python-tox': (root) => {
    writeFile(
      path.join(root, 'tox.ini'),
      [
        '[tox]',
        'envlist = py311, py312, lint',
        '',
        '[testenv]',
        'commands = pytest',
        '',
        '[testenv:lint]',
        'commands = ruff check .',
        '',
        '[testenv:docs]',
        'commands = mkdocs build',
        '',
      ].join('\n'),
    );
  },

  'python-tox-toml': (root) => {
    writeFile(
      path.join(root, 'tox.toml'),
      ['env_list = ["py312", "type"]', '', '[env.type]', 'commands = [["mypy", "."]]', ''].join('\n'),
    );
  },

  'python-nox': (root) => {
    writeFile(
      path.join(root, 'noxfile.py'),
      [
        'import nox',
        '',
        '',
        '@nox.session',
        'def tests(session):',
        '    session.install("pytest")',
        '    session.run("pytest")',
        '',
        '',
        '@nox.session()',
        'def docs(session):',
        '    session.run("mkdocs", "build")',
        '',
        '',
        '@nox.session(name="quality")',
        'def lint_and_typecheck(session):',
        '    session.run("ruff", "check", ".")',
        '',
        '',
        'NAME = "generated"',
        '',
        '',
        '@nox.session(name=NAME)',
        'def dynamic(session):',
        '    session.run("echo", "no")',
        '',
      ].join('\n'),
    );
  },

  'python-generic-without-tasks': (root) => {
    writeFile(
      path.join(root, 'pyproject.toml'),
      [
        '[build-system]',
        'requires = ["hatchling"]',
        '',
        '[project]',
        'name = "acme"',
        'version = "1.0.0"',
        '',
        '[project.scripts]',
        'acme = "acme.cli:main"',
        '',
        '[tool.poetry.scripts]',
        'other = "acme.other:main"',
        '',
      ].join('\n'),
    );
    writeFile(path.join(root, 'requirements.txt'), 'fastapi\n');
    writeFile(path.join(root, 'app.py'), 'print("hello")\n');
    writeFile(path.join(root, 'manage.py'), 'print("django")\n');
    writeFile(path.join(root, 'poetry.lock'), '# lock\n');
  },

  'java-maven': (root) => {
    writeFile(
      path.join(root, 'pom.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<project xmlns="http://maven.apache.org/POM/4.0.0">',
        '  <modelVersion>4.0.0</modelVersion>',
        '  <groupId>com.example</groupId>',
        '  <artifactId>demo</artifactId>',
        '  <version>1.0.0</version>',
        '  <build>',
        '    <pluginManagement>',
        '      <plugins>',
        '        <plugin>',
        '          <groupId>org.springframework.boot</groupId>',
        '          <artifactId>spring-boot-maven-plugin</artifactId>',
        '        </plugin>',
        '      </plugins>',
        '    </pluginManagement>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
    );
  },

  'java-spring-maven': (root) => {
    writeFile(
      path.join(root, 'pom.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<project xmlns="http://maven.apache.org/POM/4.0.0">',
        '  <modelVersion>4.0.0</modelVersion>',
        '  <artifactId>service</artifactId>',
        '  <build>',
        '    <plugins>',
        '      <plugin>',
        '        <groupId>org.springframework.boot</groupId>',
        '        <artifactId>spring-boot-maven-plugin</artifactId>',
        '      </plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
    );
    fakeWrappers(root);
  },

  'java-maven-aggregator': (root) => {
    writeFile(
      path.join(root, 'pom.xml'),
      [
        '<project>',
        '  <artifactId>parent</artifactId>',
        '  <packaging>pom</packaging>',
        '  <modules>',
        '    <module>service</module>',
        '  </modules>',
        '</project>',
        '',
      ].join('\n'),
    );
    writeFile(
      path.join(root, 'service', 'pom.xml'),
      [
        '<project>',
        '  <parent>',
        '    <artifactId>parent</artifactId>',
        '    <relativePath>../pom.xml</relativePath>',
        '  </parent>',
        '  <artifactId>service</artifactId>',
        '</project>',
        '',
      ].join('\n'),
    );
  },

  'java-gradle': (root) => {
    writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'demo'\n");
    writeFile(path.join(root, 'build.gradle'), ["plugins {", "    id 'java'", '}', ''].join('\n'));
    fakeWrappers(root);
  },

  'java-application-gradle': (root) => {
    writeFile(path.join(root, 'settings.gradle.kts'), 'rootProject.name = "demo"\n');
    writeFile(
      path.join(root, 'build.gradle.kts'),
      ['plugins {', '    java', '    application', '}', ''].join('\n'),
    );
  },

  'java-spring-gradle': (root) => {
    writeFile(path.join(root, 'settings.gradle'), "rootProject.name = 'svc'\n");
    writeFile(
      path.join(root, 'build.gradle'),
      [
        'plugins {',
        "    id 'java'",
        "    id 'org.springframework.boot' version '3.3.0'",
        '}',
        '',
      ].join('\n'),
    );
    fakeWrappers(root);
  },

  'multi-stack': (root) => {
    BUILDERS['node-package-json'](root);
    writeFile(
      path.join(root, 'backend', 'pyproject.toml'),
      ['[tool.pdm.scripts]', 'test = "pytest"', ''].join('\n'),
    );
    writeFile(
      path.join(root, 'service', 'pom.xml'),
      ['<project>', '  <artifactId>service</artifactId>', '</project>', ''].join('\n'),
    );
  },

  'malformed-manifests': (root) => {
    writeFile(path.join(root, 'pyproject.toml'), '[tool.pdm.scripts\nbroken = ');
    writeFile(path.join(root, 'pom.xml'), '<project><artifactId>oops</project>');
    writeFile(path.join(root, 'tox.ini'), '[tox]\nenvlist =');
  },

  'malicious-noxfile': (root) => {
    // Read as text and nothing else: if this ever ran it would leave a file
    // behind, which is what the test looks for.
    writeFile(
      path.join(root, 'noxfile.py'),
      [
        'import os',
        'import nox',
        '',
        'open(os.path.join(os.path.dirname(__file__), "PWNED.txt"), "w").write("executed")',
        'os.system("echo executed > owned.txt")',
        '',
        '# @nox.session',
        '# def commented_out(session):',
        '#     pass',
        '',
        'DOCSTRING = """',
        '@nox.session',
        'def inside_a_string(session):',
        '    pass',
        '"""',
        '',
        '',
        '@nox.session',
        'def safe(session):',
        '    session.run("true")',
        '',
      ].join('\n'),
    );
  },
};

/** Build one fixture in a fresh temporary directory. */
export function makeFixture(name: FixtureName): string {
  const root = makeTempDir(`dev-island-fx-${name}-`);
  BUILDERS[name](root);
  return root;
}

/** Files present in a fixture, relative and sorted — used to prove inertness. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out.sort();
}
