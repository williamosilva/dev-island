import { useEffect, useRef, useState, type FormEvent } from 'react';

import { AnimatedPanel } from './AnimatedPanel';

interface Props {
  onSubmit(name: string, script: string): Promise<string | null>;
  onBack(): void;
  /**
   * True once the capsule has finished growing.
   *
   * The focus ring is the loudest thing on the form, and showing it on the
   * first frame is what made the form look like it had simply appeared. It is
   * driven by the end of the expansion, not by a timer of its own.
   */
  expansionComplete: boolean;
}

export function AddButtonForm({ onSubmit, onBack, expansionComplete }: Props): JSX.Element {
  const [name, setName] = useState('');
  const [script, setScript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);

  // The expansion is over: the first field takes the focus, so the ring
  // arrives with the finished panel rather than ahead of it.
  useEffect(() => {
    if (!expansionComplete) return;
    nameField.current?.focus();
  }, [expansionComplete]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const failure = await onSubmit(name, script);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setName('');
    setScript('');
    setError(null);
    onBack();
  };

  return (
    <AnimatedPanel onSubmit={submit}>
      <div className="panel__head">
        <div className="panel__title">Add</div>
      </div>

      <label className="field">
        <span className="field__label">Name</span>
        <input
          ref={nameField}
          className="field__input"
          value={name}
          spellCheck={false}
          maxLength={48}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">Script</span>
        <input
          className="field__input field__input--mono"
          value={script}
          spellCheck={false}
          maxLength={1000}
          onChange={(event) => setScript(event.target.value)}
        />
      </label>

      {error && <div className="error">{error}</div>}

      <div className="panel__actions">
        <button type="submit" className="action action--primary" disabled={busy}>
          Save
        </button>
        <button type="button" className="action action--muted" onClick={onBack}>
          Cancel
        </button>
      </div>
    </AnimatedPanel>
  );
}
