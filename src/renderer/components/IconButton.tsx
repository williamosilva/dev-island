import type { ReactNode } from 'react';

import { GESTURE_ATTRIBUTE } from '../useTopbarGestures';

interface Props {
  label: string;
  onClick(): void;
  children: ReactNode;
  className?: string;
}

/**
 * A control whose meaning comes from an icon, so the accessible name and the
 * tooltip carry the same words. Marked `block`, so a press here acts on the
 * button and never starts moving the window.
 */
export function IconButton({ label, onClick, children, className }: Props): JSX.Element {
  return (
    <button
      type="button"
      className={className ? `icon-button ${className}` : 'icon-button'}
      aria-label={label}
      title={label}
      onClick={onClick}
      {...{ [GESTURE_ATTRIBUTE]: 'block' }}
    >
      {children}
    </button>
  );
}
