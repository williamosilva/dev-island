import * as fs from 'node:fs';
import * as path from 'node:path';

import type { PackageManager } from '../shared/types';
import { detectPackageManager } from './package-manager';
import { discoverTasks } from './tasks/registry';
import type { DiscoveredTask } from './tasks/types';

/** Only the fields this tool cares about. */
export interface PackageJson {
  name?: unknown;
  scripts?: unknown;
  packageManager?: unknown;
}

/** A user-facing failure. */
export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

export interface ProjectInfo {
  path: string;
  /** package.json `name`, falling back to the folder name. */
  name: string;
  packageManager: PackageManager;
  /** In package.json order. */
  scripts: string[];
  /**
   * Everything every provider could prove for this root — Node scripts, PDM
   * scripts, Maven phases and so on. This is what decides whether a button is
   * the user's own; `scripts` stays for the Node-shaped callers.
   */
  tasks: DiscoveredTask[];
}

export function packageJsonPath(projectPath: string): string {
  return path.join(projectPath, 'package.json');
}

/**
 * Read the package.json of `projectPath` itself. Parent folders are not
 * searched: `init` always describes the folder the user is standing in.
 */
export function readPackageJson(projectPath: string): PackageJson {
  const file = packageJsonPath(projectPath);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProjectError(`Nenhum package.json encontrado em ${projectPath}`);
    }
    throw new ProjectError(`Não foi possível ler ${file}: ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProjectError(`${file} não é um JSON válido: ${(error as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProjectError(`${file} precisa conter um objeto JSON`);
  }
  return parsed as PackageJson;
}

/** Script names declared in package.json, in declaration order. */
export function readScripts(pkg: PackageJson): string[] {
  const scripts = pkg.scripts;
  if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) return [];
  return Object.entries(scripts as Record<string, unknown>)
    .filter(([name, body]) => name.trim().length > 0 && typeof body === 'string' && body.trim().length > 0)
    .map(([name]) => name);
}

export function readProjectName(pkg: PackageJson, projectPath: string): string {
  const name = pkg.name;
  if (typeof name === 'string' && name.trim().length > 0) return name.trim();
  return path.basename(path.resolve(projectPath)) || projectPath;
}

/**
 * Everything the CLI and the app need to know about a project folder.
 *
 * A `package.json` is read when there is one — its name, its scripts and the
 * package manager behave exactly as they always have. A project without one is
 * no longer a failure: a Python or Java root simply has no Node scripts, and
 * its tasks come from whichever providers recognise it.
 */
export function loadProject(projectPath: string): ProjectInfo {
  const resolved = path.resolve(projectPath);
  const pkg = hasPackageJson(resolved) ? readPackageJson(resolved) : null;
  return {
    path: resolved,
    name: pkg ? readProjectName(pkg, resolved) : path.basename(resolved) || resolved,
    packageManager: detectPackageManager(
      resolved,
      pkg && typeof pkg.packageManager === 'string' ? pkg.packageManager : null,
    ),
    scripts: pkg ? readScripts(pkg) : [],
    tasks: discoverTasks(resolved).tasks,
  };
}

export function hasPackageJson(projectPath: string): boolean {
  return fs.existsSync(packageJsonPath(projectPath));
}
