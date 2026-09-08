import * as net from 'node:net';

import {
  MAX_MESSAGE_BYTES,
  parseRequest,
  pipeNameFor,
  type IpcRequest,
  type IpcResponse,
} from './protocol';
import { ensureToken } from './token';

export type RequestHandler = (request: IpcRequest) => IpcResponse | Promise<IpcResponse>;

/**
 * Named-pipe server used by the CLI and the PowerShell hook to talk to the
 * running app. It is not a network server: nothing is ever bound to a TCP
 * port, and every message must carry the per-user token.
 */
export class LocalIpcServer {
  private server: net.Server | null = null;
  private readonly token: string;

  readonly pipeName: string;

  constructor(
    private readonly dataDir: string,
    private readonly handler: RequestHandler,
  ) {
    this.pipeName = pipeNameFor(dataDir);
    this.token = ensureToken(dataDir);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.handleConnection(socket));
      server.on('error', reject);
      server.listen(this.pipeName, () => {
        server.off('error', reject);
        server.on('error', () => {
          /* keep the app alive if a client dies mid-write */
        });
        this.server = server;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private handleConnection(socket: net.Socket): void {
    socket.setEncoding('utf8');
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('error', () => socket.destroy());

    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_MESSAGE_BYTES) {
        this.reply(socket, { ok: false, error: 'message too large' });
        return;
      }

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) void this.dispatch(socket, line);
        newline = buffer.indexOf('\n');
      }
    });
  }

  private async dispatch(socket: net.Socket, line: string): Promise<void> {
    const parsed = parseRequest(line, this.token);
    if (!parsed.ok) {
      this.reply(socket, { ok: false, error: parsed.error });
      return;
    }
    try {
      this.reply(socket, await this.handler(parsed.request));
    } catch (error) {
      this.reply(socket, { ok: false, error: (error as Error).message });
    }
  }

  private reply(socket: net.Socket, response: IpcResponse): void {
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify(response)}\n`);
  }
}
