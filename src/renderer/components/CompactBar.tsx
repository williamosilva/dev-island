import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

import type { AppState, ButtonView, ThemeName } from '../../shared/types';
import type { PlaceholderBox } from '../reorder-stage';
import { GESTURE_ATTRIBUTE } from '../useTopbarGestures';
import { ReorderPlaceholder } from './ReorderPlaceholder';
import { Grip } from './Grip';
import { IconButton } from './IconButton';
import { CloseIcon, MoonIcon, PlusIcon, SunIcon } from './icons';

interface Props {
  state: AppState;
  buttons: readonly ButtonView[];
  visible: readonly ButtonView[];
  hiddenCount: number;
  measureRef: RefObject<HTMLDivElement>;
  onOpen(button: ButtonView): void;
  onMore(): void;
  onAdd(): void;
  onToggleTheme(): void;
  onClose(): void;
  onAutoSize(): void;
  openPanel: 'more' | 'add' | null;
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

export const ADD_LABEL = 'Add action';
export const CLOSE_LABEL = 'Close widget';

export function themeLabel(theme: ThemeName): string {
  return theme === 'dark' ? 'Use the light theme' : 'Use the dark theme';
}

function scriptClass(button: ButtonView): string {
  const base = 'action action--script';
  if (button.status === 'running') return `${base} action--running`;
  if (button.status === 'exited') return `${base} action--exited`;
  return base;
}

export function clickHint(button: ButtonView): string {
  return button.status === 'running' ? 'Click to open the terminal' : 'Click to run';
}

export function scriptTitle(button: ButtonView): string {
  return `${button.name}\n${button.script}\n${clickHint(button)} · drag to reorder`;
}

export function CompactBar({
  state,
  buttons,
  visible,
  hiddenCount,
  measureRef,
  onOpen,
  onMore,
  onAdd,
  onToggleTheme,
  onClose,
  onAutoSize,
  openPanel,
  gestures,
  dragId,
  placeholder,
}: Props): JSX.Element {
  const projectName = state.project?.name ?? state.productName;

  return (
    <>
      {/* Measures item widths without affecting layout. */}
      <div className="measure" aria-hidden="true">
        <div className="measure__row" ref={measureRef}>
          <span className="bar__lead" data-measure="project">
            <span className="measure__grip" />
            <span className="bar__project">{projectName}</span>
          </span>
          {buttons.map((button) => (
            <span key={button.id} className="action action--script" data-measure="script">
              {button.name}
            </span>
          ))}
          <span className="action" data-measure="more">
            {`More (${buttons.length})`}
          </span>
          <span className="bar__controls" data-measure="controls">
            <span className="icon-button" />
            <span className="icon-button" />
            <span className="icon-button" />
          </span>
        </div>
      </div>

      {/* Empty areas drag the window; `block` opts a child out. */}
      <div className="bar" {...{ [GESTURE_ATTRIBUTE]: 'free' }} {...gestures}>
        <span className="bar__lead">
          <Grip onAutoSize={onAutoSize} />
          <span className="bar__project" title={state.project?.path ?? projectName}>
            {projectName}
          </span>
        </span>

        {/* Keeps the row stable while dragging. */}
        <div className="bar__scripts">
          {buttons.length === 0 && <span className="bar__empty">No buttons</span>}
          {placeholder && !placeholder.vertical && <ReorderPlaceholder box={placeholder} />}
          {visible.map((button, index) => (
            <button
              key={button.id}
              type="button"
              className={
                dragId === button.id ? `${scriptClass(button)} action--dragging` : scriptClass(button)
              }
              title={scriptTitle(button)}
              onClick={() => onOpen(button)}
              {...{ [GESTURE_ATTRIBUTE]: 'reorder' }}
              data-reorder-id={button.id}
              data-reorder-index={index}
            >
              {button.name}
            </button>
          ))}
        </div>

        <span className="bar__gap" />
        <span className="sep" />

        <div className="bar__controls">
          {hiddenCount > 0 && (
            <button
              type="button"
              className={openPanel === 'more' ? 'action action--selected' : 'action'}
              title={`${hiddenCount} script(s) that did not fit`}
              onClick={onMore}
              {...{ [GESTURE_ATTRIBUTE]: 'block' }}
            >
              {`More (${hiddenCount})`}
            </button>
          )}
          <IconButton
            label={ADD_LABEL}
            onClick={onAdd}
            className={
              openPanel === 'add' ? 'icon-button--add icon-button--selected' : 'icon-button--add'
            }
          >
            <PlusIcon />
          </IconButton>
          <IconButton
            label={themeLabel(state.theme)}
            onClick={onToggleTheme}
            className="icon-button--theme"
          >
            {state.theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          </IconButton>
          <IconButton label={CLOSE_LABEL} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
      </div>
    </>
  );
}
