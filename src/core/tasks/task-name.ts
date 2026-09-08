/**
 * Names arriving from a manifest end up inside a command line, so only a
 * conservative shape is accepted. Anything else is dropped: a task called
 * `test; Remove-Item -Recurse .` never becomes a button.
 */
export const SAFE_TASK_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function isSafeTaskName(name: string): boolean {
  return name.length <= 120 && SAFE_TASK_NAME.test(name);
}

/** `dev` -> `Dev`, `test:e2e` -> `Test:e2e`. Same rule the Node flow uses. */
export function displayName(raw: string): string {
  if (raw.length === 0) return raw;
  return raw.charAt(0).toLocaleUpperCase() + raw.slice(1);
}

/** `PDM` + `Test` -> `PDM: Test`, used only when a name collides. */
export function prefixedName(label: string, name: string): string {
  return `${label}: ${name}`;
}
