import type { PointerEvent as ReactPointerEvent } from 'react';

import type { ButtonView } from '../../shared/types';
import type { PlaceholderBox } from '../reorder-stage';
import { GESTURE_ATTRIBUTE } from '../useTopbarGestures';
import { scriptTitle } from './CompactBar';
import { AnimatedPanel } from './AnimatedPanel';
import { ReorderPlaceholder } from './ReorderPlaceholder';

interface Props {
  /** The buttons that did not fit, in their place in the full list. */
  buttons: readonly ButtonView[];
  /** Index of the first hidden button in the full list. */
  offset: number;
  onOpen(button: ButtonView): void;
  onBack(): void;
  gestures: {
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
    onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
    onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
    onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
    onLostPointerCapture(event: ReactPointerEvent<HTMLElement>): void;
  };
  dragId: string | null;
  placeholder: PlaceholderBox | null;
}

/**
 * Everything that did not fit on the bar. Each row shows the name and the real
 * command, and opening one behaves exactly like clicking it on the bar: it
 * shows that terminal and only starts a process when none is running.
 *
 * The rows take part in the same reorder gesture as the topbar, because both
 * are views of one ordered list: a row dragged onto the bar takes that
 * position, and whatever no longer fits moves down here.
 */
export function MorePanel({
  buttons,
  offset,
  onOpen,
  onBack,
  gestures,
  dragId,
  placeholder,
}: Props): JSX.Element {
  return (
    <AnimatedPanel>
      <div className="panel__head">
        <div className="panel__title">{`More (${buttons.length})`}</div>
      </div>

      <div className="more" {...gestures}>
        {placeholder?.vertical && <ReorderPlaceholder box={placeholder} />}
        {buttons.map((button, position) => {
          const index = offset + position;
          return (
            <button
              key={button.id}
              type="button"
              className={[
                'more__item',
                button.status === 'running' ? 'more__item--running' : '',
                dragId === button.id ? 'more__item--dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={scriptTitle(button)}
              onClick={() => onOpen(button)}
              {...{ [GESTURE_ATTRIBUTE]: 'reorder' }}
              data-reorder-id={button.id}
              data-reorder-index={index}
              data-reorder-axis="vertical"
            >
              <span className="more__name">{button.name}</span>
              <span className="more__script">{button.script}</span>
            </button>
          );
        })}
      </div>

      <div className="panel__actions">
        <button
          type="button"
          className="action action--muted"
          onClick={onBack}
          {...{ [GESTURE_ATTRIBUTE]: 'block' }}
        >
          Back
        </button>
      </div>
    </AnimatedPanel>
  );
}
