import * as fs from 'node:fs';

import type { ButtonConfig, ButtonsFile, PackageManager } from '../shared/types';
import { buttonId } from './button-id';
import { readJsonIfExists, writeJsonAtomic } from './fs-atomic';
import { buildScriptCommand } from './package-manager';
import { projectButtonsFile } from './paths';
import { PROVIDERS } from './tasks/registry';
import { prefixedName } from './tasks/task-name';
import type { DiscoveredTask, ProjectTaskProviderId } from './tasks/types';
import { nameKey, scriptKey, validateNewButton, type Validation } from './validation';

/**
 * Keep only `{ name, script }` and drop anything malformed.
 *
 * Unknown properties written by hand are discarded rather than carried over:
 * every reader of this file expects exactly those two keys.
 */
export function parseButtonsFile(raw: unknown): ButtonsFile {
  if (typeof raw !== 'object' || raw === null) return { buttons: [] };
  const list = (raw as { buttons?: unknown }).buttons;
  if (!Array.isArray(list)) return { buttons: [] };

  const buttons: ButtonConfig[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, script } = entry as { name?: unknown; script?: unknown };
    if (typeof name !== 'string' || typeof script !== 'string') continue;
    if (name.trim().length === 0 || script.trim().length === 0) continue;
    buttons.push({ name: name.trim(), script: script.trim() });
  }
  return { buttons };
}

export function buttonsFileExists(projectPath: string): boolean {
  return fs.existsSync(projectButtonsFile(projectPath));
}

/** Null when the project has no config file yet. */
export function readButtonsFile(projectPath: string): ButtonsFile | null {
  const file = projectButtonsFile(projectPath);
  let raw: unknown;
  try {
    raw = readJsonIfExists<unknown>(file);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  if (raw === null) return null;
  return parseButtonsFile(raw);
}

export function writeButtonsFile(projectPath: string, file: ButtonsFile): void {
  const payload: ButtonsFile = {
    buttons: file.buttons.map((button) => ({ name: button.name, script: button.script })),
  };
  writeJsonAtomic(projectButtonsFile(projectPath), payload);
}

/** `dev` -> `Dev`, `test:e2e` -> `Test:e2e`. */
export function displayNameForScript(scriptName: string): string {
  if (scriptName.length === 0) return scriptName;
  return scriptName.charAt(0).toLocaleUpperCase() + scriptName.slice(1);
}

function uniqueName(base: string, takenKeys: Set<string>): string {
  if (!takenKeys.has(nameKey(base))) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base} (${suffix})`;
    if (!takenKeys.has(nameKey(candidate))) return candidate;
  }
  return `${base} (${Date.now()})`;
}

export interface SyncResult {
  buttons: ButtonConfig[];
  added: ButtonConfig[];
}

const PROVIDER_LABELS: ReadonlyMap<ProjectTaskProviderId, string> = new Map(
  PROVIDERS.map((provider) => [provider.id, provider.label]),
);

/**
 * The file on disk always wins: existing buttons keep their name, command and
 * position, and a task only joins the end when nothing already runs it. On a
 * name collision the *new* button takes the provider prefix. Idempotent.
 */
export function mergeDiscoveredTasks(
  existing: readonly ButtonConfig[] | null,
  tasks: readonly DiscoveredTask[],
): SyncResult {
  const buttons: ButtonConfig[] = (existing ?? []).map((button) => ({ ...button }));
  const scriptKeys = new Set(buttons.map((button) => scriptKey(button.script)));
  const nameKeys = new Set(buttons.map((button) => nameKey(button.name)));
  const added: ButtonConfig[] = [];

  for (const task of tasks) {
    const command = task.command.trim();
    if (command.length === 0) continue;
    // Same command, whatever it is called: nothing to add.
    if (scriptKeys.has(scriptKey(command))) continue;

    let name = task.name;
    if (nameKeys.has(nameKey(name))) {
      const label = PROVIDER_LABELS.get(task.providerId);
      const prefixed = label ? prefixedName(label, name) : name;
      name = uniqueName(prefixed, nameKeys);
    }

    const button: ButtonConfig = { name, script: command };
    buttons.push(button);
    added.push(button);
    scriptKeys.add(scriptKey(command));
    nameKeys.add(nameKey(name));
  }

  return { buttons, added };
}

/** Defers to `mergeDiscoveredTasks`, so there is one path into the file. */
export function syncButtons(
  existing: readonly ButtonConfig[] | null,
  scripts: readonly string[],
  manager: PackageManager,
): SyncResult {
  return mergeDiscoveredTasks(
    existing,
    scripts.map((scriptName) => ({
      providerId: 'node-package-json' as const,
      name: displayNameForScript(scriptName),
      command: buildScriptCommand(manager, scriptName),
      sourceFile: 'package.json',
    })),
  );
}

export function appendButton(
  existing: readonly ButtonConfig[],
  rawName: unknown,
  rawScript: unknown,
): Validation<ButtonConfig[]> {
  const validated = validateNewButton(rawName, rawScript, existing);
  if (!validated.ok) return validated;
  if (existing.some((button) => scriptKey(button.script) === scriptKey(validated.value.script))) {
    return { ok: false, error: 'A button with that script already exists.' };
  }
  return { ok: true, value: [...existing, validated.value] };
}

/**
 * Matched by stable id, so a running PTY keeps its session key. Anything but
 * an exact permutation is refused: a stale request cannot drop a button.
 */
export function reorderButtons(
  existing: readonly ButtonConfig[],
  orderedIds: readonly string[],
): ButtonConfig[] | null {
  if (orderedIds.length !== existing.length) return null;

  const byId = new Map(existing.map((button) => [buttonId(button), button]));
  const next: ButtonConfig[] = [];
  for (const id of orderedIds) {
    const button = byId.get(id);
    if (!button) return null;
    byId.delete(id);
    next.push(button);
  }
  return byId.size === 0 ? next : null;
}

export function removeButtonById(
  existing: readonly ButtonConfig[],
  id: string,
): ButtonConfig[] | null {
  const next = existing.filter((button) => buttonId(button) !== id);
  return next.length === existing.length ? null : next;
}

/** True for a button the user added rather than one from `package.json`. */
export function isCustomButton(
  button: ButtonConfig,
  scripts: readonly string[],
  manager: PackageManager,
): boolean {
  const key = scriptKey(button.script);
  return !scripts.some((scriptName) => scriptKey(buildScriptCommand(manager, scriptName)) === key);
}

/** The same question, against everything the providers discovered. */
export function isCustomAmong(
  button: ButtonConfig,
  tasks: readonly DiscoveredTask[],
): boolean {
  const key = scriptKey(button.script);
  return !tasks.some((task) => scriptKey(task.command) === key);
}
