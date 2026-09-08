import { describe, expect, it } from 'vitest';

import { parseToml } from '../src/core/tasks/toml-lite';

/**
 * Regression: a value spread over several lines.
 *
 * Found by the provider smoke test. A multi-line array — plain, valid TOML,
 * and the way `env_list` is often written — made the reader refuse the whole
 * document, which silently cost the project every task declared in it. The
 * reader now joins a statement until its brackets balance.
 */
describe('TOML values that span lines', () => {
  it('reads a multi-line array as one value', () => {
    const parsed = parseToml(
      ['[tool.pdm.scripts]', 'itens = [', '  "a",', '  "b",', ']', 'test = "pytest"', ''].join('\n'),
    );
    const scripts = (parsed?.tool as Record<string, Record<string, Record<string, unknown>>>).pdm!
      .scripts!;
    expect(scripts.itens).toEqual(['a', 'b']);
    // The statements after it are still read normally.
    expect(scripts.test).toBe('pytest');
  });

  it('reads a multi-line inline table the same way', () => {
    const parsed = parseToml(['[scripts]', 'lint = {', '  cmd = "ruff"', '}', ''].join('\n'));
    expect((parsed?.scripts as Record<string, Record<string, string>>).lint!.cmd).toBe('ruff');
  });

  it('still refuses a statement that never closes', () => {
    expect(parseToml(['x = [', '  "a",'].join('\n'))).toBeNull();
    expect(parseToml(['x = {', '  a = 1'].join('\n'))).toBeNull();
  });

  it('and a comment inside a multi-line array is still a comment', () => {
    const parsed = parseToml(
      ['[tox]', 'env_list = [', '  "py311",  # o mais antigo', '  "py312",', ']', ''].join('\n'),
    );
    expect((parsed?.tox as Record<string, string[]>).env_list).toEqual(['py311', 'py312']);
  });
});
