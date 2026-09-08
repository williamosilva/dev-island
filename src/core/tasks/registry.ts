/**
 * Where the providers meet the rest of the app.
 *
 * One directory can belong to several ecosystems at once — a `package.json`
 * next to a `pyproject.toml` next to a `pom.xml` — so every provider is asked,
 * and the tasks of all of them are merged. A repository is never classified as
 * "a Python project" or "a Java project": that judgement would hide the tools
 * it also uses.
 *
 * Nothing here executes anything. The only I/O is reading text files through
 * the injected port.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { gradleProvider, mavenProvider } from './java-providers';
import { nodeProvider } from './node-provider';
import {
  hatchProvider,
  noxProvider,
  pdmProvider,
  pipenvProvider,
  toxProvider,
} from './python-providers';
import type {
  DiscoveredTask,
  ProjectDetectionContext,
  ProjectTaskProvider,
  ProviderMatch,
  TaskDiagnostic,
  TaskFs,
  TaskPlatform,
} from './types';

/**
 * Ask order, which is also the order tasks appear in.
 *
 * Node first, so a project that has always been a Node project keeps the exact
 * button order it had before any of this existed.
 */
export const PROVIDERS: readonly ProjectTaskProvider[] = [
  nodeProvider,
  pdmProvider,
  pipenvProvider,
  hatchProvider,
  toxProvider,
  noxProvider,
  mavenProvider,
  gradleProvider,
];

export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

/** Size-limited, and it never follows a symlink. */
export function nodeTaskFs(limit = MAX_MANIFEST_BYTES): TaskFs {
  return {
    exists: (filePath) => {
      try {
        return fs.existsSync(filePath);
      } catch {
        return false;
      }
    },
    read: (filePath) => {
      try {
        // `lstat`, so a symlink is judged as a link rather than its target.
        const stats = fs.lstatSync(filePath);
        if (!stats.isFile() || stats.size > limit) return null;
        return fs.readFileSync(filePath, 'utf8');
      } catch {
        return null;
      }
    },
    resolve: (...segments) => path.resolve(...segments),
    join: (...segments) => path.join(...segments),
    dirname: (filePath) => path.dirname(filePath),
    basename: (filePath) => path.basename(filePath),
  };
}

export interface TaskDiscoveryOptions {
  fs?: TaskFs;
  platform?: TaskPlatform;
  providers?: readonly ProjectTaskProvider[];
}

export interface TaskDiscoveryResult {
  tasks: DiscoveredTask[];
  matches: ProviderMatch[];
  diagnostics: TaskDiagnostic[];
  watchedFiles: string[];
}

function contextFor(
  directory: string,
  options: TaskDiscoveryOptions,
  diagnostics: TaskDiagnostic[],
): ProjectDetectionContext {
  const port = options.fs ?? nodeTaskFs();
  return {
    directory: port.resolve(directory),
    fs: port,
    platform: options.platform ?? (process.platform === 'win32' ? 'win32' : 'posix'),
    report: (diagnostic) => {
      // The same complaint about the same file is only worth saying once.
      const duplicate = diagnostics.some(
        (existing) =>
          existing.providerId === diagnostic.providerId &&
          existing.file === diagnostic.file &&
          existing.message === diagnostic.message,
      );
      if (!duplicate) diagnostics.push(diagnostic);
    },
  };
}

/**
 * Every task every provider can prove for this directory.
 *
 * A provider that throws is reported and skipped: one malformed manifest must
 * never cost the project the tasks the other providers found.
 */
export function discoverTasks(
  directory: string,
  options: TaskDiscoveryOptions = {},
): TaskDiscoveryResult {
  const diagnostics: TaskDiagnostic[] = [];
  const context = contextFor(directory, options, diagnostics);
  const providers = options.providers ?? PROVIDERS;

  const tasks: DiscoveredTask[] = [];
  const matches: ProviderMatch[] = [];
  const watched = new Set<string>();

  for (const provider of providers) {
    let match: ProviderMatch | null = null;
    try {
      match = provider.detect(context);
    } catch (error) {
      context.report({
        providerId: provider.id,
        file: context.directory,
        message: `detection failed: ${(error as Error).message}`,
      });
      continue;
    }
    if (!match) continue;
    matches.push(match);

    try {
      for (const file of provider.watchedFiles(match, context)) watched.add(file);
      tasks.push(...provider.discover(match, context));
    } catch (error) {
      context.report({
        providerId: provider.id,
        file: match.sourceFiles[0] ?? context.directory,
        message: `read failed: ${(error as Error).message}`,
      });
    }
  }

  return { tasks, matches, diagnostics, watchedFiles: [...watched] };
}
