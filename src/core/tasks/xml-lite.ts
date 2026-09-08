/**
 * Just enough XML to read a `pom.xml`.
 *
 * The security properties come from what this parser *does not have*: there is
 * no DTD support, no entity table and no way to reference anything outside the
 * document, so an external entity cannot be resolved because the feature does
 * not exist. A document that declares a doctype or an entity is refused
 * outright rather than parsed with those parts ignored.
 *
 * Only the five predefined entities are decoded. Anything the reader cannot
 * account for makes the whole parse fail, and a failed parse means "no tasks",
 * never "wrong tasks".
 */

export interface XmlElement {
  name: string;
  /** Text directly inside the element, trimmed. */
  text: string;
  children: XmlElement[];
}

const PREDEFINED: ReadonlyMap<string, string> = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
]);

function decodeText(raw: string): string | null {
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char !== '&') {
      out += char;
      continue;
    }
    const end = raw.indexOf(';', index);
    if (end === -1) return null;
    const entity = raw.slice(index + 1, end);
    index = end;
    if (entity.startsWith('#')) {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const digits = isHex ? entity.slice(2) : entity.slice(1);
      if (!/^[0-9a-fA-F]+$/.test(digits)) return null;
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
      out += String.fromCodePoint(code);
      continue;
    }
    const replacement = PREDEFINED.get(entity);
    // Anything else would be a custom entity, which this reader refuses to
    // resolve — that is the whole point.
    if (replacement === undefined) return null;
    out += replacement;
  }
  return out;
}

/** Local name without its namespace prefix. */
function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/**
 * Parse a document into an element tree, or return null.
 *
 * `null` means "this file cannot be trusted": malformed markup, a doctype, an
 * entity declaration, or anything else outside the supported subset.
 */
export function parseXml(text: string): XmlElement | null {
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) return null;

  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let index = 0;
  let pending = '';

  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) {
      pending += text.slice(index);
      break;
    }
    pending += text.slice(index, open);

    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4);
      if (end === -1) return null;
      index = end + 3;
      continue;
    }
    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2);
      if (end === -1) return null;
      index = end + 2;
      continue;
    }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9);
      if (end === -1) return null;
      pending += text.slice(open + 9, end);
      index = end + 3;
      continue;
    }

    const close = text.indexOf('>', open);
    if (close === -1) return null;
    const tag = text.slice(open + 1, close).trim();
    if (tag.length === 0) return null;

    const current = stack[stack.length - 1];
    if (current) {
      const decoded = decodeText(pending);
      if (decoded === null) return null;
      if (decoded.trim().length > 0) current.text += decoded;
    }
    pending = '';

    if (tag.startsWith('/')) {
      const name = localName(tag.slice(1).trim());
      const finished = stack.pop();
      if (!finished || finished.name !== name) return null;
      finished.text = finished.text.trim();
      if (stack.length === 0) root = finished;
      index = close + 1;
      continue;
    }

    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1).trim() : tag;
    const name = localName(body.split(/[\s]/)[0] ?? '');
    if (name.length === 0) return null;
    const element: XmlElement = { name, text: '', children: [] };
    if (current) current.children.push(element);

    if (selfClosing) {
      if (!current) root = element;
    } else {
      stack.push(element);
    }
    index = close + 1;
  }

  return stack.length === 0 ? root : null;
}

/** Direct children with that local name. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** The first direct child with that name, or null. */
export function childNamed(element: XmlElement, name: string): XmlElement | null {
  return element.children.find((child) => child.name === name) ?? null;
}

/** Text of a direct child, trimmed, or null. */
export function childText(element: XmlElement, name: string): string | null {
  const child = childNamed(element, name);
  return child ? child.text.trim() : null;
}
