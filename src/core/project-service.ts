import type { ButtonConfig, ButtonView, ProcessStatus } from '../shared/types';
import { buttonId } from './button-id';
import {
  isCustomAmong,
  mergeDiscoveredTasks,
  readButtonsFile,
  writeButtonsFile,
  buttonsFileExists,
} from './buttons-config';
import { loadProject, type ProjectInfo } from './project';

export interface InitializeResult {
  project: ProjectInfo;
  buttons: ButtonConfig[];
  added: ButtonConfig[];
  /** The file did not exist before this run. */
  created: boolean;
  written: boolean;
}

/**
 * Read the project, merge its package.json scripts into the existing config
 * and persist the result. Custom buttons and ordering survive untouched.
 */
export function initializeProject(projectPath: string): InitializeResult {
  const project = loadProject(projectPath);
  const existed = buttonsFileExists(project.path);
  const existing = readButtonsFile(project.path);
  const { buttons, added } = mergeDiscoveredTasks(existing?.buttons ?? null, project.tasks);

  const written = !existed || added.length > 0;
  if (written) writeButtonsFile(project.path, { buttons });

  return { project, buttons, added, created: !existed, written };
}

export interface LoadedProject {
  project: ProjectInfo;
  buttons: ButtonConfig[];
  missingConfig: boolean;
}

/**
 * Read-only load used by the running app. It never writes: the widget must not
 * mutate a project just because a terminal walked into it.
 */
export function loadProjectButtons(projectPath: string): LoadedProject {
  const project = loadProject(projectPath);
  const file = readButtonsFile(project.path);
  return { project, buttons: file?.buttons ?? [], missingConfig: file === null };
}

/** Decorate persisted buttons with the runtime-only fields the UI needs. */
export function toButtonViews(
  buttons: readonly ButtonConfig[],
  project: Pick<ProjectInfo, 'tasks'>,
  statusOf: (id: string) => { status: ProcessStatus; exitCode: number | null },
): ButtonView[] {
  return buttons.map((button) => {
    const id = buttonId(button);
    const { status, exitCode } = statusOf(id);
    return {
      name: button.name,
      script: button.script,
      id,
      custom: isCustomAmong(button, project.tasks),
      status,
      exitCode,
    };
  });
}
