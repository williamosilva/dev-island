import { describe, expect, it } from 'vitest';

import { validateName, validateNewButton, validateScript } from '../src/core/validation';
import type { ButtonConfig } from '../src/shared/types';

const existing: ButtonConfig[] = [
  { name: 'Dev', script: 'npm run dev' },
  { name: 'Docker', script: 'docker compose up -d' },
];

describe('validateName', () => {
  it('requires a name', () => {
    expect(validateName('', existing)).toEqual({ ok: false, error: 'Nome é obrigatório.' });
    expect(validateName('   ', existing)).toEqual({ ok: false, error: 'Nome é obrigatório.' });
    expect(validateName(undefined, existing)).toEqual({ ok: false, error: 'Nome é obrigatório.' });
  });

  it('rejects duplicates ignoring case', () => {
    expect(validateName('dev', existing).ok).toBe(false);
    expect(validateName('  DOCKER ', existing).ok).toBe(false);
  });

  it('accepts a new name and trims it', () => {
    expect(validateName('  Lint  ', existing)).toEqual({ ok: true, value: 'Lint' });
  });

  it('rejects control characters and oversized names', () => {
    expect(validateName('bad\nname', existing).ok).toBe(false);
    expect(validateName('x'.repeat(49), existing).ok).toBe(false);
  });
});

describe('validateScript', () => {
  it('requires a script', () => {
    expect(validateScript('')).toEqual({ ok: false, error: 'Script é obrigatório.' });
    expect(validateScript('  ')).toEqual({ ok: false, error: 'Script é obrigatório.' });
    expect(validateScript(null)).toEqual({ ok: false, error: 'Script é obrigatório.' });
  });

  it('trims and accepts a real command', () => {
    expect(validateScript('  docker compose up -d ')).toEqual({
      ok: true,
      value: 'docker compose up -d',
    });
  });

  it('rejects embedded newlines', () => {
    expect(validateScript('npm run dev\nrm -rf /').ok).toBe(false);
  });
});

describe('validateNewButton', () => {
  it('produces exactly the two persisted fields', () => {
    const result = validateNewButton('Docker Logs', 'docker compose logs -f', existing);
    expect(result).toEqual({
      ok: true,
      value: { name: 'Docker Logs', script: 'docker compose logs -f' },
    });
    if (result.ok) expect(Object.keys(result.value)).toEqual(['name', 'script']);
  });

  it('reports the name error before the script error', () => {
    const result = validateNewButton('Dev', '', existing);
    expect(result).toEqual({ ok: false, error: 'Já existe um botão chamado "Dev".' });
  });
});
