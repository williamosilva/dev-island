import * as net from 'node:net';

import { PROTOCOL_VERSION, pipeNameFor, type IpcResponse, type RequestType } from './protocol';
import { readToken } from './token';

export interface SendOptions {
  timeoutMs?: number;
  cwd?: string;
  /** PID of the shell reporting the directory (activate only). */
  shellPid?: number | null;
  /** Explicit preview mode (activate only). */
  preview?: boolean;
  /** VS Code window the report came from (activate only). */
  windowHandle?: string | null;
}

/**
 * Send a single request to the running app. Resolves to null when nothing is
 * listening, so callers can treat "app not running" as a normal outcome.
 */
export function sendRequest(
  dataDir: string,
  type: RequestType,
  options: SendOptions = {},
): Promise<IpcResponse | null> {
  const token = readToken(dataDir);
  if (!token) return Promise.resolve(null);

  const timeoutMs = options.timeoutMs ?? 2000;
  const payload = JSON.stringify({
    v: PROTOCOL_VERSION,
    token,
    type,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(typeof options.shellPid === 'number' ? { shellPid: options.shellPid } : {}),
    ...(options.preview ? { preview: true } : {}),
    ...(options.windowHandle ? { windowHandle: options.windowHandle } : {}),
  });

  return new Promise((resolve) => {
    const socket = net.createConnection(pipeNameFor(dataDir));
    let settled = false;
    let buffer = '';

    const finish = (value: IpcResponse | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.on('error', () => finish(null));
    socket.on('connect', () => socket.write(`${payload}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      try {
        finish(JSON.parse(buffer.slice(0, newline)) as IpcResponse);
      } catch {
        finish(null);
      }
    });
    socket.on('close', () => finish(null));
  });
}

/** True when an app instance answers on the pipe. */
export async function isAppRunning(dataDir: string): Promise<boolean> {
  const response = await sendRequest(dataDir, 'ping', { timeoutMs: 1500 });
  return response?.ok === true;
}
