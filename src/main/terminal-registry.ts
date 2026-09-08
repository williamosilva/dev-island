/** Injected so tests can decide which PIDs are alive. */
export interface ProcessProbe {
  isAlive(pid: number): boolean;
}

export const defaultProcessProbe: ProcessProbe = {
  isAlive(pid) {
    try {
      // Signal 0 only checks for existence; it never touches the process.
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // The process exists but belongs to another user/session.
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
};

interface Entry {
  pids: Set<number>;
  /**
   * Whether a PID was ever recorded for this project. Without it, pruning the
   * last dead PID would turn "every terminal is gone" back into "we never
   * knew", and the widget would stay on screen forever.
   */
  everTracked: boolean;
}

/**
 * Which shell processes told us about each project.
 *
 * When every terminal that announced a project is gone, there is nothing left
 * to show the widget for. A project that never reported a PID (an older hook,
 * or `--preview`) is treated as still valid, because absence of information is
 * not evidence that the terminal died.
 */
export class TerminalRegistry {
  private readonly terminals = new Map<string, Entry>();

  constructor(private readonly probe: ProcessProbe = defaultProcessProbe) {}

  /** A null pid records the project without any liveness tracking. */
  record(projectKey: string, pid: number | null): void {
    const entry = this.terminals.get(projectKey) ?? { pids: new Set<number>(), everTracked: false };
    if (pid !== null) {
      entry.pids.add(pid);
      entry.everTracked = true;
    }
    this.terminals.set(projectKey, entry);
  }

  liveTerminals(projectKey: string): number[] {
    const entry = this.terminals.get(projectKey);
    if (!entry) return [];
    return [...entry.pids].filter((pid) => this.probe.isAlive(pid));
  }

  hasLiveTerminal(projectKey: string): boolean {
    const entry = this.terminals.get(projectKey);
    if (!entry || !entry.everTracked) return true;
    return [...entry.pids].some((pid) => this.probe.isAlive(pid));
  }

  /** Drop PIDs that no longer exist. Called on a slow timer. */
  prune(): void {
    for (const entry of this.terminals.values()) {
      for (const pid of [...entry.pids]) {
        if (!this.probe.isAlive(pid)) entry.pids.delete(pid);
      }
    }
  }

  forget(projectKey: string): void {
    this.terminals.delete(projectKey);
  }

  get trackedProjects(): string[] {
    return [...this.terminals.keys()];
  }
}
