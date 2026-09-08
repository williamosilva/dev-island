/**
 * Reading a `noxfile.py` without running it.
 *
 * A noxfile is ordinary Python: importing it, asking `nox --list` or
 * evaluating a decorator would all execute whatever the file contains. So it
 * is treated as text and nothing else. The scanner walks the source once,
 * keeping track of comments and every kind of string literal, and only reports
 * a session when both the decorator and the name are literal.
 *
 * Anything dynamic — a computed name, a parametrised session, a decorator
 * built at runtime — is skipped rather than approximated.
 */

/** Comments and string bodies blanked out, offsets preserved. */
function blankStringsAndComments(source: string): string {
  const out = source.split('');
  let index = 0;

  const blank = (from: number, to: number): void => {
    for (let at = from; at < to && at < out.length; at += 1) {
      if (out[at] !== '\n') out[at] = ' ';
    }
  };

  while (index < source.length) {
    const char = source[index]!;

    if (char === '#') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }

    if (char === '"' || char === "'") {
      const triple = source.startsWith(char.repeat(3), index);
      const quote = triple ? char.repeat(3) : char;
      let cursor = index + quote.length;
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (source.startsWith(quote, cursor)) break;
        if (!triple && source[cursor] === '\n') break;
        cursor += 1;
      }
      const end = Math.min(cursor + quote.length, source.length);
      // The quotes stay: a literal has to remain recognisable as one, so a
      // `name="..."` can still be read back from the original text.
      blank(index + quote.length, end - quote.length);
      index = end;
      continue;
    }

    index += 1;
  }

  return out.join('');
}

function literalAt(source: string, index: number): string | null {
  const quote = source[index];
  if (quote !== '"' && quote !== "'") return null;
  let out = '';
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor]!;
    if (char === '\\') return null; // an escaped name is not a plain literal
    if (char === quote) return out;
    if (char === '\n') return null;
    out += char;
  }
  return null;
}

/** The matching `)` for the `(` at `open`, respecting strings. */
function matchParen(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === '"' || char === "'") {
      const triple = source.startsWith(char.repeat(3), index);
      const quote = triple ? char.repeat(3) : char;
      let cursor = index + quote.length;
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (source.startsWith(quote, cursor)) break;
        cursor += 1;
      }
      index = cursor + quote.length - 1;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export interface NoxSession {
  /** The name `nox --sessions` would accept. */
  name: string;
  /** Came from `name="..."` rather than the function name. */
  explicit: boolean;
}

export interface NoxScanResult {
  sessions: NoxSession[];
  skipped: string[];
}

const DECORATOR = /@nox\.session\b/g;
const FUNCTION = /\bdef\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const NAME_ARGUMENT = /(^|[\s,(])name\s*=/;

/**
 * Sessions declared in a noxfile, found by reading it.
 *
 * The decorator is located in a copy with comments and string bodies blanked,
 * so a `@nox.session` written inside a docstring cannot be mistaken for one.
 * The literal name is then read from the original text at the same offsets.
 */
export function scanNoxSessions(source: string): NoxScanResult {
  const masked = blankStringsAndComments(source);
  const sessions: NoxSession[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  DECORATOR.lastIndex = 0;
  let match = DECORATOR.exec(masked);
  while (match !== null) {
    const start = match.index;
    let cursor = start + match[0].length;
    let explicitName: string | null = null;
    let dynamic = false;

    // `@nox.session(...)`: look for a literal `name=`.
    while (cursor < masked.length && (masked[cursor] === ' ' || masked[cursor] === '\t')) cursor += 1;
    if (masked[cursor] === '(') {
      const close = matchParen(masked, cursor);
      if (close === -1) {
        skipped.push('decorator with an unclosed parenthesis');
        break;
      }
      const argumentsText = masked.slice(cursor + 1, close);
      const nameAt = NAME_ARGUMENT.exec(argumentsText);
      if (nameAt) {
        const equals = argumentsText.indexOf('=', nameAt.index + nameAt[1]!.length);
        let valueAt = equals + 1;
        while (valueAt < argumentsText.length && /\s/.test(argumentsText[valueAt]!)) valueAt += 1;
        // Read the literal from the original source, at the same offset.
        const absolute = cursor + 1 + valueAt;
        const literal = literalAt(source, absolute);
        if (literal === null) dynamic = true;
        else explicitName = literal;
      }
      cursor = close + 1;
    }

    const rest = masked.slice(cursor, cursor + 2000);
    const definition = FUNCTION.exec(rest);
    if (!definition) {
      skipped.push('decorator with no function right below it');
      match = DECORATOR.exec(masked);
      continue;
    }

    const name = explicitName ?? definition[1]!;
    if (dynamic) {
      skipped.push(`session with a dynamic name near "${definition[1]!}"`);
    } else if (!isSafeSessionName(name)) {
      skipped.push(`session name refused: ${name}`);
    } else if (!seen.has(name)) {
      seen.add(name);
      sessions.push({ name, explicit: explicitName !== null });
    }

    match = DECORATOR.exec(masked);
  }

  return { sessions, skipped };
}

/** Deliberately conservative: the name ends up in a command line. */
function isSafeSessionName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(name);
}
