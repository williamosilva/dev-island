import * as fs from 'node:fs';
import * as path from 'node:path';

import { writeFileAtomic } from '../core/fs-atomic';
import {
  PRODUCT_ID,
  PRODUCT_NAME,
  SHELL_BLOCK_BEGIN,
  SHELL_BLOCK_BEGIN_PREFIX,
  SHELL_BLOCK_END,
} from '../shared/branding';
import { buildHookScript } from './hook-script';
import { psSingleQuote } from './powershell-quote';

/** Suffix of the one-time backup taken before the first profile edit. */
export const BACKUP_SUFFIX = `.${PRODUCT_ID}.bak`;

export interface ProfileTarget {
  /** Absolute path of the PowerShell profile to edit. */
  profilePath: string;
  /** Absolute path of the hook script this tool owns. */
  hookScriptPath: string;
}

export interface InstallOptions extends ProfileTarget {
  pipeShortName: string;
  tokenFilePath: string;
  pendingFilePath: string;
  launcherFilePath: string;
  launchLockPath: string;
}

export interface InstallResult extends ProfileTarget {
  profileUpdated: boolean;
  hookUpdated: boolean;
  backupPath: string | null;
}

export interface RemoveResult {
  profilePath: string;
  removed: boolean;
  /** True when a begin marker was found without its matching end marker. */
  unterminated: boolean;
  hookScriptRemoved: boolean;
}

/** The exact block written into the user's profile. Nothing else is touched. */
export function buildProfileBlock(hookScriptPath: string): string {
  return [
    SHELL_BLOCK_BEGIN,
    `# Managed by ${PRODUCT_NAME}. Do not edit inside this block.`,
    `# Remove with: ${PRODUCT_ID} remove-shell-integration`,
    `if ($env:TERM_PROGRAM -eq 'vscode') {`,
    `  $devIslandHook = ${psSingleQuote(hookScriptPath)}`,
    `  if (Test-Path -LiteralPath $devIslandHook) { . $devIslandHook }`,
    `  Remove-Variable -Name devIslandHook -ErrorAction SilentlyContinue`,
    `}`,
    SHELL_BLOCK_END,
  ].join('\n');
}

export function containsManagedBlock(content: string): boolean {
  return locateBlock(content.split(/\r?\n/), 0) !== null;
}

/** Matches the marker of any version, so an older block is still managed. */
function isBeginMarker(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith(SHELL_BLOCK_BEGIN_PREFIX) && trimmed.endsWith('>>>');
}

function locateBlock(lines: string[], from: number): { start: number; end: number } | null {
  const start = lines.findIndex((line, index) => index >= from && isBeginMarker(line));
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.trim() === SHELL_BLOCK_END);
  if (end === -1) return null;
  return { start, end };
}

function detectEol(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Remove every complete managed block, leaving all other content untouched.
 * A begin marker without its end marker is reported and left alone, so a
 * hand-mangled profile is never truncated.
 */
export function stripManagedBlock(content: string): {
  content: string;
  removed: boolean;
  unterminated: boolean;
} {
  const eol = detectEol(content);
  let lines = content.split(/\r?\n/);
  let removed = false;

  for (;;) {
    const block = locateBlock(lines, 0);
    if (!block) break;
    const before = lines.slice(0, block.start);
    const after = lines.slice(block.end + 1);
    // Collapse the blank line that used to separate the block from its neighbours.
    if (before.length > 0 && after.length > 0 && before[before.length - 1] === '' && after[0] === '') {
      after.shift();
    }
    lines = [...before, ...after];
    removed = true;
  }

  const unterminated = lines.some(isBeginMarker);
  return { content: lines.join(eol), removed, unterminated };
}

function readIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Copy the profile once, before the very first modification. */
function ensureBackup(profilePath: string, existing: string | null): string | null {
  if (existing === null) return null;
  const backupPath = `${profilePath}${BACKUP_SUFFIX}`;
  if (fs.existsSync(backupPath)) return backupPath;
  writeFileAtomic(backupPath, existing);
  return backupPath;
}

/**
 * Install (or refresh) the integration. Safe to run any number of times:
 * an existing managed block is replaced in place and everything else in the
 * profile is preserved byte for byte.
 */
export function installPowerShellIntegration(options: InstallOptions): InstallResult {
  const hookContent = buildHookScript({
    pipeShortName: options.pipeShortName,
    tokenFilePath: options.tokenFilePath,
    pendingFilePath: options.pendingFilePath,
    launcherFilePath: options.launcherFilePath,
    launchLockPath: options.launchLockPath,
  });
  const currentHook = readIfExists(options.hookScriptPath);
  const hookUpdated = currentHook !== hookContent;
  if (hookUpdated) {
    fs.mkdirSync(path.dirname(options.hookScriptPath), { recursive: true });
    writeFileAtomic(options.hookScriptPath, hookContent);
  }

  const existing = readIfExists(options.profilePath);
  const eol = existing ? detectEol(existing) : '\r\n';
  const block = buildProfileBlock(options.hookScriptPath).split('\n').join(eol);

  let nextContent: string;
  if (existing === null) {
    nextContent = `${block}${eol}`;
  } else if (containsManagedBlock(existing)) {
    const stripped = stripManagedBlock(existing).content;
    const base = stripped.replace(/(\r?\n)+$/, '');
    nextContent = base.length > 0 ? `${base}${eol}${eol}${block}${eol}` : `${block}${eol}`;
  } else {
    const base = existing.replace(/(\r?\n)+$/, '');
    nextContent = base.length > 0 ? `${base}${eol}${eol}${block}${eol}` : `${block}${eol}`;
  }

  if (existing === nextContent) {
    return {
      profilePath: options.profilePath,
      hookScriptPath: options.hookScriptPath,
      profileUpdated: false,
      hookUpdated,
      backupPath: null,
    };
  }

  const backupPath = ensureBackup(options.profilePath, existing);
  fs.mkdirSync(path.dirname(options.profilePath), { recursive: true });
  writeFileAtomic(options.profilePath, nextContent);

  return {
    profilePath: options.profilePath,
    hookScriptPath: options.hookScriptPath,
    profileUpdated: true,
    hookUpdated,
    backupPath,
  };
}

/** Remove only the managed block (and, optionally, the hook script we own). */
export function removePowerShellIntegration(
  options: ProfileTarget & { removeHookScript?: boolean },
): RemoveResult {
  const existing = readIfExists(options.profilePath);
  let removed = false;
  let unterminated = false;

  if (existing !== null) {
    const stripped = stripManagedBlock(existing);
    unterminated = stripped.unterminated;
    if (stripped.removed) {
      ensureBackup(options.profilePath, existing);
      writeFileAtomic(options.profilePath, stripped.content);
      removed = true;
    }
  }

  let hookScriptRemoved = false;
  if (options.removeHookScript !== false && fs.existsSync(options.hookScriptPath)) {
    fs.rmSync(options.hookScriptPath, { force: true });
    hookScriptRemoved = true;
  }

  return { profilePath: options.profilePath, removed, unterminated, hookScriptRemoved };
}
