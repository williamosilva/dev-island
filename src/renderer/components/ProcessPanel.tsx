import type { ButtonView, ThemeName } from '../../shared/types';
import { TerminalView } from './TerminalView';
import { AnimatedPanel } from './AnimatedPanel';

interface Props {
  button: ButtonView;
  theme: ThemeName;
  clearToken: number;
  onRun(): void;
  onStop(): void;
  onRestart(): void;
  onClear(): void;
  onDelete(): void;
  onBack(): void;
}

/** Expanded form: name, the real command, live output, textual actions. */
export function ProcessPanel({
  button,
  theme,
  clearToken,
  onRun,
  onStop,
  onRestart,
  onClear,
  onDelete,
  onBack,
}: Props): JSX.Element {
  const running = button.status === 'running';

  return (
    <AnimatedPanel>
      <div className="panel__head">
        <div className="panel__title" title={button.name}>
          {button.name}
        </div>
        <div className="panel__script" title={button.script}>
          {button.script}
        </div>
      </div>

      <TerminalView buttonId={button.id} theme={theme} clearToken={clearToken} />

      <div className="panel__actions">
        {running ? (
          <button type="button" className="action" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="button" className="action action--primary" onClick={onRun}>
            Run
          </button>
        )}
        <button type="button" className="action" onClick={onRestart}>
          Restart
        </button>
        <button type="button" className="action" onClick={onClear}>
          Clear
        </button>
        <button type="button" className="action action--muted" onClick={onBack}>
          Back
        </button>
        {button.custom && (
          <>
            <span className="sep" />
            <button type="button" className="action action--danger" onClick={onDelete}>
              Delete
            </button>
          </>
        )}
      </div>
    </AnimatedPanel>
  );
}
