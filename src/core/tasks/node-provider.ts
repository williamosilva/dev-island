/**
 * Node, expressed as a provider.
 *
 * The scripts of `package.json`, in declaration order, run through whichever
 * package manager the project resolves to. The manifest is read through the
 * injected port, so discovery works without a disk.
 */

import type { PackageManager } from '../../shared/types';
import { buildScriptCommand, detectPackageManagerFrom } from '../package-manager';
import { readScripts, type PackageJson } from '../project';
import { displayName } from './task-name';
import type { ProjectDetectionContext, ProjectTaskProvider, ProviderMatch } from './types';

/** Lock files and the `packageManager` field, both read through the port. */
function packageManagerAt(
  context: ProjectDetectionContext,
  root: string,
  field: unknown,
): PackageManager {
  return detectPackageManagerFrom({
    packageManagerField: typeof field === 'string' ? field : null,
    hasFile: (fileName) => context.fs.exists(context.fs.join(root, fileName)),
  });
}

function readManifest(file: string, context: ProjectDetectionContext): PackageJson | null {
  const text = context.fs.read(file);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    context.report({
      providerId: 'node-package-json',
      file,
      message: `JSON inválido: ${(error as Error).message}`,
    });
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as PackageJson;
}

export const nodeProvider: ProjectTaskProvider = {
  id: 'node-package-json',
  label: 'Node',

  detect(context) {
    const file = context.fs.join(context.directory, 'package.json');
    if (!context.fs.exists(file)) return null;
    return { providerId: 'node-package-json', projectRoot: context.directory, sourceFiles: [file] };
  },

  discover(match: ProviderMatch, context) {
    const file = match.sourceFiles[0]!;
    const manifest = readManifest(file, context);
    if (!manifest) return [];
    const manager = packageManagerAt(context, match.projectRoot, manifest.packageManager);
    return readScripts(manifest).map((script) => ({
      providerId: 'node-package-json' as const,
      name: displayName(script),
      command: buildScriptCommand(manager, script),
      sourceFile: file,
    }));
  },

  watchedFiles(match) {
    return [...match.sourceFiles];
  },
};
