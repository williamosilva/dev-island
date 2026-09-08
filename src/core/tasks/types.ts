/**
 * The contract every ecosystem plugs into.
 *
 * A provider answers two questions about a directory — "is this mine?" and
 * "what can be run here?" — and nothing else. It reads files through an
 * injected port, so discovery runs without Electron and without a filesystem
 * in tests, and it never starts a process: a task is a *string* until the user
 * clicks it.
 *
 * Three ideas are kept apart on purpose:
 *
 * - a **language** is not a marker (`pyproject.toml` says Python, not tasks);
 * - a **marker** is not a task source (`pom.xml` marks Maven, whose tasks are
 *   lifecycle phases, not a list in the file);
 * - a **task source** is only what a file states outright.
 *
 * Nothing is ever guessed from a filename: no `python app.py`, no `flask run`.
 */

export type ProjectTaskProviderId =
  | 'node-package-json'
  | 'python-pdm'
  | 'python-pipenv'
  | 'python-hatch'
  | 'python-tox'
  | 'python-nox'
  | 'java-maven'
  | 'java-gradle';

export interface ProviderMatch {
  providerId: ProjectTaskProviderId;
  projectRoot: string;
  /** Absolute, in the order the provider consulted them. */
  sourceFiles: string[];
}

/**
 * `command` is canonical — `pdm run test`, `tox run -e py312` — built from the
 * task's *name*, never from the body declared in the manifest.
 */
export interface DiscoveredTask {
  providerId: ProjectTaskProviderId;
  name: string;
  command: string;
  /** Internal only: never written to buttons.json. */
  sourceFile: string;
}

export interface TaskDiagnostic {
  providerId: ProjectTaskProviderId;
  file: string;
  message: string;
}

/** All a provider may do with the filesystem. */
export interface TaskFs {
  exists(filePath: string): boolean;
  /** Null when the file is missing, unreadable or too large. */
  read(filePath: string): string | null;
  resolve(...segments: string[]): string;
  join(...segments: string[]): string;
  dirname(filePath: string): string;
  basename(filePath: string): string;
}

export type TaskPlatform = 'win32' | 'posix';

export interface ProjectDetectionContext {
  /** Already canonical. */
  directory: string;
  fs: TaskFs;
  platform: TaskPlatform;
  report(diagnostic: TaskDiagnostic): void;
}

export interface ProjectTaskProvider {
  readonly id: ProjectTaskProviderId;
  /** Prefix used when a name collides with an existing button. */
  readonly label: string;
  /** Null when this directory is none of the provider's business. */
  detect(context: ProjectDetectionContext): ProviderMatch | null;
  discover(match: ProviderMatch, context: ProjectDetectionContext): DiscoveredTask[];
  /** Files whose change should re-run the discovery. Absolute paths. */
  watchedFiles(match: ProviderMatch, context: ProjectDetectionContext): string[];
}
