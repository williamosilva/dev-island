import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { writeFileAtomic } from '../core/fs-atomic';
import { foregroundScriptFile } from '../core/paths';
import { buildForegroundScript, DEFAULT_POLL_INTERVAL_MS } from '../shell/foreground-script';
import type { ForegroundWindow } from './visibility';

export type ForegroundListener = (foreground: ForegroundWindow | null) => void;

/** Injected so the visibility tests never spawn a real PowerShell. */
export interface ForegroundSource {
  start(): void;
  stop(): void;
  onChange(listener: ForegroundListener): () => void;
}

/**
 * Parse one line emitted by the helper.
 * Returns `undefined` for anything that is not a valid report, so garbage on
 * the pipe is dropped instead of being treated as "no foreground window".
 */
/** Canonical form so the same window always maps to the same key. */
export function normalizeWindowHandle(handle: string): string {
  const digits = handle.trim().replace(/^0x/i, '').replace(/^0+/, '') || '0';
  return `0x${digits.toUpperCase().padStart(16, '0')}`;
}

export function parseForegroundLine(line: string): ForegroundWindow | null | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === 'null') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;

  const raw = parsed as Record<string, unknown>;
  const pid = raw.pid;
  const processName = raw.processName;
  const windowHandle = raw.windowHandle;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 0) return undefined;
  if (typeof processName !== 'string') return undefined;
  // The handle stays a string: a 64-bit HWND cannot round-trip through a
  // JavaScript number without losing precision.
  if (typeof windowHandle !== 'string' || !/^0x[0-9a-f]{1,16}$/i.test(windowHandle.trim())) {
    return undefined;
  }

  const size = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;

  return {
    pid,
    windowHandle: normalizeWindowHandle(windowHandle),
    title: typeof raw.title === 'string' ? raw.title : '',
    processName: processName.trim().toLowerCase(),
    minimized: raw.minimized === true,
    x: size(raw.x),
    y: size(raw.y),
    width: size(raw.width),
    height: size(raw.height),
  };
}

export interface WatcherOptions {
  dataDir: string;
  pollIntervalMs?: number;
  /** Reported when the helper cannot be kept alive. */
  onError?: (error: Error) => void;
}

const RESTART_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * Keeps one PowerShell helper alive and turns its output into events.
 *
 * The helper only reads window metadata; it never activates, moves or closes
 * anything. If it dies it is restarted with a backoff, and while it is down the
 * controller simply sees no foreground window (so the widget stays hidden).
 */
export class PowerShellForegroundWatcher implements ForegroundSource {
  private child: ChildProcess | null = null;
  private listeners: ForegroundListener[] = [];
  private buffer = '';
  private restarts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(private readonly options: WatcherOptions) {}

  onChange(listener: ForegroundListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((candidate) => candidate !== listener);
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.spawnHelper();
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }

  /** Writes the helper script only when its content changed. */
  private ensureScript(): string {
    const file = foregroundScriptFile(this.options.dataDir);
    const content = buildForegroundScript(this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    let current: string | null = null;
    try {
      current = fs.readFileSync(file, 'utf8');
    } catch {
      current = null;
    }
    if (current !== content) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeFileAtomic(file, content);
    }
    return file;
  }

  private spawnHelper(): void {
    if (this.stopped) return;

    let scriptPath: string;
    try {
      scriptPath = this.ensureScript();
    } catch (error) {
      this.fail(error as Error);
      return;
    }

    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    this.child = child;
    this.buffer = '';

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.consume(chunk));
    child.on('error', (error) => this.fail(error));
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      this.scheduleRestart();
    });
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 64 * 1024) this.buffer = '';

    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const parsed = parseForegroundLine(line);
      if (parsed !== undefined) {
        this.restarts = 0;
        this.emit(parsed);
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  private emit(foreground: ForegroundWindow | null): void {
    for (const listener of [...this.listeners]) listener(foreground);
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return;
    // While the helper is down nothing owns the foreground as far as we know,
    // which keeps the widget hidden rather than stuck on screen.
    this.emit(null);

    const delay = RESTART_DELAYS_MS[Math.min(this.restarts, RESTART_DELAYS_MS.length - 1)] ?? 15000;
    this.restarts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnHelper();
    }, delay);
    this.restartTimer.unref?.();
  }

  private fail(error: Error): void {
    this.options.onError?.(error);
    this.scheduleRestart();
  }
}
