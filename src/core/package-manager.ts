import * as fs from 'node:fs';
import * as path from 'node:path';

import type { PackageManager } from '../shared/types';

export const PACKAGE_MANAGERS: readonly PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

/**
 * Lock files in precedence order. npm comes last because `package-lock.json`
 * is the one that most often lingers next to another manager's lock file.
 */
const LOCKFILES: ReadonlyArray<{ files: readonly string[]; manager: PackageManager }> = [
  { files: ['pnpm-lock.yaml'], manager: 'pnpm' },
  { files: ['yarn.lock'], manager: 'yarn' },
  { files: ['bun.lock', 'bun.lockb'], manager: 'bun' },
  { files: ['package-lock.json'], manager: 'npm' },
];

/** Everything detection needs, so it can be unit tested without a filesystem. */
export interface PackageManagerProbe {
  /** Raw `packageManager` field from package.json, if any. */
  packageManagerField?: string | null | undefined;
  /** Whether a file with that name exists in the project root. */
  hasFile(fileName: string): boolean;
}

/**
 * `"pnpm@8.6.0"` -> `"pnpm"`. Returns null for unknown or malformed values so
 * detection falls through to the lock files.
 */
export function parsePackageManagerField(field: string | null | undefined): PackageManager | null {
  if (typeof field !== 'string') return null;
  const name = field.trim().split('@')[0]?.trim().toLowerCase();
  if (!name) return null;
  return (PACKAGE_MANAGERS as readonly string[]).includes(name) ? (name as PackageManager) : null;
}

/** Pure detection: package.json field first, then lock files, then npm. */
export function detectPackageManagerFrom(probe: PackageManagerProbe): PackageManager {
  const fromField = parsePackageManagerField(probe.packageManagerField);
  if (fromField) return fromField;

  for (const entry of LOCKFILES) {
    if (entry.files.some((file) => probe.hasFile(file))) return entry.manager;
  }
  return 'npm';
}

/** Filesystem-backed detection for a project root. */
export function detectPackageManager(
  projectPath: string,
  packageManagerField?: string | null,
): PackageManager {
  return detectPackageManagerFrom({
    packageManagerField: packageManagerField ?? null,
    hasFile: (fileName) => fs.existsSync(path.join(projectPath, fileName)),
  });
}

/**
 * Command that runs a package.json script through the project's package
 * manager. The script body itself is never inlined.
 */
export function buildScriptCommand(manager: PackageManager, scriptName: string): string {
  const target = /\s/.test(scriptName) ? `"${scriptName}"` : scriptName;
  switch (manager) {
    case 'yarn':
      return `yarn ${target}`;
    case 'pnpm':
      return `pnpm run ${target}`;
    case 'bun':
      return `bun run ${target}`;
    case 'npm':
    default:
      return `npm run ${target}`;
  }
}
