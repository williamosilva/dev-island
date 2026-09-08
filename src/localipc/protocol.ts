import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';

import { PIPE_BASENAME } from '../shared/branding';

export const PROTOCOL_VERSION = 1;

/** Hard cap on a single request line, so a rogue client cannot exhaust memory. */
export const MAX_MESSAGE_BYTES = 8 * 1024;

export const REQUEST_TYPES = ['ping', 'activate', 'show', 'shutdown'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export interface PingRequest {
  v: number;
  token: string;
  type: 'ping';
}

export interface ActivateRequest {
  v: number;
  token: string;
  type: 'activate';
  /** Absolute working directory reported by the PowerShell hook. */
  cwd: string;
  /**
   * PID of the shell that reported the directory, when known. It is tracked so
   * the widget can hide once every terminal for the project is gone.
   */
  shellPid: number | null;
  /** Explicit `--preview`: allows the widget to show outside VS Code. */
  preview: boolean;
  /**
   * Handle of the VS Code window that was in the foreground when the terminal
   * reported, as a hex string. Null when the reporter could not prove that a
   * VS Code window was in front.
   */
  windowHandle: string | null;
}

export interface ShowRequest {
  v: number;
  token: string;
  type: 'show';
}

export interface ShutdownRequest {
  v: number;
  token: string;
  type: 'shutdown';
}

export type IpcRequest = PingRequest | ActivateRequest | ShowRequest | ShutdownRequest;

export type IpcResponse = { ok: true; pid?: number; message?: string } | { ok: false; error: string };

/**
 * Named pipe address. The digest keeps separate data directories (tests, a
 * second user session) on separate pipes.
 */
export function pipeShortNameFor(dataDir: string): string {
  const digest = crypto
    .createHash('sha1')
    .update(`${os.userInfo().username}\u0000${path.resolve(dataDir).toLowerCase()}`)
    .digest('hex')
    .slice(0, 10);
  return `${PIPE_BASENAME}-${digest}`;
}

/** Full Win32 pipe path used by Node's `net` module. */
export function pipeNameFor(dataDir: string): string {
  return `\\\\.\\pipe\\${pipeShortNameFor(dataDir)}`;
}

/** Timing-safe token comparison. */
export function tokensMatch(received: unknown, expected: string): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type ParseResult = { ok: true; request: IpcRequest } | { ok: false; error: string };

/**
 * Validate an incoming line. Every field is checked before it reaches any
 * handler: the transport is local, but the payload is still untrusted input.
 */
export function parseRequest(line: string, expectedToken: string): ParseResult {
  if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) {
    return { ok: false, error: 'message too large' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, error: 'invalid json' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'invalid payload' };
  }

  const message = parsed as Record<string, unknown>;
  if (message.v !== PROTOCOL_VERSION) return { ok: false, error: 'unsupported version' };
  if (!tokensMatch(message.token, expectedToken)) return { ok: false, error: 'unauthorized' };

  const type = message.type;
  if (typeof type !== 'string' || !(REQUEST_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: 'unknown request type' };
  }

  if (type === 'activate') {
    const cwd = message.cwd;
    if (typeof cwd !== 'string' || cwd.trim().length === 0 || cwd.length > 1024) {
      return { ok: false, error: 'invalid cwd' };
    }
    if (!path.isAbsolute(cwd.trim())) return { ok: false, error: 'cwd must be absolute' };

    const rawPid = message.shellPid;
    let shellPid: number | null = null;
    if (rawPid !== undefined && rawPid !== null) {
      if (typeof rawPid !== 'number' || !Number.isInteger(rawPid) || rawPid <= 0 || rawPid > 0xffffffff) {
        return { ok: false, error: 'invalid shellPid' };
      }
      shellPid = rawPid;
    }

    const rawPreview = message.preview;
    if (rawPreview !== undefined && typeof rawPreview !== 'boolean') {
      return { ok: false, error: 'invalid preview' };
    }

    const rawHandle = message.windowHandle;
    let windowHandle: string | null = null;
    if (rawHandle !== undefined && rawHandle !== null && rawHandle !== '') {
      if (typeof rawHandle !== 'string' || !/^0x[0-9a-f]{1,16}$/i.test(rawHandle.trim())) {
        return { ok: false, error: 'invalid windowHandle' };
      }
      windowHandle = rawHandle.trim();
    }

    return {
      ok: true,
      request: {
        v: PROTOCOL_VERSION,
        token: expectedToken,
        type: 'activate',
        cwd: cwd.trim(),
        shellPid,
        preview: rawPreview === true,
        windowHandle,
      },
    };
  }

  return {
    ok: true,
    request: { v: PROTOCOL_VERSION, token: expectedToken, type } as IpcRequest,
  };
}
