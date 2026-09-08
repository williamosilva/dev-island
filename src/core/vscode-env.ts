/**
 * Whether the current process is running inside the VS Code integrated
 * terminal.
 *
 * The current directory proves nothing (a plain CMD can sit in the same
 * folder), so the decision is made only from environment variables VS Code
 * itself injects into its terminals.
 */
export interface VsCodeEnv {
  insideVsCode: boolean;
  /** PID of the VS Code window process, when it exposes one. */
  vscodePid: number | null;
  termProgram: string | null;
}

function readPid(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function detectVsCodeEnv(env: NodeJS.ProcessEnv = process.env): VsCodeEnv {
  const termProgram = typeof env.TERM_PROGRAM === 'string' ? env.TERM_PROGRAM.trim() : null;
  const vscodePid = readPid(env.VSCODE_PID);
  const insideVsCode = termProgram?.toLowerCase() === 'vscode' || vscodePid !== null;
  return { insideVsCode, vscodePid, termProgram: termProgram && termProgram.length > 0 ? termProgram : null };
}
