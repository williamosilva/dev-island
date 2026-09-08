import type { FormEvent, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** A panel that is a form submits; everything else is a plain container. */
  onSubmit?: (event: FormEvent) => void;
}

/**
 * The surface every panel opens onto.
 *
 * There is exactly one of these so the terminal, "Mais", the form and the
 * authorisation prompt cannot drift apart: one class, therefore one reveal
 * (`di-panel-in`), one duration, one curve, one origin, one way of leaving
 * (`.island--collapsing .panel`) and one answer to reduced motion. The window
 * behind them is stepped by the same animator whatever the panel is, because
 * it only ever sees the height the capsule measured.
 *
 * Only the content differs: a list of scripts, a form, a terminal.
 */
export function AnimatedPanel({ children, onSubmit }: Props): JSX.Element {
  if (onSubmit) {
    return (
      <form className="panel" onSubmit={onSubmit}>
        {children}
      </form>
    );
  }
  return <div className="panel">{children}</div>;
}
