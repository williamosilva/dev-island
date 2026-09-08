import type { PendingAuthorization } from '../../shared/types';
import { AnimatedPanel } from './AnimatedPanel';

interface Props {
  pending: PendingAuthorization;
  onResolve(accept: boolean): void;
}

/**
 * A project that already carries a `.dev-island/buttons.json` nobody
 * authorized on this machine. The full path and every command found are shown
 * first, and nothing is written or executed until the answer comes — which is
 * given here, never in a terminal.
 */
export function AuthorizePanel({ pending, onResolve }: Props): JSX.Element {
  return (
    <AnimatedPanel>
      <div className="panel__head">
        <div className="panel__title">Project not authorized</div>
      </div>
      <div className="notice">
        This project already has a configuration that was not created here. Check the path
        and the commands before authorizing it.
      </div>
      <div className="panel__path">{pending.path}</div>

      <div className="more">
        {pending.buttons.length === 0 && <div className="panel__hint">No commands in the file.</div>}
        {pending.buttons.map((button) => (
          <div className="more__item" key={`${button.name}-${button.script}`}>
            <span className="more__name">{button.name}</span>
            <span className="more__script">{button.script}</span>
          </div>
        ))}
      </div>

      <div className="panel__actions">
        <button type="button" className="action action--primary" onClick={() => onResolve(true)}>
          Authorize
        </button>
        <button type="button" className="action action--muted" onClick={() => onResolve(false)}>
          Ignore
        </button>
      </div>
    </AnimatedPanel>
  );
}
