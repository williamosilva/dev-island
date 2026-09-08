/**
 * A deliberately small TOML reader.
 *
 * It covers exactly what the task sources declare — tables, dotted keys,
 * strings, arrays and inline tables — and refuses everything else rather than
 * guessing. A file it cannot prove comes back as `null`, and the caller treats
 * that as "no tasks here", never as "delete the buttons".
 *
 * Not supported, on purpose: multi-line strings, dates and numbers with
 * underscores. None of them can carry a task name, so meeting one only means
 * the parse has stopped being certain — which is exactly when it should stop.
 */

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

/** Strings are left intact, so a `#` inside one is not a comment. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#') return line.slice(0, index);
  }
  return line;
}

function splitTop(text: string, separator: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      current += char;
      if (char === '\\' && quote === '"') {
        const next = text[index + 1];
        if (next === undefined) return null;
        current += next;
        index += 1;
      } else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[' || char === '{') depth += 1;
    if (char === ']' || char === '}') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (quote !== null || depth !== 0) return null;
  parts.push(current);
  return parts;
}

function parseBasicString(text: string): string | null {
  let out = '';
  for (let index = 1; index < text.length - 1; index += 1) {
    const char = text[index]!;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const escape = text[index + 1];
    index += 1;
    if (escape === 'n') out += '\n';
    else if (escape === 't') out += '\t';
    else if (escape === 'r') out += '\r';
    else if (escape === '"') out += '"';
    else if (escape === '\\') out += '\\';
    else if (escape === 'u' || escape === 'U') {
      const width = escape === 'u' ? 4 : 8;
      const code = text.slice(index + 1, index + 1 + width);
      if (!/^[0-9a-fA-F]+$/.test(code) || code.length !== width) return null;
      out += String.fromCodePoint(Number.parseInt(code, 16));
      index += width;
    } else return null;
  }
  return out;
}

function parseKey(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return parseBasicString(trimmed);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

/** `a.b."c"` -> `['a', 'b', 'c']`. */
function parsePath(text: string): string[] | null {
  const parts = splitTop(text, '.');
  if (!parts) return null;
  const keys: string[] = [];
  for (const part of parts) {
    const key = parseKey(part);
    if (key === null) return null;
    keys.push(key);
  }
  return keys.length > 0 ? keys : null;
}

function parseValue(text: string): { value: TomlValue } | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const value = parseBasicString(trimmed);
    return value === null ? null : { value };
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return { value: trimmed.slice(1, -1) };
  }
  if (trimmed === 'true') return { value: true };
  if (trimmed === 'false') return { value: false };

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return { value: [] };
    const parts = splitTop(inner, ',');
    if (!parts) return null;
    const items: TomlValue[] = [];
    for (const part of parts) {
      if (part.trim().length === 0) continue;
      const item = parseValue(part);
      if (!item) return null;
      items.push(item.value);
    }
    return { value: items };
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();
    const table: TomlTable = {};
    if (inner.length === 0) return { value: table };
    const parts = splitTop(inner, ',');
    if (!parts) return null;
    for (const part of parts) {
      if (part.trim().length === 0) continue;
      const pair = splitTop(part, '=');
      if (!pair || pair.length < 2) return null;
      const keys = parsePath(pair[0]!);
      const value = parseValue(pair.slice(1).join('='));
      if (!keys || !value) return null;
      assign(table, keys, value.value);
    }
    return { value: table };
  }

  if (/^[+-]?\d+$/.test(trimmed)) return { value: Number.parseInt(trimmed, 10) };
  if (/^[+-]?\d+\.\d+$/.test(trimmed)) return { value: Number.parseFloat(trimmed) };
  return null;
}

function assign(root: TomlTable, keys: readonly string[], value: TomlValue): void {
  let table = root;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index]!;
    const next = table[key];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      const created: TomlTable = {};
      table[key] = created;
      table = created;
      continue;
    }
    table = next;
  }
  table[keys[keys.length - 1]!] = value;
}

/**
 * Parse a TOML document, or give up.
 *
 * Giving up is a first-class outcome: a manifest this reader cannot fully
 * account for produces no tasks at all, rather than a half-read list.
 */
export function parseToml(text: string): TomlTable | null {
  const root: TomlTable = {};
  let current = root;

  for (const line of logicalLines(text)) {
    if (line === null) return null;
    if (line.length === 0) continue;

    if (line.startsWith('[[')) {
      // `[[source]]` in a Pipfile declares no tasks: park its keys in a table
      // nobody reads rather than fail the file over them.
      if (!line.endsWith(']]')) return null;
      current = {};
      continue;
    }
    if (line.startsWith('[')) {
      if (!line.endsWith(']')) return null;
      const keys = parsePath(line.slice(1, -1));
      if (!keys) return null;
      const table: TomlTable = {};
      // Re-enter an existing table rather than replacing it.
      let cursor = root;
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!;
        const existing = cursor[key];
        if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
          cursor = existing;
        } else {
          const created: TomlTable = index === keys.length - 1 ? table : {};
          cursor[key] = created;
          cursor = created;
        }
      }
      current = cursor;
      continue;
    }

    const pair = splitTop(line, '=');
    if (!pair || pair.length < 2) return null;
    const keys = parsePath(pair[0]!);
    const value = parseValue(pair.slice(1).join('='));
    if (!keys || !value) return null;
    assign(current, keys, value.value);
  }

  return root;
}

/**
 * The file as complete statements.
 *
 * An array or an inline table may be spread over several lines, so a line
 * whose brackets are still open is joined with the ones that follow until they
 * balance. A statement that never closes yields `null`, which fails the parse.
 */
function logicalLines(text: string): Array<string | null> {
  const statements: Array<string | null> = [];
  let pending = '';

  for (const rawLine of text.split(/\r?\n/)) {
    const piece = stripComment(rawLine).trim();
    if (pending.length === 0 && piece.length === 0) {
      statements.push('');
      continue;
    }
    pending = pending.length === 0 ? piece : `${pending} ${piece}`;
    if (isBalanced(pending)) {
      statements.push(pending);
      pending = '';
    }
  }

  if (pending.length > 0) statements.push(null);
  return statements;
}

function isBalanced(text: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[' || char === '{') depth += 1;
    if (char === ']' || char === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return quote === null && depth === 0;
}

export function tomlTable(root: TomlTable | null, ...keys: string[]): TomlTable | null {
  let cursor: TomlValue | undefined = root ?? undefined;
  for (const key of keys) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return null;
    cursor = (cursor as TomlTable)[key];
  }
  if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return null;
  return cursor;
}

/** Accepts a string or an array of them. */
export function tomlStrings(value: TomlValue | undefined): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}
