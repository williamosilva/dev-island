import { EventEmitter } from 'node:events';

import type * as NodePty from 'node-pty';
import type { IPty } from 'node-pty';

import { resolveShellAdapter } from '../core/shell-adapter';
import type { ProcessStatus } from '../shared/types';

/** Scrollback kept in memory per button while the app is open. */
const MAX_BUFFER_BYTES = 512 * 1024;

export interface StartOptions {
  /** Composite key: project + button. */
  key: string;
  /** The exact command shown on the button. */
  script: string;
  /** Always the project root. */
  cwd: string;
  cols?: number;
  rows?: number;
}

interface Session {
  key: string;
  script: string;
  cwd: string;
  proc: IPty | null;
  status: ProcessStatus;
  exitCode: number | null;
  /** True between a Parar/Reiniciar click and the actual exit. */
  stopping: boolean;
  chunks: string[];
  bytes: number;
  cols: number;
  rows: number;
}

/**
 * One PTY per button.
 *
 * Nothing here ever starts on its own: `start` is only reachable from an
 * explicit click in the widget. Output survives navigation inside the widget
 * because the buffer lives here, not in the renderer.
 */
export class PtyManager extends EventEmitter {
  private readonly sessions = new Map<string, Session>();

  /** Lazily required so unit tests can import this module without the native binding. */
  private ptyModule: typeof NodePty | null = null;

  private loadPty(): typeof NodePty {
    if (!this.ptyModule) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.ptyModule = require('node-pty') as typeof NodePty;
    }
    return this.ptyModule;
  }

  isRunning(key: string): boolean {
    return this.sessions.get(key)?.status === 'running';
  }

  snapshot(key: string): { status: ProcessStatus; exitCode: number | null } {
    const session = this.sessions.get(key);
    if (!session) return { status: 'idle', exitCode: null };
    return { status: session.status, exitCode: session.exitCode };
  }

  buffer(key: string): string {
    return this.sessions.get(key)?.chunks.join('') ?? '';
  }

  /** Start the command, unless it is already running. Returns false if it was. */
  start(options: StartOptions): boolean {
    const existing = this.sessions.get(options.key);
    if (existing?.status === 'running') return false;

    const adapter = resolveShellAdapter();
    const spec = adapter.buildCommand(options.script);
    const cols = options.cols ?? existing?.cols ?? 100;
    const rows = options.rows ?? existing?.rows ?? 24;

    const session: Session = existing ?? {
      key: options.key,
      script: options.script,
      cwd: options.cwd,
      proc: null,
      status: 'idle',
      exitCode: null,
      stopping: false,
      chunks: [],
      bytes: 0,
      cols,
      rows,
    };
    session.script = options.script;
    session.cwd = options.cwd;
    session.cols = cols;
    session.rows = rows;
    this.sessions.set(options.key, session);

    let proc: IPty;
    try {
      proc = this.loadPty().spawn(spec.file, spec.args, {
        name: adapter.termName,
        cols,
        rows,
        cwd: options.cwd,
        env: { ...process.env } as Record<string, string>,
      });
    } catch (error) {
      this.append(session, `\r\n[${(error as Error).message}]\r\n`);
      session.status = 'exited';
      session.exitCode = -1;
      this.emit('status', options.key);
      return true;
    }

    session.proc = proc;
    session.status = 'running';
    session.exitCode = null;
    session.stopping = false;

    proc.onData((chunk) => this.append(session, chunk));
    proc.onExit(({ exitCode }) => {
      const wasStopped = session.stopping;
      session.proc = null;
      session.status = 'exited';
      session.exitCode = exitCode;
      session.stopping = false;
      // A killed console process reports a raw Windows status code; say what
      // actually happened instead of showing it to the user.
      this.append(
        session,
        wasStopped
          ? `\r\n[processo interrompido]\r\n`
          : `\r\n[processo encerrado com código ${exitCode}]\r\n`,
      );
      this.emit('status', session.key);
    });

    this.emit('status', options.key);
    return true;
  }

  stop(key: string): boolean {
    const session = this.sessions.get(key);
    if (!session?.proc) return false;
    session.stopping = true;
    try {
      session.proc.kill();
    } catch {
      /* the process may have exited between the click and this call */
    }
    return true;
  }

  /** Stop (if needed) and start again with the same command. */
  restart(options: StartOptions): void {
    const session = this.sessions.get(options.key);
    if (session?.proc) {
      const proc = session.proc;
      const done = new Promise<void>((resolve) => {
        const disposable = proc.onExit(() => {
          disposable.dispose();
          resolve();
        });
      });
      this.stop(options.key);
      void done.then(() => this.start(options));
      return;
    }
    this.start(options);
  }

  /** Clear only the captured output; the process keeps running. */
  clear(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    session.chunks = [];
    session.bytes = 0;
  }

  write(key: string, data: string): void {
    const session = this.sessions.get(key);
    if (session?.proc) session.proc.write(data);
  }

  resize(key: string, cols: number, rows: number): void {
    const session = this.sessions.get(key);
    if (!session) return;
    session.cols = cols;
    session.rows = rows;
    if (!session.proc) return;
    try {
      session.proc.resize(cols, rows);
    } catch {
      /* ignore resize races with an exiting process */
    }
  }

  /** Kill every PTY. Called when the app quits. */
  disposeAll(): void {
    for (const session of this.sessions.values()) {
      if (!session.proc) continue;
      session.stopping = true;
      try {
        session.proc.kill();
      } catch {
        // Already gone: the app is quitting either way.
      }
      session.proc = null;
      session.status = 'exited';
    }
  }

  private append(session: Session, chunk: string): void {
    session.chunks.push(chunk);
    session.bytes += chunk.length;
    while (session.bytes > MAX_BUFFER_BYTES && session.chunks.length > 1) {
      session.bytes -= session.chunks.shift()?.length ?? 0;
    }
    this.emit('data', session.key, chunk);
  }
}
