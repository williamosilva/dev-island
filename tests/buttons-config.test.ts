import * as fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  appendButton,
  displayNameForScript,
  isCustomButton,
  parseButtonsFile,
  readButtonsFile,
  removeButtonById,
  syncButtons,
  writeButtonsFile,
} from '../src/core/buttons-config';
import { buttonId } from '../src/core/button-id';
import { projectButtonsFile } from '../src/core/paths';
import { initializeProject } from '../src/core/project-service';
import type { ButtonConfig } from '../src/shared/types';
import { makeTempDir, readFile, removeTempDirs, writeFile, writePackageJson } from './helpers';

afterEach(removeTempDirs);

describe('syncButtons - initial generation', () => {
  it('turns every script into a button that goes through the package manager', () => {
    const { buttons, added } = syncButtons(null, ['dev', 'test', 'build'], 'npm');
    expect(buttons).toEqual([
      { name: 'Dev', script: 'npm run dev' },
      { name: 'Test', script: 'npm run test' },
      { name: 'Build', script: 'npm run build' },
    ]);
    expect(added).toHaveLength(3);
  });

  it('never inlines the script body', () => {
    const { buttons } = syncButtons(null, ['dev'], 'pnpm');
    expect(buttons[0]?.script).toBe('pnpm run dev');
  });

  it('writes only name and script', () => {
    const { buttons } = syncButtons(null, ['dev'], 'npm');
    expect(Object.keys(buttons[0] ?? {})).toEqual(['name', 'script']);
  });
});

describe('syncButtons - merging into an existing file', () => {
  const custom: ButtonConfig[] = [
    { name: 'Docker', script: 'docker compose up -d' },
    { name: 'Dev', script: 'npm run dev' },
  ];

  it('preserves custom buttons and their order', () => {
    const { buttons } = syncButtons(custom, ['dev', 'build'], 'npm');
    expect(buttons.slice(0, 2)).toEqual(custom);
    expect(buttons[2]).toEqual({ name: 'Build', script: 'npm run build' });
  });

  it('does not duplicate a script that is already represented', () => {
    const { buttons, added } = syncButtons(custom, ['dev'], 'npm');
    expect(added).toEqual([]);
    expect(buttons).toEqual(custom);
  });

  it('ignores incidental whitespace when comparing scripts', () => {
    const { added } = syncButtons([{ name: 'Dev', script: 'npm  run   dev' }], ['dev'], 'npm');
    expect(added).toEqual([]);
  });

  it('keeps names unique when a custom button already took the obvious one', () => {
    const { buttons } = syncButtons([{ name: 'Dev', script: 'docker compose up' }], ['dev'], 'npm');
    // The button already on disk keeps its name; the new one says where it
    // came from, which is the same rule every provider follows.
    expect(buttons).toEqual([
      { name: 'Dev', script: 'docker compose up' },
      { name: 'Node: Dev', script: 'npm run dev' },
    ]);
  });

  it('is idempotent', () => {
    const first = syncButtons(null, ['dev', 'test'], 'yarn');
    const second = syncButtons(first.buttons, ['dev', 'test'], 'yarn');
    expect(second.added).toEqual([]);
    expect(second.buttons).toEqual(first.buttons);
  });
});

describe('parseButtonsFile', () => {
  it('drops metadata and malformed entries', () => {
    const parsed = parseButtonsFile({
      buttons: [
        { name: 'Dev', script: 'npm run dev', id: 'x', icon: 'rocket', generated: true },
        { name: '', script: 'npm run x' },
        { name: 'NoScript' },
        'nope',
      ],
    });
    expect(parsed.buttons).toEqual([{ name: 'Dev', script: 'npm run dev' }]);
  });

  it('tolerates anything that is not the expected shape', () => {
    expect(parseButtonsFile(null).buttons).toEqual([]);
    expect(parseButtonsFile({}).buttons).toEqual([]);
    expect(parseButtonsFile({ buttons: 'x' }).buttons).toEqual([]);
  });
});

describe('appendButton', () => {
  const existing: ButtonConfig[] = [{ name: 'Dev', script: 'npm run dev' }];

  it('appends a valid button', () => {
    const result = appendButton(existing, 'Docker', 'docker compose up -d');
    expect(result).toEqual({
      ok: true,
      value: [...existing, { name: 'Docker', script: 'docker compose up -d' }],
    });
  });

  it('refuses a duplicated name regardless of case', () => {
    expect(appendButton(existing, 'dev', 'anything else').ok).toBe(false);
  });

  it('refuses a duplicated script', () => {
    const result = appendButton(existing, 'Outro', 'npm run dev');
    expect(result).toEqual({ ok: false, error: 'Já existe um botão com esse script.' });
  });
});

describe('removeButtonById', () => {
  it('removes the matching button and nothing else', () => {
    const buttons: ButtonConfig[] = [
      { name: 'Dev', script: 'npm run dev' },
      { name: 'Docker', script: 'docker compose up -d' },
    ];
    const next = removeButtonById(buttons, buttonId(buttons[1]!));
    expect(next).toEqual([buttons[0]]);
  });

  it('returns null for an unknown id', () => {
    expect(removeButtonById([{ name: 'Dev', script: 'npm run dev' }], 'nope')).toBeNull();
  });
});

describe('isCustomButton', () => {
  it('recognises buttons that mirror a package.json script', () => {
    expect(isCustomButton({ name: 'Dev', script: 'npm run dev' }, ['dev'], 'npm')).toBe(false);
    expect(isCustomButton({ name: 'Docker', script: 'docker ps' }, ['dev'], 'npm')).toBe(true);
  });
});

describe('displayNameForScript', () => {
  it('capitalises the first character only', () => {
    expect(displayNameForScript('dev')).toBe('Dev');
    expect(displayNameForScript('test:e2e')).toBe('Test:e2e');
  });
});

describe('file round-trip', () => {
  it('writes formatted JSON with a trailing newline', () => {
    const dir = makeTempDir();
    writeButtonsFile(dir, { buttons: [{ name: 'Dev', script: 'npm run dev' }] });
    expect(readFile(projectButtonsFile(dir))).toBe(
      '{\n  "buttons": [\n    {\n      "name": "Dev",\n      "script": "npm run dev"\n    }\n  ]\n}\n',
    );
  });

  it('leaves no temporary files behind', () => {
    const dir = makeTempDir();
    writeButtonsFile(dir, { buttons: [{ name: 'Dev', script: 'npm run dev' }] });
    expect(fs.readdirSync(`${dir}/.dev-island`)).toEqual(['buttons.json']);
  });

  it('returns null when the project was never initialised', () => {
    expect(readButtonsFile(makeTempDir())).toBeNull();
  });
});

describe('initializeProject', () => {
  it('creates the config on the first run and preserves it afterwards', () => {
    const dir = makeTempDir();
    writePackageJson(dir, { name: 'demo', scripts: { dev: 'vite', build: 'vite build' } });

    const first = initializeProject(dir);
    expect(first.created).toBe(true);
    expect(first.buttons).toEqual([
      { name: 'Dev', script: 'npm run dev' },
      { name: 'Build', script: 'npm run build' },
    ]);

    writeButtonsFile(dir, {
      buttons: [...first.buttons, { name: 'Docker', script: 'docker compose up -d' }],
    });

    const second = initializeProject(dir);
    expect(second.created).toBe(false);
    expect(second.added).toEqual([]);
    expect(second.buttons.map((button) => button.name)).toEqual(['Dev', 'Build', 'Docker']);
  });

  it('appends only the scripts that appeared since the last run', () => {
    const dir = makeTempDir();
    writePackageJson(dir, { scripts: { dev: 'vite' } });
    initializeProject(dir);

    writePackageJson(dir, { scripts: { dev: 'vite', test: 'vitest' } });
    expect(initializeProject(dir).added).toEqual([{ name: 'Test', script: 'npm run test' }]);
  });

  it('does not rewrite the file when nothing changed', () => {
    const dir = makeTempDir();
    writePackageJson(dir, { scripts: { dev: 'vite' } });
    initializeProject(dir);
    const before = fs.statSync(projectButtonsFile(dir)).mtimeMs;

    expect(initializeProject(dir).written).toBe(false);
    expect(fs.statSync(projectButtonsFile(dir)).mtimeMs).toBe(before);
  });

  it('uses the detected package manager for the generated commands', () => {
    const dir = makeTempDir();
    writePackageJson(dir, { scripts: { dev: 'vite' } });
    writeFile(`${dir}/yarn.lock`, '');
    expect(initializeProject(dir).buttons).toEqual([{ name: 'Dev', script: 'yarn dev' }]);
  });
});
