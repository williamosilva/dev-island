/**
 * The Python task runners.
 *
 * Every one of them follows the same rule: the manifest is read for the
 * *names* it declares, and the command is the runner's own canonical
 * invocation. The body of a script is never copied, re-interpreted or
 * executed — PDM, Pipenv, Hatch, tox and Nox already know what their own
 * entries mean.
 *
 * `pyproject.toml` on its own is a Python marker, not a task source. A project
 * with no runner section gets no buttons, which is the intended outcome.
 */

import { parseIni, iniSections, iniValue } from './ini-lite';
import { parseToml, tomlStrings, tomlTable, type TomlTable } from './toml-lite';
import { scanNoxSessions } from './python-scan';
import { displayName, isSafeTaskName } from './task-name';
import type {
  DiscoveredTask,
  ProjectDetectionContext,
  ProjectTaskProvider,
  ProviderMatch,
} from './types';

const PYPROJECT = 'pyproject.toml';

function readToml(
  context: ProjectDetectionContext,
  file: string,
  providerId: ProviderMatch['providerId'],
): TomlTable | null {
  const text = context.fs.read(file);
  if (text === null) return null;
  const parsed = parseToml(text);
  if (parsed === null) {
    context.report({ providerId, file, message: 'TOML outside the supported subset' });
  }
  return parsed;
}

/**
 * A table of `name = <anything>` turned into task names, in file order.
 *
 * `_` is dropped because PDM keeps shared options there (`_.env_file`), never
 * a script.
 */
function scriptNames(table: TomlTable | null): string[] {
  if (!table) return [];
  return Object.keys(table).filter((key) => key !== '_' && isSafeTaskName(key));
}

export const pdmProvider: ProjectTaskProvider = {
  id: 'python-pdm',
  label: 'PDM',

  detect(context) {
    const file = context.fs.join(context.directory, PYPROJECT);
    if (!context.fs.exists(file)) return null;
    const parsed = readToml(context, file, 'python-pdm');
    if (!tomlTable(parsed, 'tool', 'pdm', 'scripts')) return null;
    return { providerId: 'python-pdm', projectRoot: context.directory, sourceFiles: [file] };
  },

  discover(match, context) {
    const file = match.sourceFiles[0]!;
    const scripts = tomlTable(readToml(context, file, 'python-pdm'), 'tool', 'pdm', 'scripts');
    return scriptNames(scripts).map((name) => ({
      providerId: 'python-pdm' as const,
      name: displayName(name),
      command: `pdm run ${name}`,
      sourceFile: file,
    }));
  },

  watchedFiles(match) {
    return [...match.sourceFiles];
  },
};

export const pipenvProvider: ProjectTaskProvider = {
  id: 'python-pipenv',
  label: 'Pipenv',

  detect(context) {
    const file = context.fs.join(context.directory, 'Pipfile');
    if (!context.fs.exists(file)) return null;
    const parsed = readToml(context, file, 'python-pipenv');
    if (!tomlTable(parsed, 'scripts')) return null;
    return { providerId: 'python-pipenv', projectRoot: context.directory, sourceFiles: [file] };
  },

  discover(match, context) {
    const file = match.sourceFiles[0]!;
    const scripts = tomlTable(readToml(context, file, 'python-pipenv'), 'scripts');
    return scriptNames(scripts).map((name) => ({
      providerId: 'python-pipenv' as const,
      name: displayName(name),
      command: `pipenv run ${name}`,
      sourceFile: file,
    }));
  },

  watchedFiles(match) {
    return [...match.sourceFiles];
  },
};

/** `[tool.hatch.envs.*]` in pyproject, `[envs.*]` in hatch.toml. */
function hatchEnvironments(parsed: TomlTable | null, fromHatchToml: boolean): TomlTable | null {
  return fromHatchToml ? tomlTable(parsed, 'envs') : tomlTable(parsed, 'tool', 'hatch', 'envs');
}

export const hatchProvider: ProjectTaskProvider = {
  id: 'python-hatch',
  label: 'Hatch',

  detect(context) {
    const files: string[] = [];
    for (const name of ['hatch.toml', PYPROJECT]) {
      const file = context.fs.join(context.directory, name);
      if (!context.fs.exists(file)) continue;
      const parsed = readToml(context, file, 'python-hatch');
      if (hatchEnvironments(parsed, name === 'hatch.toml')) files.push(file);
    }
    if (files.length === 0) return null;
    return { providerId: 'python-hatch', projectRoot: context.directory, sourceFiles: files };
  },

  discover(match, context) {
    const tasks: DiscoveredTask[] = [];
    const seen = new Set<string>();

    for (const file of match.sourceFiles) {
      const isHatchToml = context.fs.basename(file) === 'hatch.toml';
      const environments = hatchEnvironments(readToml(context, file, 'python-hatch'), isHatchToml);
      if (!environments) continue;

      for (const [environment, body] of Object.entries(environments)) {
        if (typeof body !== 'object' || body === null || Array.isArray(body)) continue;
        const scripts = tomlTable(body as TomlTable, 'scripts');
        if (!scripts) continue;
        if (environment !== 'default' && !isSafeTaskName(environment)) continue;

        for (const script of scriptNames(scripts)) {
          // The default environment needs no qualifier; a named one does.
          const target = environment === 'default' ? script : `${environment}:${script}`;
          if (seen.has(target)) continue;
          seen.add(target);
          tasks.push({
            providerId: 'python-hatch',
            name:
              environment === 'default'
                ? displayName(script)
                : `${displayName(environment)}: ${displayName(script)}`,
            command: `hatch run ${target}`,
            sourceFile: file,
          });
        }
      }
    }
    return tasks;
  },

  watchedFiles(match) {
    return [...match.sourceFiles];
  },
};

const TOX_FILES = ['tox.ini', 'tox.toml', 'setup.cfg', PYPROJECT] as const;

/** Section heading that declares one environment: `[testenv:lint]`. */
const TESTENV_PREFIX = 'testenv:';

/**
 * Names in an `envlist`, which may be comma or newline separated.
 *
 * A comma inside `{...}` belongs to the factor group, not to the list, so the
 * split has to respect braces — otherwise `py{311,312}` arrives as two
 * fragments that mean nothing.
 */
function splitEnvList(raw: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of raw) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if ((char === ',' || char === '\n') && depth === 0) {
      entries.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  entries.push(current);
  return entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/**
 * A factor expression like `py{311,312}` expanded, but only when the whole
 * entry is one plain group. Anything more elaborate is left alone: guessing at
 * a generative expression would invent environments that do not exist.
 */
function expandFactors(entry: string): string[] | null {
  const braces = entry.match(/\{/g)?.length ?? 0;
  if (braces === 0) return [entry];
  if (braces > 1) return null;
  const match = /^([^{}]*)\{([^{}]+)\}([^{}]*)$/.exec(entry);
  if (!match) return null;
  const [, prefix, inner, suffix] = match;
  const parts = inner!.split(',').map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) return null;
  return parts.map((part) => `${prefix}${part}${suffix}`);
}

export const toxProvider: ProjectTaskProvider = {
  id: 'python-tox',
  label: 'Tox',

  detect(context) {
    const files = TOX_FILES.map((name) => context.fs.join(context.directory, name)).filter((file) =>
      context.fs.exists(file),
    );
    for (const file of files) {
      if (toxEnvironments(file, context).length > 0) {
        return { providerId: 'python-tox', projectRoot: context.directory, sourceFiles: files };
      }
    }
    return null;
  },

  discover(match, context) {
    const tasks: DiscoveredTask[] = [];
    const seen = new Set<string>();
    for (const file of match.sourceFiles) {
      for (const environment of toxEnvironments(file, context)) {
        if (seen.has(environment)) continue;
        seen.add(environment);
        tasks.push({
          providerId: 'python-tox',
          name: `Tox: ${displayName(environment)}`,
          command: `tox run -e ${environment}`,
          sourceFile: file,
        });
      }
    }
    return tasks;
  },

  watchedFiles(match) {
    return [...match.sourceFiles];
  },
};

/** Only what the config states outright, in declaration order. */
function toxEnvironments(file: string, context: ProjectDetectionContext): string[] {
  const text = context.fs.read(file);
  if (text === null) return [];
  const name = context.fs.basename(file);
  const found: string[] = [];
  const add = (raw: string): void => {
    const expanded = expandFactors(raw);
    if (!expanded) {
      context.report({
        providerId: 'python-tox',
        file,
        message: `environment expression ignored: ${raw}`,
      });
      return;
    }
    for (const entry of expanded) {
      if (isSafeTaskName(entry) && !found.includes(entry)) found.push(entry);
    }
  };

  if (name === 'tox.ini' || name === 'setup.cfg') {
    const document = parseIni(text);
    const section = name === 'setup.cfg' ? 'tox:tox' : 'tox';
    const list = iniValue(document, section, 'envlist') ?? iniValue(document, section, 'env_list');
    if (list) for (const entry of splitEnvList(list)) add(entry);
    for (const heading of iniSections(document)) {
      if (heading.startsWith(TESTENV_PREFIX)) {
        add(heading.slice(TESTENV_PREFIX.length).trim());
      }
    }
    return found;
  }

  const parsed = parseToml(text);
  if (parsed === null) {
    context.report({ providerId: 'python-tox', file, message: 'TOML outside the supported subset' });
    return [];
  }
  const root = name === 'tox.toml' ? tomlTable(parsed, 'tox') ?? parsed : tomlTable(parsed, 'tool', 'tox');
  if (!root) return [];
  for (const entry of tomlStrings(root.env_list ?? root.envlist)) add(entry);
  const environments = tomlTable(root, 'env');
  if (environments) for (const key of Object.keys(environments)) add(key);
  return found;
}

export const noxProvider: ProjectTaskProvider = {
  id: 'python-nox',
  label: 'Nox',

  detect(context) {
    const file = context.fs.join(context.directory, 'noxfile.py');
    if (!context.fs.exists(file)) return null;
    return { providerId: 'python-nox', projectRoot: context.directory, sourceFiles: [file] };
  },

  discover(match, context) {
    const file = match.sourceFiles[0]!;
    const text = context.fs.read(file);
    if (text === null) return [];
    // Read as text. Never imported, never executed, never handed to `nox`.
    const { sessions, skipped } = scanNoxSessions(text);
    for (const message of skipped) {
      context.report({ providerId: 'python-nox', file, message });
    }
    return sessions.map((session) => ({
      providerId: 'python-nox' as const,
      name: displayName(session.name),
      command: `nox --sessions ${session.name}`,
      sourceFile: file,
    }));
  },

  watchedFiles(match) {
    return [...match.sourceFiles];
  },
};
