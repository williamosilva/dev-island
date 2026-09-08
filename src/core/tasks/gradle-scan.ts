/**
 * Reading a Gradle build file without running it.
 *
 * A build script is code, and applying a plugin can do real work during
 * configuration, so `gradle tasks` is never asked. Instead the file is read as
 * text and only plugins declared in plain sight are believed:
 *
 *     plugins { java }                 plugins { id 'java' }
 *     plugins { application }          plugins { id("application") }
 *     apply plugin: 'java'
 *
 * A plugin applied by a convention plugin, a version catalogue alias or any
 * other indirection cannot be proved from this file alone, so it is skipped
 * and no task is invented for it.
 */

/** The only plugins whose tasks this scanner will claim. */
export type GradlePlugin = 'java' | 'application' | 'spring-boot';

export interface GradleScanResult {
  plugins: Set<GradlePlugin>;
  /** Seen but not proved, for the log. */
  unproven: string[];
}

const JAVA_IDS = new Set([
  'java',
  'java-library',
  'org.gradle.java',
  'org.gradle.java-library',
  'groovy',
  'scala',
  'kotlin',
  'org.jetbrains.kotlin.jvm',
]);
const APPLICATION_IDS = new Set(['application', 'org.gradle.application']);
const SPRING_IDS = new Set(['org.springframework.boot']);

/** Comments and string bodies blanked out, offsets preserved. */
function blankGradleNoise(source: string): string {
  const out = source.split('');
  let index = 0;
  const blank = (from: number, to: number): void => {
    for (let at = from; at < to && at < out.length; at += 1) {
      if (out[at] !== '\n') out[at] = ' ';
    }
  };

  while (index < source.length) {
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(index, stop);
      index = stop;
      continue;
    }
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
        if (!triple && source[cursor] === '\n') break;
        cursor += 1;
      }
      const end = Math.min(cursor + quote.length, source.length);
      // Quotes stay, so a literal can be read back from the original text.
      blank(index + quote.length, end - quote.length);
      index = end;
      continue;
    }
    index += 1;
  }
  return out.join('');
}

function blockAfter(masked: string, keyword: string): { start: number; end: number } | null {
  const pattern = new RegExp(`(^|[^A-Za-z0-9_.])${keyword}\\s*\\{`, 'm');
  const found = pattern.exec(masked);
  if (!found) return null;
  const open = masked.indexOf('{', found.index);
  let depth = 0;
  for (let index = open; index < masked.length; index += 1) {
    if (masked[index] === '{') depth += 1;
    if (masked[index] === '}') {
      depth -= 1;
      if (depth === 0) return { start: open + 1, end: index };
    }
  }
  return null;
}

function literalsIn(source: string, from: number, to: number): string[] {
  const literals: string[] = [];
  let index = from;
  while (index < to) {
    const char = source[index]!;
    if (char !== '"' && char !== "'") {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    let value = '';
    let ok = false;
    while (cursor < to) {
      const inner = source[cursor]!;
      if (inner === '\\') {
        cursor += 2;
        continue;
      }
      if (inner === char) {
        ok = true;
        break;
      }
      if (inner === '\n') break;
      value += inner;
      cursor += 1;
    }
    if (ok && value.length > 0) literals.push(value);
    index = cursor + 1;
  }
  return literals;
}

function classify(id: string, result: GradleScanResult): void {
  const clean = id.trim();
  if (JAVA_IDS.has(clean)) result.plugins.add('java');
  else if (APPLICATION_IDS.has(clean)) result.plugins.add('application');
  else if (SPRING_IDS.has(clean)) result.plugins.add('spring-boot');
  else if (clean.length > 0) result.unproven.push(clean);
}

/**
 * The plugins a build file applies in plain sight.
 *
 * Both DSLs are read the same way: the `plugins { }` block contributes its
 * literal ids and its bare accessors (`java`, `application`), and each
 * `apply plugin: '...'` contributes one id.
 */
export function scanGradlePlugins(source: string): GradleScanResult {
  const result: GradleScanResult = { plugins: new Set(), unproven: [] };
  const masked = blankGradleNoise(source);

  const block = blockAfter(masked, 'plugins');
  if (block) {
    for (const literal of literalsIn(source, block.start, block.end)) classify(literal, result);
    // Kotlin DSL bare accessors: a line that is just `java` or `application`.
    for (const line of masked.slice(block.start, block.end).split('\n')) {
      const bare = line.trim().replace(/[;,]$/, '');
      if (/^[a-z-]+$/.test(bare)) classify(bare, result);
    }
  }

  // `apply plugin: 'java'` / `apply(plugin = "java")`
  const applyPattern = /(^|[^A-Za-z0-9_.])apply\s*[( ]\s*plugin\s*[:=]/g;
  let apply = applyPattern.exec(masked);
  while (apply !== null) {
    const from = apply.index + apply[0].length;
    const lineEnd = masked.indexOf('\n', from);
    const to = lineEnd === -1 ? masked.length : lineEnd;
    for (const literal of literalsIn(source, from, to)) classify(literal, result);
    apply = applyPattern.exec(masked);
  }

  return result;
}
