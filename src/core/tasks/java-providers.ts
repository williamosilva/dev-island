/**
 * Maven and Gradle.
 *
 * Neither tool lists its tasks in a file the way npm does: Maven has lifecycle
 * phases and Gradle builds its task graph by running the build script. So the
 * safe subset is what can be proved from the text — the usual phases for
 * Maven, and the tasks that follow from a plugin applied in plain sight for
 * Gradle. Nothing here runs `mvn`, `gradle` or a wrapper; a wrapper may well
 * download a distribution, and that must happen visibly, after a click.
 *
 * Destructive or outward-facing goals (`clean`, `install`, `deploy`,
 * `publish`, `release`) are deliberately left out: a button is one click away,
 * and none of those should be.
 */

import { childNamed, childrenNamed, childText, parseXml, type XmlElement } from './xml-lite';
import { scanGradlePlugins } from './gradle-scan';
import type { DiscoveredTask, ProjectDetectionContext, ProjectTaskProvider } from './types';

/** The wrapper if the project ships one, otherwise the tool on the PATH. */
export function runnerFor(
  context: ProjectDetectionContext,
  root: string,
  wrappers: { win32: string; posix: string },
  fallback: string,
): string {
  if (context.platform === 'win32') {
    return context.fs.exists(context.fs.join(root, wrappers.win32))
      ? `.\\${wrappers.win32}`
      : fallback;
  }
  return context.fs.exists(context.fs.join(root, wrappers.posix)) ? `./${wrappers.posix}` : fallback;
}

/** Phases that only build and verify. Nothing that deletes or publishes. */
const MAVEN_PHASES = ['compile', 'test', 'package', 'verify'] as const;

const SPRING_BOOT_PLUGIN = 'spring-boot-maven-plugin';

function readPom(file: string, context: ProjectDetectionContext): XmlElement | null {
  const text = context.fs.read(file);
  if (text === null) return null;
  const parsed = parseXml(text);
  if (parsed === null) {
    // A malformed pom (or one carrying a doctype) yields no tasks; the buttons
    // already on disk are left exactly as they are.
    context.report({ providerId: 'java-maven', file, message: 'invalid or unsupported XML' });
    return null;
  }
  return parsed.name === 'project' ? parsed : null;
}

/** True when the plugin is really applied, not merely managed. */
export function hasAppliedPlugin(project: XmlElement, artifactId: string): boolean {
  const inBuild = childNamed(project, 'build');
  if (!inBuild) return false;
  // `pluginManagement` only configures a version for elsewhere: it applies
  // nothing on its own, so it is not enough to offer a Run button.
  const plugins = childNamed(inBuild, 'plugins');
  if (!plugins) return false;
  return childrenNamed(plugins, 'plugin').some(
    (plugin) => childText(plugin, 'artifactId') === artifactId,
  );
}

export const mavenProvider: ProjectTaskProvider = {
  id: 'java-maven',
  label: 'Maven',

  detect(context) {
    const file = context.fs.join(context.directory, 'pom.xml');
    if (!context.fs.exists(file)) return null;
    return { providerId: 'java-maven', projectRoot: context.directory, sourceFiles: [file] };
  },

  discover(match, context) {
    const file = match.sourceFiles[0]!;
    const project = readPom(file, context);
    if (!project) return [];

    const runner = runnerFor(context, match.projectRoot, { win32: 'mvnw.cmd', posix: 'mvnw' }, 'mvn');
    const tasks: DiscoveredTask[] = MAVEN_PHASES.map((phase) => ({
      providerId: 'java-maven' as const,
      name: phase.charAt(0).toUpperCase() + phase.slice(1),
      command: `${runner} ${phase}`,
      sourceFile: file,
    }));

    // A local parent may be where the plugin is applied. Only followed inside
    // the project root, and never fetched from a repository.
    let carrier: XmlElement | null = project;
    const visited = new Set<string>([file]);
    while (carrier && !hasAppliedPlugin(carrier, SPRING_BOOT_PLUGIN)) {
      const parentFile = localParentPom(carrier, file, match.projectRoot, context, visited);
      carrier = parentFile ? readPom(parentFile, context) : null;
    }
    if (carrier) {
      tasks.push({
        providerId: 'java-maven',
        name: 'Spring Boot: Run',
        command: `${runner} spring-boot:run`,
        sourceFile: file,
      });
    }
    return tasks;
  },

  watchedFiles(match, context) {
    return [
      ...match.sourceFiles,
      context.fs.join(match.projectRoot, 'mvnw'),
      context.fs.join(match.projectRoot, 'mvnw.cmd'),
    ];
  },
};

/** The parent pom, if it is a real file inside the authorised root. */
function localParentPom(
  project: XmlElement,
  childFile: string,
  root: string,
  context: ProjectDetectionContext,
  visited: Set<string>,
): string | null {
  const parent = childNamed(project, 'parent');
  if (!parent) return null;
  const relative = childText(parent, 'relativePath') ?? '../pom.xml';
  if (relative.length === 0) return null;

  const candidate = context.fs.resolve(context.fs.dirname(childFile), relative);
  const target = context.fs.basename(candidate).toLowerCase().endsWith('.xml')
    ? candidate
    : context.fs.join(candidate, 'pom.xml');
  // Staying inside the authorised root is the whole point: a `relativePath`
  // pointing outside it is ignored rather than followed.
  if (!isInside(target, root, context)) return null;
  if (visited.has(target) || !context.fs.exists(target)) return null;
  visited.add(target);
  return target;
}

function isInside(candidate: string, root: string, context: ProjectDetectionContext): boolean {
  const normalise = (value: string): string =>
    context.platform === 'win32'
      ? context.fs.resolve(value).toLowerCase().replace(/\\/g, '/')
      : context.fs.resolve(value);
  const inside = normalise(candidate);
  const base = normalise(root);
  return inside === base || inside.startsWith(`${base}/`);
}

const GRADLE_BUILD_FILES = ['build.gradle', 'build.gradle.kts'] as const;
export const GRADLE_SETTINGS_FILES = ['settings.gradle', 'settings.gradle.kts'] as const;

export const gradleProvider: ProjectTaskProvider = {
  id: 'java-gradle',
  label: 'Gradle',

  detect(context) {
    const files = [...GRADLE_SETTINGS_FILES, ...GRADLE_BUILD_FILES]
      .map((name) => context.fs.join(context.directory, name))
      .filter((file) => context.fs.exists(file));
    if (files.length === 0) return null;
    return { providerId: 'java-gradle', projectRoot: context.directory, sourceFiles: files };
  },

  discover(match, context) {
    const runner = runnerFor(
      context,
      match.projectRoot,
      { win32: 'gradlew.bat', posix: 'gradlew' },
      'gradle',
    );

    const plugins = new Set<string>();
    for (const file of match.sourceFiles) {
      if (!GRADLE_BUILD_FILES.some((name) => context.fs.basename(file) === name)) continue;
      const text = context.fs.read(file);
      if (text === null) continue;
      const scan = scanGradlePlugins(text);
      for (const plugin of scan.plugins) plugins.add(plugin);
      for (const unproven of scan.unproven) {
        context.report({
          providerId: 'java-gradle',
          file,
          message: `unproven plugin, ignored: ${unproven}`,
        });
      }
    }

    const source =
      match.sourceFiles.find((file) =>
        GRADLE_BUILD_FILES.some((name) => context.fs.basename(file) === name),
      ) ?? match.sourceFiles[0]!;

    const tasks: DiscoveredTask[] = [];
    const add = (name: string, task: string): void => {
      tasks.push({ providerId: 'java-gradle', name, command: `${runner} ${task}`, sourceFile: source });
    };

    if (plugins.has('java') || plugins.has('application') || plugins.has('spring-boot')) {
      add('Build', 'build');
      add('Test', 'test');
      add('Check', 'check');
    }
    if (plugins.has('application')) add('Run', 'run');
    if (plugins.has('spring-boot')) add('Spring Boot: Run', 'bootRun');
    return tasks;
  },

  watchedFiles(match, context) {
    return [
      ...match.sourceFiles,
      context.fs.join(match.projectRoot, 'gradlew'),
      context.fs.join(match.projectRoot, 'gradlew.bat'),
    ];
  },
};
