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
        <div className="panel__title">Projeto não autorizado</div>
      </div>
      <div className="notice">
        Este projeto já possui uma configuração que não foi criada aqui. Confira o caminho e os
        comandos antes de autorizar.
      </div>
      <div className="panel__path">{pending.path}</div>

      <div className="more">
        {pending.buttons.length === 0 && <div className="panel__hint">Nenhum comando no arquivo.</div>}
        {pending.buttons.map((button) => (
          <div className="more__item" key={`${button.name}-${button.script}`}>
            <span className="more__name">{button.name}</span>
            <span className="more__script">{button.script}</span>
          </div>
        ))}
      </div>

      <div className="panel__actions">
        <button type="button" className="action action--primary" onClick={() => onResolve(true)}>
          Autorizar
        </button>
        <button type="button" className="action action--muted" onClick={() => onResolve(false)}>
          Ignorar
        </button>
      </div>
    </AnimatedPanel>
  );
}
