/**
 * Decides whether the widget may be on screen.
 *
 * No Electron and no OS call: everything platform specific arrives through
 * {@link ForegroundWindow} and {@link WidgetWindowPort}, which is what keeps
 * the rules unit testable.
 */

export const VS_CODE_PROCESS_NAMES: readonly string[] = ['code.exe'];

export interface ForegroundWindow {
  pid: number;
  /** Hex string: a 64-bit HWND does not survive a JS number. */
  windowHandle: string;
  /** Lower case, as the comparisons assume. */
  processName: string;
  title: string;
  minimized: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Anchor = Pick<ForegroundWindow, 'x' | 'y' | 'width' | 'height'>;

export type VisibilityReason =
  | 'fechado-pelo-usuario'
  | 'sem-projeto-ativo'
  | 'sem-configuracao'
  | 'sem-terminal-ativo'
  | 'preview'
  | 'sem-janela-em-primeiro-plano'
  | 'janela-minimizada'
  | 'vscode-em-primeiro-plano'
  | 'janela-sem-projeto'
  | 'interacao-no-widget'
  | 'widget-sem-contexto-vscode'
  | 'outro-aplicativo-em-primeiro-plano';

export interface VisibilityDecision {
  visible: boolean;
  reason: VisibilityReason;
  /** Null keeps the current position. */
  anchor: Anchor | null;
}

export interface DecisionInput {
  foreground: ForegroundWindow | null;
  /** So the widget's own windows can be told apart from everyone else's. */
  ownPid: number;
  lastExternalWasVsCode: boolean;
  hasActiveProject: boolean;
  hasProjectConfig: boolean;
  hasLiveTerminal: boolean;
  hasPendingAuthorization: boolean;
  preview: boolean;
  /** Set by "Fechar"; cleared when a terminal reports a project. */
  dismissed: boolean;
  /** False for a VS Code window nobody reported a project from. */
  foregroundHasProject: boolean;
}

export function isVsCodeProcess(processName: string): boolean {
  return VS_CODE_PROCESS_NAMES.includes(processName.trim().toLowerCase());
}

/**
 * Only a VS Code window qualifies. Anchoring on our own rectangle would shrink
 * the capsule a little on every watcher tick until nothing fit.
 */
export function anchorFromForeground(foreground: ForegroundWindow | null): Anchor | null {
  if (!foreground || !isVsCodeProcess(foreground.processName)) return null;
  return {
    x: foreground.x,
    y: foreground.y,
    width: foreground.width,
    height: foreground.height,
  };
}

function hidden(reason: VisibilityReason): VisibilityDecision {
  return { visible: false, reason, anchor: null };
}

function shown(reason: VisibilityReason, anchor: Anchor | null): VisibilityDecision {
  return { visible: true, reason, anchor };
}

export function decideVisibility(input: DecisionInput): VisibilityDecision {
  if (input.dismissed) return hidden('fechado-pelo-usuario');

  if (!input.hasPendingAuthorization) {
    if (!input.hasActiveProject) return hidden('sem-projeto-ativo');
    if (!input.hasProjectConfig) return hidden('sem-configuracao');
    if (!input.hasLiveTerminal) return hidden('sem-terminal-ativo');
  }

  if (input.preview) return shown('preview', null);

  const foreground = input.foreground;
  if (!foreground) return hidden('sem-janela-em-primeiro-plano');
  if (foreground.minimized) return hidden('janela-minimizada');

  if (isVsCodeProcess(foreground.processName)) {
    // Better to show nothing than the commands of another window's project.
    if (!input.foregroundHasProject) return hidden('janela-sem-projeto');
    return shown('vscode-em-primeiro-plano', {
      x: foreground.x,
      y: foreground.y,
      width: foreground.width,
      height: foreground.height,
    });
  }

  if (foreground.pid === input.ownPid) {
    // Keep the widget visible while it has focus from VS Code.
    return input.lastExternalWasVsCode && input.foregroundHasProject
      ? shown('interacao-no-widget', null)
      : hidden('widget-sem-contexto-vscode');
  }

  return hidden('outro-aplicativo-em-primeiro-plano');
}

/** All the controller may do to the window. */
export interface WidgetWindowPort {
  isDestroyed(): boolean;
  isVisible(): boolean;
  /** Must never steal focus from the editor. */
  showInactive(): void;
  hide(): void;
  setAlwaysOnTop(flag: boolean): void;
  positionOver(anchor: Anchor | null): void;
}

export interface VisibilityContext {
  hasActiveProject(): boolean;
  hasProjectConfig(): boolean;
  hasLiveTerminal(): boolean;
  hasPendingAuthorization(): boolean;
  preview(): boolean;
  dismissed(): boolean;
}

function anchorsEqual(a: Anchor | null, b: Anchor | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Applies {@link decideVisibility} to a window.
 *
 * No reference to the PTY manager or the project state, so hiding the widget
 * cannot stop a process or lose a log.
 */
export class VisibilityController {
  private foreground: ForegroundWindow | null = null;
  private lastExternalWasVsCode = false;
  private lastExternalHadProject = false;
  private appliedAnchor: Anchor | null = null;
  private foregroundHasProject = true;
  private alwaysOnTop = false;
  private current: VisibilityDecision = { visible: false, reason: 'sem-projeto-ativo', anchor: null };

  constructor(
    private readonly window: WidgetWindowPort,
    private readonly context: VisibilityContext,
    private readonly ownPid: number = process.pid,
  ) {}

  get decision(): VisibilityDecision {
    return this.current;
  }

  handleForeground(
    foreground: ForegroundWindow | null,
    foregroundHasProject = true,
  ): VisibilityDecision {
    this.foreground = foreground;
    if (foreground && foreground.pid !== this.ownPid) {
      this.lastExternalWasVsCode = isVsCodeProcess(foreground.processName);
      this.lastExternalHadProject = foregroundHasProject;
    }
    this.foregroundHasProject = foregroundHasProject;
    return this.refresh();
  }

  refresh(): VisibilityDecision {
    const decision = decideVisibility({
      foreground: this.foreground,
      ownPid: this.ownPid,
      lastExternalWasVsCode: this.lastExternalWasVsCode,
      hasActiveProject: this.context.hasActiveProject(),
      hasProjectConfig: this.context.hasProjectConfig(),
      hasLiveTerminal: this.context.hasLiveTerminal(),
      hasPendingAuthorization: this.context.hasPendingAuthorization(),
      preview: this.context.preview(),
      dismissed: this.context.dismissed(),
      // While the capsule has focus, keep the context it came from.
      foregroundHasProject:
        this.foreground !== null && this.foreground.pid === this.ownPid
          ? this.lastExternalHadProject
          : this.foregroundHasProject,
    });
    this.current = decision;
    this.apply(decision);
    return decision;
  }

  private apply(decision: VisibilityDecision): void {
    if (this.window.isDestroyed()) return;

    if (!decision.visible) {
      if (this.window.isVisible()) this.window.hide();
      if (this.alwaysOnTop) {
        // On top only while the VS Code context holds.
        this.window.setAlwaysOnTop(false);
        this.alwaysOnTop = false;
      }
      // `appliedAnchor` is kept on purpose: showing again must not re-run the
      // default placement over where the user dragged it.
      return;
    }

    // Only on a real anchor change, so a dragged widget is not yanked back.
    if (decision.anchor && !anchorsEqual(decision.anchor, this.appliedAnchor)) {
      this.window.positionOver(decision.anchor);
      this.appliedAnchor = decision.anchor;
    }

    if (!this.alwaysOnTop) {
      this.window.setAlwaysOnTop(true);
      this.alwaysOnTop = true;
    }
    if (!this.window.isVisible()) this.window.showInactive();
  }
}
