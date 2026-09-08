/**
 * What `init` should do once the project files are written.
 *
 * Kept separate from the command itself so the decision (and the exact wording
 * the user sees) can be unit tested without touching the filesystem, the
 * registry or Electron.
 */
export interface InitPlanInput {
  /** Proven by VS Code's own environment variables, never guessed. */
  insideVsCode: boolean;
  preview: boolean;
  noStart: boolean;
}

export interface InitPlan {
  /**
   * Report this project to the background process. False for a plain external
   * terminal: standing in a folder is not the same as having it open in VS Code.
   */
  activateProject: boolean;
  preview: boolean;
  /** Extra argv when the app has to be started from scratch. */
  launchArgs: string[];
  messages: string[];
}

const INITIALIZED = 'projeto inicializado';
const STARTED = 'widget iniciado em segundo plano';

export function planInit(input: InitPlanInput): InitPlan {
  const activateProject = input.preview || input.insideVsCode;
  const launchArgs = input.preview ? ['--preview'] : [];

  if (input.noStart) {
    return {
      activateProject,
      preview: input.preview,
      launchArgs,
      messages: [INITIALIZED, 'widget não iniciado (--no-start)'],
    };
  }

  if (input.preview) {
    return {
      activateProject,
      preview: true,
      launchArgs,
      messages: [INITIALIZED, STARTED, 'modo --preview: o widget aparece mesmo fora do VS Code'],
    };
  }

  if (input.insideVsCode) {
    return {
      activateProject,
      preview: false,
      launchArgs,
      messages: [INITIALIZED, STARTED, 'projeto ativado pelo terminal integrado do VS Code'],
    };
  }

  return {
    activateProject: false,
    preview: false,
    launchArgs,
    messages: [
      INITIALIZED,
      STARTED,
      'o widget aparecerá quando o projeto for detectado no terminal integrado do VS Code',
    ],
  };
}
