import { describe, expect, it } from 'vitest';

import { detectVsCodeEnv } from '../src/core/vscode-env';

describe('detectVsCodeEnv', () => {
  it('trusts TERM_PROGRAM=vscode', () => {
    expect(detectVsCodeEnv({ TERM_PROGRAM: 'vscode' })).toMatchObject({
      insideVsCode: true,
      vscodePid: null,
    });
    expect(detectVsCodeEnv({ TERM_PROGRAM: 'vsCode' }).insideVsCode).toBe(true);
  });

  it('trusts VSCODE_PID', () => {
    expect(detectVsCodeEnv({ VSCODE_PID: '12345' })).toMatchObject({
      insideVsCode: true,
      vscodePid: 12345,
    });
  });

  it('rejects a malformed VSCODE_PID', () => {
    for (const value of ['', '0', '-3', 'abc']) {
      expect(detectVsCodeEnv({ VSCODE_PID: value })).toMatchObject({
        insideVsCode: false,
        vscodePid: null,
      });
    }
  });

  it('reports an external terminal as outside VS Code', () => {
    expect(detectVsCodeEnv({}).insideVsCode).toBe(false);
    expect(detectVsCodeEnv({ TERM_PROGRAM: 'Windows_Terminal' }).insideVsCode).toBe(false);
    expect(detectVsCodeEnv({ ComSpec: 'C:/Windows/system32/cmd.exe' }).insideVsCode).toBe(false);
  });

  it('never infers VS Code from the working directory', () => {
    // Only environment variables are consulted; cwd is not an input at all.
    expect(detectVsCodeEnv({ PWD: 'C:/projetos/meu-app' }).insideVsCode).toBe(false);
  });
});
