import { EventEmitter } from 'node:events';
import * as path from 'node:path';

import { buttonId } from '../core/button-id';
import {
  appendButton,
  removeButtonById,
  reorderButtons,
  writeButtonsFile,
  isCustomAmong,
} from '../core/buttons-config';
import { normalizeProjectPath } from '../core/paths';
import { ProjectError, type ProjectInfo } from '../core/project';
import { loadProjectButtons, toButtonViews } from '../core/project-service';
import type { ProjectRegistry } from '../core/registry';
import { PRODUCT_NAME } from '../shared/branding';
import type {
  ActionResult,
  AppState,
  ButtonConfig,
  LayoutLimits,
  PendingAuthorization,
  ThemeName,
} from '../shared/types';
import {
  ABSOLUTE_MAX_HEIGHT,
  ABSOLUTE_MAX_WIDTH,
  DEFAULT_PANEL_HEIGHT,
} from './window-geometry';
import type { PtyManager } from './pty-manager';

/** Injected, so the widget state stays independent of Electron. */
export interface WidgetPresentation {
  theme(): ThemeName;
  layout(): LayoutLimits;
}

const DEFAULT_PRESENTATION: WidgetPresentation = {
  theme: () => 'dark',
  layout: () => ({
    sizeMode: 'auto',
    maxWidth: ABSOLUTE_MAX_WIDTH,
    maxHeight: ABSOLUTE_MAX_HEIGHT,
    panelHeight: DEFAULT_PANEL_HEIGHT,
  }),
};

export interface ActivationOutcome {
  activated: boolean;
  /** The folder has a config but was never authorized. */
  needsAuthorization: boolean;
  /** Nothing to do (unknown folder, unreadable project). */
  ignored: boolean;
}

export class WidgetState extends EventEmitter {
  private project: ProjectInfo | null = null;
  private buttons: ButtonConfig[] = [];
  private pending: PendingAuthorization | null = null;
  private notice: string | null = null;
  private configPresent = false;

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly pty: PtyManager,
    private readonly presentation: WidgetPresentation = DEFAULT_PRESENTATION,
  ) {
    super();
  }

  getState(): AppState {
    const project = this.project;
    return {
      productName: PRODUCT_NAME,
      project: project
        ? { path: project.path, name: project.name, packageManager: project.packageManager }
        : null,
      pending: this.pending,
      buttons: project
        ? toButtonViews(this.buttons, project, (id) => this.pty.snapshot(this.sessionKey(id)))
        : [],
      notice: this.notice,
      // Never persisted with the project: the theme is a per-user preference
      // and the limits come from the VS Code window.
      theme: this.presentation.theme(),
      layout: this.presentation.layout(),
    };
  }

  /** Composite PTY key so two projects never share a session. */
  sessionKey(id: string): string {
    return `${normalizeProjectPath(this.project?.path ?? '')}|${id}`;
  }

  findButton(id: unknown): ButtonConfig | null {
    if (typeof id !== 'string' || id.length === 0) return null;
    return this.buttons.find((button) => buttonId(button) === id) ?? null;
  }

  get activeProject(): ProjectInfo | null {
    return this.project;
  }

  get activeProjectKey(): string | null {
    return this.project ? normalizeProjectPath(this.project.path) : null;
  }

  get hasProjectConfig(): boolean {
    return this.configPresent;
  }

  get hasPendingAuthorization(): boolean {
    return this.pending !== null;
  }

  /** Only authorized projects become active without asking. */
  activate(cwd: string): ActivationOutcome {
    const target = path.resolve(cwd);

    if (this.registry.isAuthorized(target)) {
      if (!this.load(target)) return { activated: false, needsAuthorization: false, ignored: true };
      this.pending = null;
      this.emitChange();
      return { activated: true, needsAuthorization: false, ignored: false };
    }

    return { activated: false, needsAuthorization: false, ignored: true };
  }

  /**
   * Ask the user about a project that already carries a config nobody
   * authorized here. Nothing is written or run until they answer, and the
   * answer is given in the widget — never in a terminal.
   */
  requestAuthorization(pending: PendingAuthorization): void {
    this.pending = pending;
    this.notice = null;
    this.emitChange();
  }

  /** Answer the "this project is not authorized yet" prompt. */
  resolvePending(accept: boolean): ActionResult {
    const pending = this.pending;
    if (!pending) return { ok: false, error: 'Nenhuma autorização pendente.' };
    this.pending = null;

    if (!accept) {
      this.emitChange();
      return { ok: true };
    }

    try {
      const { project } = loadProjectButtons(pending.path);
      this.registry.authorize(project.path, project.name);
    } catch (error) {
      this.notice = describeError(error);
      this.emitChange();
      return { ok: false, error: this.notice };
    }

    this.load(pending.path);
    this.emitChange();
    return { ok: true };
  }

  /** Re-read the active project from disk (config file changed on disk). */
  reload(): void {
    if (!this.project) return;
    this.load(this.project.path);
    this.emitChange();
  }

  addButton(rawName: unknown, rawScript: unknown): ActionResult {
    if (!this.project) return { ok: false, error: 'Nenhum projeto ativo.' };
    const result = appendButton(this.buttons, rawName, rawScript);
    if (!result.ok) return { ok: false, error: result.error };

    try {
      writeButtonsFile(this.project.path, { buttons: result.value });
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
    this.buttons = result.value;
    this.notice = null;
    this.emitChange();
    return { ok: true };
  }

  /**
   * Persist a new order for the buttons of the active project.
   *
   * One write, at the end of the gesture. Only the order of the array changes:
   * every button keeps its name, command and identity, so sessions already
   * running are untouched.
   */
  reorderButtons(rawIds: unknown): ActionResult {
    if (!this.project) return { ok: false, error: 'Nenhum projeto ativo.' };
    if (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== 'string')) {
      return { ok: false, error: 'Ordem inválida.' };
    }

    const next = reorderButtons(this.buttons, rawIds as string[]);
    if (!next) return { ok: false, error: 'Ordem inválida.' };
    if (next.every((button, index) => button === this.buttons[index])) return { ok: true };

    try {
      writeButtonsFile(this.project.path, { buttons: next });
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
    this.buttons = next;
    this.notice = null;
    this.emitChange();
    return { ok: true };
  }

  deleteButton(id: unknown): ActionResult {
    if (!this.project) return { ok: false, error: 'Nenhum projeto ativo.' };
    const button = this.findButton(id);
    if (!button) return { ok: false, error: 'Botão não encontrado.' };
    if (!isCustomAmong(button, this.project.tasks)) {
      return { ok: false, error: 'Somente botões personalizados podem ser excluídos.' };
    }

    const next = removeButtonById(this.buttons, buttonId(button));
    if (!next) return { ok: false, error: 'Botão não encontrado.' };

    try {
      writeButtonsFile(this.project.path, { buttons: next });
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
    this.buttons = next;
    this.emitChange();
    return { ok: true };
  }

  emitChange(): void {
    this.emit('change', this.getState());
  }

  private load(projectPath: string): boolean {
    try {
      const loaded = loadProjectButtons(projectPath);
      this.project = loaded.project;
      this.buttons = loaded.buttons;
      this.configPresent = !loaded.missingConfig;
      this.notice = loaded.missingConfig
        ? 'Projeto sem .dev-island/buttons.json. Rode "dev-island init".'
        : null;
      return true;
    } catch (error) {
      this.notice = describeError(error);
      this.configPresent = false;
      return false;
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof ProjectError) return error.message;
  return (error as Error)?.message ?? 'Erro desconhecido.';
}
