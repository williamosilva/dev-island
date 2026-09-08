/**
 * The INI dialect tox and setuptools use.
 *
 * Sections, `key = value`, `key: value`, `#`/`;` comments and the indented
 * continuation lines that `envlist` and `commands` rely on. Values come back
 * as raw text; deciding what a value means is the provider's job.
 */

export type IniDocument = Map<string, Map<string, string>>;

const SECTION = /^\[([^\]]+)\]\s*$/;

export function parseIni(text: string): IniDocument {
  const document: IniDocument = new Map();
  let section = document.get('') ?? new Map<string, string>();
  document.set('', section);
  let key: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/(^|\s)[#;].*$/, '$1');
    const line = withoutComment.trimEnd();
    if (line.trim().length === 0) {
      // A blank line ends a continuation, so the next indented line cannot be
      // folded into an unrelated key.
      key = null;
      continue;
    }

    const heading = SECTION.exec(line.trim());
    if (heading) {
      const name = heading[1]!.trim();
      section = document.get(name) ?? new Map<string, string>();
      document.set(name, section);
      key = null;
      continue;
    }

    // Indented and following a key: a continuation of that key's value.
    if (/^\s/.test(rawLine) && key !== null) {
      section.set(key, `${section.get(key) ?? ''}\n${line.trim()}`);
      continue;
    }

    const separator = line.search(/[=:]/);
    if (separator <= 0) {
      key = null;
      continue;
    }
    key = line.slice(0, separator).trim();
    section.set(key, line.slice(separator + 1).trim());
  }

  return document;
}

/** The value of `key` in `section`, or null. */
export function iniValue(
  document: IniDocument,
  section: string,
  key: string,
): string | null {
  return document.get(section)?.get(key) ?? null;
}

/** Section names, in file order. */
export function iniSections(document: IniDocument): string[] {
  return [...document.keys()].filter((name) => name.length > 0);
}
