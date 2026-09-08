import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buttonsFileExists,
  mergeDiscoveredTasks,
  readButtonsFile,
  writeButtonsFile,
} from './buttons-config';
import { packageJsonPath, readProjectName, ProjectError, readPackageJson } from './project';
import { detectPackageManager } from './package-manager';
import { resolveProjectRoot } from './tasks/project-root';
import { discoverTasks, nodeTaskFs } from './tasks/registry';
import type { DiscoveredTask, TaskPlatform } from './tasks/types';
import type { ButtonConfig, PackageManager } from '../shared/types';

const MAX_WALK_UP = 40;

export function isInsideNodeModules(directory: string): boolean {
  return path
    .resolve(directory)
    .split(/[\\/]+/)
    .some((segment) => segment.toLowerCase() === 'node_modules');
}

export interface DiscoveryFs {
  hasPackageJson(directory: string): boolean;
}

const realFs: DiscoveryFs = {
  hasPackageJson: (directory) => fs.existsSync(packageJsonPath(directory)),
};

const platform: TaskPlatform = process.platform === 'win32' ? 'win32' : 'posix';

/**
 * A stray `package.json` in the home directory is common, and accepting it
 * would make every folder under it look like a project.
 */
export function isWalkBoundary(directory: string, home = os.homedir()): boolean {
  return path.resolve(directory).toLowerCase() === path.resolve(home).toLowerCase();
}

/**
 * Nearest Node project root at or above `startDir`, so a terminal in a
 * subfolder still finds it. {@link findTaskProjectRoot} covers the rest.
 */
export function findProjectRoot(startDir: string, deps: DiscoveryFs = realFs): string | null {
  let current = path.resolve(startDir);

  for (let step = 0; step < MAX_WALK_UP; step += 1) {
    if (isWalkBoundary(current)) return null;
    if (!isInsideNodeModules(current) && deps.hasPackageJson(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/** Ranked, so a build's real root wins over a nearer module. */
export function findTaskProjectRoot(
  startDir: string,
  options: { isAuthorized?: (root: string) => boolean } = {},
): string | null {
  return resolveProjectRoot(startDir, {
    fs: nodeTaskFs(),
    platform,
    boundary: (directory) => isWalkBoundary(directory),
    isAuthorizedRoot: options.isAuthorized,
  });
}

export type DiscoveryOutcome =
  | { kind: 'ignored'; reason: 'sem-package-json' | 'package-json-invalido' }
  /** Generated from the manifests, so it is trusted without asking. */
  | {
      kind: 'created';
      root: string;
      name: string;
      packageManager: PackageManager;
      buttons: ButtonConfig[];
    }
  | {
      kind: 'synced';
      root: string;
      name: string;
      packageManager: PackageManager;
      buttons: ButtonConfig[];
      added: ButtonConfig[];
    }
  /** Somebody else's config: nothing is written until the user confirms. */
  | {
      kind: 'needs-authorization';
      root: string;
      name: string;
      packageManager: PackageManager;
      buttons: ButtonConfig[];
    };

export interface DiscoveryOptions {
  isAuthorized(root: string): boolean;
  deps?: DiscoveryFs;
}

/**
 * Turns a prompt in a directory into a project, writing the configuration when
 * there is none. No command is ever run here.
 */
export function discoverProject(cwd: string, options: DiscoveryOptions): DiscoveryOutcome {
  const root =
    findProjectRoot(cwd, options.deps ?? realFs) ??
    findTaskProjectRoot(cwd, { isAuthorized: options.isAuthorized });
  if (!root) return { kind: 'ignored', reason: 'sem-package-json' };

  let name = path.basename(root) || root;
  let packageManager: PackageManager = detectPackageManager(root, null);
  let brokenPackageJson = false;
  try {
    // Only for the display name and the package manager; a Python or Java root
    // has neither.
    const pkg = fs.existsSync(packageJsonPath(root)) ? readPackageJson(root) : null;
    if (pkg) {
      name = readProjectName(pkg, root);
      packageManager = detectPackageManager(
        root,
        typeof pkg.packageManager === 'string' ? pkg.packageManager : null,
      );
    }
  } catch (error) {
    if (!(error instanceof ProjectError)) throw error;
    brokenPackageJson = true;
  }

  const tasks: DiscoveredTask[] = discoverTasks(root).tasks;
  const existing = buttonsFileExists(root) ? readButtonsFile(root) : null;

  // A broken package.json only sinks the project when it was the only reason
  // to be here.
  if (brokenPackageJson && tasks.length === 0 && !existing) {
    return { kind: 'ignored', reason: 'package-json-invalido' };
  }

  if (!existing) {
    const { buttons } = mergeDiscoveredTasks(null, tasks);
    // A recognised project with no task source gets an empty file.
    writeButtonsFile(root, { buttons });
    return { kind: 'created', root, name, packageManager, buttons };
  }

  if (!options.isAuthorized(root)) {
    return { kind: 'needs-authorization', root, name, packageManager, buttons: existing.buttons };
  }

  const { buttons, added } = mergeDiscoveredTasks(existing.buttons, tasks);
  // Nothing new means nothing written, so a discovery pass cannot churn the file.
  if (added.length > 0) writeButtonsFile(root, { buttons });
  return { kind: 'synced', root, name, packageManager, buttons, added };
}
