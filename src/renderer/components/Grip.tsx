import { GESTURE_ATTRIBUTE } from '../useTopbarGestures';
import { GRIP_DOT_COUNT } from './icons';

interface Props {
  /** Double click without moving: back to the automatic width. */
  onAutoSize(): void;
}

export const GRIP_TITLE = 'Arrastar · duplo clique para ajustar automaticamente';
export const GRIP_LABEL = 'Arrastar widget';

/**
 * The only place the window can be moved from.
 *
 * It is deliberately **not** a `-webkit-app-region: drag` region: on Windows
 * that turns the element into a non-client area and the OS ignores the CSS
 * cursor, so the grip would show a plain arrow instead of the grab hand. The
 * move is driven by the topbar controller instead, which keeps `grab`/
 * `grabbing` working.
 *
 * Every free area of the topbar now moves the window; the grip remains the
 * visible affordance for it, and the only place a double click resets the
 * size.
 */
export function Grip({ onAutoSize }: Props): JSX.Element {
  return (
    <div
      className="grip"
      role="button"
      tabIndex={-1}
      aria-label={GRIP_LABEL}
      title={GRIP_TITLE}
      onDoubleClick={onAutoSize}
      {...{ [GESTURE_ATTRIBUTE]: 'free' }}
    >
      {Array.from({ length: GRIP_DOT_COUNT }, (_unused, index) => (
        <span className="grip__dot" key={index} />
      ))}
    </div>
  );
}

export { GRIP_DOT_COUNT };
