import { describe, expect, it } from 'vitest';

import { parseRequest, PROTOCOL_VERSION } from '../src/localipc/protocol';

const TOKEN = 'a'.repeat(64);

function message(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, token: TOKEN, type: 'ping', ...overrides });
}

describe('parseRequest', () => {
  it('accepts a well-formed request', () => {
    const parsed = parseRequest(message(), TOKEN);
    expect(parsed).toEqual({ ok: true, request: { v: 1, token: TOKEN, type: 'ping' } });
  });

  it('accepts an activate request with an absolute path', () => {
    const parsed = parseRequest(
      message({ type: 'activate', cwd: 'C:\\projetos\\demo  ' }),
      TOKEN,
    );
    expect(parsed.ok && parsed.request.type === 'activate' && parsed.request.cwd).toBe(
      'C:\\projetos\\demo',
    );
  });

  it('carries the shell PID and the preview flag', () => {
    const parsed = parseRequest(
      message({ type: 'activate', cwd: 'C:\\projetos', shellPid: 4321, preview: true }),
      TOKEN,
    );
    expect(parsed).toMatchObject({
      ok: true,
      request: { type: 'activate', shellPid: 4321, preview: true },
    });
  });

  it('defaults shellPid to null and preview to false', () => {
    const parsed = parseRequest(message({ type: 'activate', cwd: 'C:\\projetos' }), TOKEN);
    expect(parsed).toMatchObject({
      ok: true,
      request: { type: 'activate', shellPid: null, preview: false },
    });
  });

  it('rejects a malformed shellPid or preview flag', () => {
    for (const shellPid of [0, -1, 1.5, 'x']) {
      expect(
        parseRequest(message({ type: 'activate', cwd: 'C:\\projetos', shellPid }), TOKEN),
      ).toEqual({ ok: false, error: 'invalid shellPid' });
    }
    expect(
      parseRequest(message({ type: 'activate', cwd: 'C:\\projetos', preview: 'yes' }), TOKEN),
    ).toEqual({ ok: false, error: 'invalid preview' });
  });

  it('rejects a wrong or missing token', () => {
    expect(parseRequest(message({ token: 'b'.repeat(64) }), TOKEN)).toEqual({
      ok: false,
      error: 'unauthorized',
    });
    expect(parseRequest(message({ token: undefined }), TOKEN).ok).toBe(false);
  });

  it('rejects unknown request types', () => {
    expect(parseRequest(message({ type: 'exec' }), TOKEN)).toEqual({
      ok: false,
      error: 'unknown request type',
    });
  });

  it('rejects an unsupported protocol version', () => {
    expect(parseRequest(message({ v: 99 }), TOKEN).ok).toBe(false);
  });

  it('rejects a relative or empty cwd', () => {
    expect(parseRequest(message({ type: 'activate', cwd: 'relativo' }), TOKEN)).toEqual({
      ok: false,
      error: 'cwd must be absolute',
    });
    expect(parseRequest(message({ type: 'activate', cwd: '' }), TOKEN)).toEqual({
      ok: false,
      error: 'invalid cwd',
    });
  });

  it('rejects malformed and oversized payloads', () => {
    expect(parseRequest('{ nope', TOKEN)).toEqual({ ok: false, error: 'invalid json' });
    expect(parseRequest('[]', TOKEN)).toEqual({ ok: false, error: 'invalid payload' });
    expect(parseRequest('x'.repeat(9000), TOKEN)).toEqual({ ok: false, error: 'message too large' });
  });
});
