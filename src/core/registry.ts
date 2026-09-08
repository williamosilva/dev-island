import { readJsonIfExists, writeJsonAtomic } from './fs-atomic';
import { normalizeProjectPath, registryFile } from './paths';

export interface RegistryEntry {
  /** Absolute project root, as typed by the user. */
  path: string;
  name: string;
  /** ISO timestamp of the `init` that authorized it. */
  authorizedAt: string;
}

export interface RegistryFile {
  version: 1;
  projects: RegistryEntry[];
}

const EMPTY: RegistryFile = { version: 1, projects: [] };

/**
 * List of projects the user explicitly authorized with `dev-island init`.
 *
 * It lives in the per-user data directory (never inside a repository) so a
 * cloned repo containing a `.dev-island/buttons.json` cannot authorize itself.
 * The file is re-read on every call: the CLI and the running app are separate
 * processes and must not work from a stale snapshot.
 */
export class ProjectRegistry {
  constructor(private readonly dataDir: string) {}

  load(): RegistryFile {
    let parsed: unknown;
    try {
      parsed = readJsonIfExists<unknown>(registryFile(this.dataDir));
    } catch {
      return { ...EMPTY, projects: [] };
    }
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY, projects: [] };

    const list = (parsed as { projects?: unknown }).projects;
    if (!Array.isArray(list)) return { ...EMPTY, projects: [] };

    const projects: RegistryEntry[] = [];
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { path, name, authorizedAt } = entry as Record<string, unknown>;
      if (typeof path !== 'string' || path.trim().length === 0) continue;
      projects.push({
        path,
        name: typeof name === 'string' && name.trim() ? name : path,
        authorizedAt: typeof authorizedAt === 'string' ? authorizedAt : new Date(0).toISOString(),
      });
    }
    return { version: 1, projects };
  }

  list(): RegistryEntry[] {
    return this.load().projects;
  }

  isAuthorized(projectPath: string): boolean {
    const key = normalizeProjectPath(projectPath);
    return this.load().projects.some((entry) => normalizeProjectPath(entry.path) === key);
  }

  /** Idempotent: re-authorizing an existing project only refreshes its name. */
  authorize(projectPath: string, name: string): RegistryEntry {
    const key = normalizeProjectPath(projectPath);
    const current = this.load();
    const entry: RegistryEntry = {
      path: projectPath,
      name,
      authorizedAt:
        current.projects.find((item) => normalizeProjectPath(item.path) === key)?.authorizedAt ??
        new Date().toISOString(),
    };
    const projects = current.projects.filter((item) => normalizeProjectPath(item.path) !== key);
    projects.push(entry);
    writeJsonAtomic(registryFile(this.dataDir), { version: 1, projects } satisfies RegistryFile);
    return entry;
  }

  revoke(projectPath: string): boolean {
    const key = normalizeProjectPath(projectPath);
    const current = this.load();
    const projects = current.projects.filter((item) => normalizeProjectPath(item.path) !== key);
    if (projects.length === current.projects.length) return false;
    writeJsonAtomic(registryFile(this.dataDir), { version: 1, projects } satisfies RegistryFile);
    return true;
  }
}
