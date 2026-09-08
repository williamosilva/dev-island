import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import type { ThemeName } from '../../shared/types';
import { bridge } from '../bridge';
import { terminalTheme } from '../theme';

interface Props {
  buttonId: string;
  theme: ThemeName;
  /** Bumped by "Limpar" so the view drops what it is showing. */
  clearToken: number;
}

/**
 * A live view over one button's PTY. The scrollback lives in the main process,
 * so leaving and re-opening this view replays everything the process printed.
 */
export function TerminalView({ buttonId, theme, clearToken }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      // The surface is opaque so the editor never shows through the output.
      allowTransparency: false,
      convertEol: false,
      cursorBlink: false,
      fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
      fontSize: 11,
      lineHeight: 1.15,
      scrollback: 5000,
      theme: terminalTheme(theme),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;

    const applyFit = (): void => {
      try {
        fit.fit();
        bridge.resizePty(buttonId, term.cols, term.rows);
      } catch {
        /* the host can be zero-sized for a frame while the window resizes */
      }
    };
    applyFit();

    const observer = new ResizeObserver(applyFit);
    observer.observe(host);

    let disposed = false;
    void bridge.getBuffer(buttonId).then((buffer) => {
      if (!disposed && buffer) term.write(buffer);
    });

    const offData = bridge.onPtyData((id, chunk) => {
      if (id === buttonId) term.write(chunk);
    });
    const input = term.onData((data) => bridge.sendInput(buttonId, data));

    return () => {
      disposed = true;
      offData();
      input.dispose();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [buttonId]);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = terminalTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (clearToken > 0) termRef.current?.clear();
  }, [clearToken]);

  return <div className="terminal" ref={hostRef} />;
}
