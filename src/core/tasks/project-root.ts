/**
 * Finding the root of the project a terminal is standing in.
 *
 * The walk goes up from the terminal's directory, never sideways and never
 * past what the current authorisation allows. Along the way it collects every
 * directory that carries a supported marker, and then picks between them by
 * strength rather than by distance alone — a Gradle build belongs to the
 * directory holding `settings.gradle`, and a Maven module belongs to its local
 * aggregator, even when a nearer directory also has a manifest.
 */

import type { TaskFs, TaskPlatform } from './types';

/** Never a root, whatever they contain. */
export const GENERATED_DIRECTORIES: readonly string[] = [
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.tox',
  '.nox',
  'target',
  'build',
  '.gradle',
  '.idea',
  'dist',
];

export const ROOT_MARKERS: readonly string[] = [
  'package.json',
  'pyproject.toml',
  'Pipfile',
  'hatch.toml',
  'tox.ini',
  'tox.toml',
  'setup.cfg',
  'setup.py',
  'requirements.txt',
  'noxfile.py',
  'pom.xml',
  'settings.gradle',
  'settings.gradle.kts',
  'build.gradle',
  'build.gradle.kts',
];

const MAX_WALK_UP = 40;

export function isGenerated(directory: string, platform: TaskPlatform): boolean {
  const segments = directory.split(/[\\/]+/);
  return segments.some((segment) => {
    const name = platform === 'win32' ? segment.toLowerCase() : segment;
    return GENERATED_DIRECTORIES.includes(platform === 'win32' ? name : segment) || name === 'node_modules';
  });
}

/** Windows compares paths without case; everywhere else it does not. */
export function samePath(a: string, b: string, platform: TaskPlatform): boolean {
  const normalise = (value: string): string => {
    const slashed = value.replace(/\\/g, '/').replace(/\/+$/, '');
    return platform === 'win32' ? slashed.toLowerCase() : slashed;
  };
  return normalise(a) === normalise(b);
}

export function isWithin(candidate: string, root: string, platform: TaskPlatform): boolean {
  const normalise = (value: string): string => {
    const slashed = value.replace(/\\/g, '/').replace(/\/+$/, '');
    return platform === 'win32' ? slashed.toLowerCase() : slashed;
  };
  const inner = normalise(candidate);
  const outer = normalise(root);
  return inner === outer || inner.startsWith(`${outer}/`);
}

export interface RootResolutionOptions {
  fs: TaskFs;
  platform: TaskPlatform;
  boundary?: (directory: string) => boolean;
  /** A root the user already authorised, which outranks every marker. */
  isAuthorizedRoot?: (directory: string) => boolean;
}

/** Higher wins. */
export const ROOT_STRENGTH = {
  authorizedConfig: 5,
  gradleSettings: 4,
  mavenAggregator: 3,
  manifest: 2,
} as const;

interface Candidate {
  directory: string;
  strength: number;
  /** Steps above the starting directory; nearer wins a tie. */
  distance: number;
}

function hasAny(fs: TaskFs, directory: string, names: readonly string[]): boolean {
  return names.some((name) => fs.exists(fs.join(directory, name)));
}

function isMavenAggregator(fs: TaskFs, directory: string): boolean {
  const pom = fs.join(directory, 'pom.xml');
  if (!fs.exists(pom)) return false;
  const text = fs.read(pom);
  // Proved from the text, not assumed: `<modules>` has to actually be there.
  return text !== null && /<modules\b[\s\S]*?<module\b/.test(text);
}

/**
 * The project root for a terminal sitting in `startDir`.
 *
 * Returns null when nothing along the way is a project — a lone `.py` or
 * `.java` file proves nothing, so a directory holding only source files is not
 * a root.
 */
export function resolveProjectRoot(
  startDir: string,
  options: RootResolutionOptions,
): string | null {
  const { fs, platform } = options;
  let current = fs.resolve(startDir);
  const candidates: Candidate[] = [];
  let sawRepositoryRoot = false;

  for (let distance = 0; distance < MAX_WALK_UP; distance += 1) {
    if (options.boundary?.(current)) break;

    if (!isGenerated(current, platform)) {
      if (options.isAuthorizedRoot?.(current) && fs.exists(fs.join(current, '.dev-island'))) {
        candidates.push({ directory: current, strength: ROOT_STRENGTH.authorizedConfig, distance });
      } else if (hasAny(fs, current, ['settings.gradle', 'settings.gradle.kts'])) {
        candidates.push({ directory: current, strength: ROOT_STRENGTH.gradleSettings, distance });
      } else if (isMavenAggregator(fs, current)) {
        candidates.push({ directory: current, strength: ROOT_STRENGTH.mavenAggregator, distance });
      } else if (hasAny(fs, current, ROOT_MARKERS)) {
        candidates.push({ directory: current, strength: ROOT_STRENGTH.manifest, distance });
      }
    }

    // A repository boundary: the walk may finish the directory it is on, but
    // it does not climb out of the repository.
    if (fs.exists(fs.join(current, '.git'))) {
      sawRepositoryRoot = true;
      break;
    }

    const parent = fs.dirname(current);
    if (samePath(parent, current, platform)) break;
    current = parent;
  }

  void sawRepositoryRoot;
  if (candidates.length === 0) return null;

  // Strongest marker first; between equals, the one nearest the terminal.
  candidates.sort((a, b) => b.strength - a.strength || a.distance - b.distance);
  return candidates[0]!.directory;
}
