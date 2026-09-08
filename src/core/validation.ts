import type { ButtonConfig } from '../shared/types';

export const MAX_NAME_LENGTH = 48;
export const MAX_SCRIPT_LENGTH = 1000;

/** Control characters (including newlines) are rejected in both fields. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export function normalizeName(name: string): string {
  return name.trim();
}

/** Case-insensitive key used to detect duplicate names. */
export function nameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase();
}

/** Trimmed comparison key used to detect a script that is already present. */
export function scriptKey(script: string): string {
  return script.trim().replace(/\s+/g, ' ');
}

export function validateName(rawName: unknown, existing: readonly ButtonConfig[]): Validation<string> {
  if (typeof rawName !== 'string') return { ok: false, error: 'Name is required.' };
  const name = normalizeName(rawName);
  if (name.length === 0) return { ok: false, error: 'Name is required.' };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name must be at most ${MAX_NAME_LENGTH} characters.` };
  }
  if (CONTROL_CHARS.test(name)) return { ok: false, error: 'Name has invalid characters.' };
  if (existing.some((button) => nameKey(button.name) === nameKey(name))) {
    return { ok: false, error: `A button called "${name}" already exists.` };
  }
  return { ok: true, value: name };
}

export function validateScript(rawScript: unknown): Validation<string> {
  if (typeof rawScript !== 'string') return { ok: false, error: 'Script is required.' };
  const script = rawScript.trim();
  if (script.length === 0) return { ok: false, error: 'Script is required.' };
  if (script.length > MAX_SCRIPT_LENGTH) {
    return { ok: false, error: `Script must be at most ${MAX_SCRIPT_LENGTH} characters.` };
  }
  if (CONTROL_CHARS.test(script)) return { ok: false, error: 'Script has invalid characters.' };
  return { ok: true, value: script };
}

/** Validate a button submitted through the widget's "Add" form. */
export function validateNewButton(
  rawName: unknown,
  rawScript: unknown,
  existing: readonly ButtonConfig[],
): Validation<ButtonConfig> {
  const name = validateName(rawName, existing);
  if (!name.ok) return name;
  const script = validateScript(rawScript);
  if (!script.ok) return script;
  return { ok: true, value: { name: name.value, script: script.value } };
}
