import { normalizeWindowHandle } from './foreground-watcher';
import { defaultProcessProbe, type ProcessProbe } from './terminal-registry';

export interface TerminalSession {
  /** VS Code window the terminal belongs to. */
  windowHandle: string;
  /** Project root exactly as the terminal reported it. */
  projectPath: string;
  /** PowerShell PID, or null when the reporter did not send one. */
  shellPid: number | null;
  reportedAt: number;
}

/**
 * Which project belongs to which VS Code window.
 *
 * Knowing that `Code.exe` is in front is not enough once two VS Code windows
 * are open, so every terminal report is filed under the handle of the window
 * that was in the foreground when it happened. Looking a window up gives the
 * project of *that* window; a window nobody reported from gives null, and the
 * widget stays hidden rather than showing another window's commands.
 *
 * Handles die with their windows, so this map is memory only and never
 * persisted.
 */
export class WindowProjectRegistry {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly probe: ProcessProbe = defaultProcessProbe,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private static key(windowHandle: string, shellPid: number | null): string {
    return `${windowHandle}|${shellPid ?? 'anonimo'}`;
  }

  private isAlive(session: TerminalSession): boolean {
    return session.shellPid === null || this.probe.isAlive(session.shellPid);
  }

  /** File a report from one terminal of one VS Code window. */
  record(windowHandle: string, projectPath: string, shellPid: number | null): void {
    const handle = normalizeWindowHandle(windowHandle);
    this.sessions.set(WindowProjectRegistry.key(handle, shellPid), {
      windowHandle: handle,
      projectPath,
      shellPid,
      reportedAt: this.now(),
    });
  }

  /** Live sessions of a window, most recently reported first. */
  sessionsFor(windowHandle: string): TerminalSession[] {
    const handle = normalizeWindowHandle(windowHandle);
    return [...this.sessions.values()]
      .filter((session) => session.windowHandle === handle && this.isAlive(session))
      .sort((a, b) => b.reportedAt - a.reportedAt);
  }

  /**
   * Project of a VS Code window: the one its most recent live terminal
   * reported. When that terminal dies another live session of the same window
   * takes over; when none is left the window has no project again.
   */
  projectFor(windowHandle: string | null | undefined): string | null {
    if (!windowHandle) return null;
    return this.sessionsFor(windowHandle)[0]?.projectPath ?? null;
  }

  /** Forget sessions whose shell is gone. Called on a slow timer. */
  prune(): void {
    for (const [key, session] of this.sessions) {
      if (!this.isAlive(session)) this.sessions.delete(key);
    }
  }

  forgetWindow(windowHandle: string): void {
    const handle = normalizeWindowHandle(windowHandle);
    for (const [key, session] of this.sessions) {
      if (session.windowHandle === handle) this.sessions.delete(key);
    }
  }

  get windowHandles(): string[] {
    return [...new Set([...this.sessions.values()].map((session) => session.windowHandle))];
  }

  get size(): number {
    return this.sessions.size;
  }
}
