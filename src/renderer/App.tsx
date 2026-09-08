import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AppState, ButtonView, ThemeName } from '../shared/types';
import {
  DEFAULT_LAYOUT_LIMITS,
  FREE_DRAG_WIDTH_VARIABLE,
  MIN_FREE_DRAG_WIDTH,
} from '../shared/layout';
import { bridge } from './bridge';
import { splitButtons } from './fit';
import { applyThemeTokens } from './theme';
import { PANEL_CLOSE_MS, PANEL_OPEN_MS, phaseClass, type PanelPhase } from './panel-motion';
import { useAutoResize } from './useAutoResize';
import { useCapsuleEntry } from './useCapsuleEntry';
import { useFittedScripts } from './useFittedScripts';
import { useTopbarGestures } from './useTopbarGestures';
import { AddButtonForm } from './components/AddButtonForm';
import { AuthorizePanel } from './components/AuthorizePanel';
import { CompactBar } from './components/CompactBar';
import { MorePanel } from './components/MorePanel';
import { ProcessPanel } from './components/ProcessPanel';
import { ResizeHandles } from './components/ResizeHandles';

type View =
  | { kind: 'compact' }
  | { kind: 'add' }
  | { kind: 'more' }
  | { kind: 'terminal'; id: string };

const EMPTY_STATE: AppState = {
  productName: 'Dev Island',
  project: null,
  pending: null,
  buttons: [],
  notice: null,
  theme: 'dark',
  layout: DEFAULT_LAYOUT_LIMITS,
};

export function App(): JSX.Element {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [view, setView] = useState<View>({ kind: 'compact' });
  const [clearToken, setClearToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PanelPhase>('compact');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const islandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void bridge.getState().then(setState);
    return bridge.onStateChanged(setState);
  }, []);

  useEffect(() => {
    applyThemeTokens(document.documentElement, state.theme);
  }, [state.theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--di-max-width', `${state.layout.maxWidth}px`);
    root.style.setProperty('--di-max-height', `${state.layout.maxHeight}px`);
    root.style.setProperty('--di-panel-height', `${state.layout.panelHeight}px`);
    // The same constant the fit reserved, so CSS cannot drift from it.
    root.style.setProperty(FREE_DRAG_WIDTH_VARIABLE, `${MIN_FREE_DRAG_WIDTH}px`);
    root.setAttribute('data-size-mode', state.layout.sizeMode);
  }, [
    state.layout.maxWidth,
    state.layout.maxHeight,
    state.layout.panelHeight,
    state.layout.sizeMode,
  ]);

  // One measurement for the whole widget; "Mais" renders what was left out.
  const { visibleCount, hiddenCount, baseWidth, measureRef } = useFittedScripts(
    state.buttons.length,
    state.layout.maxWidth,
  );

  useAutoResize(islandRef, baseWidth);

  const reorder = useCallback(async (orderedIds: string[]): Promise<boolean> => {
    const result = await bridge.reorderButtons(orderedIds);
    if (result.ok) return true;
    // The gesture puts the previous order back; this only says why.
    setError(result.error ?? 'Não foi possível salvar a nova ordem.');
    return false;
  }, []);
  const gestures = useTopbarGestures(state.buttons, reorder);
  const buttons = gestures.buttons;

  const { visible, hidden } = useMemo(
    () => splitButtons(buttons, visibleCount),
    [buttons, visibleCount],
  );

  const openButton = useMemo<ButtonView | null>(() => {
    if (view.kind !== 'terminal') return null;
    return buttons.find((button) => button.id === view.id) ?? null;
  }, [buttons, view]);

  // The button behind the open terminal is gone.
  useEffect(() => {
    if (view.kind === 'terminal' && !openButton) setView({ kind: 'compact' });
  }, [openButton, view.kind]);

  useEffect(() => {
    if (view.kind === 'more' && hidden.length === 0) setView({ kind: 'compact' });
  }, [hidden.length, view.kind]);

  // Closing "Mais" or switching project takes the dragged rows away.
  const cancelGesture = gestures.cancel;
  useEffect(() => {
    if (view.kind !== 'more') cancelGesture();
  }, [cancelGesture, view.kind]);
  useEffect(() => {
    cancelGesture();
  }, [cancelGesture, state.project?.path]);

  const stopClosing = useCallback(() => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  /**
   * The view is kept until the animation ends, which keeps the panel's React
   * tree alive: closing a terminal touches neither its process nor its buffer.
   */
  const back = useCallback(() => {
    setError(null);
    stopClosing();
    setPhase('collapsing');
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setView({ kind: 'compact' });
      setPhase('compact');
    }, PANEL_CLOSE_MS);
  }, [stopClosing]);

  const toggle = useCallback(
    (kind: 'add' | 'more') => {
      setError(null);
      // The same control again closes; another one switches from where it is.
      if (view.kind === kind && phase !== 'collapsing') {
        back();
        return;
      }
      stopClosing();
      setView({ kind });
    },
    [back, phase, stopClosing, view.kind],
  );

  const openTerminal = useCallback(
    async (button: ButtonView) => {
      // The click that ends a reorder must not open or run anything.
      if (gestures.consumeClick()) return;
      setError(null);
      stopClosing();
      setView({ kind: 'terminal', id: button.id });
      // Already running means a view switch, never a second process.
      if (button.status !== 'running') await bridge.run(button.id);
    },
    [gestures, stopClosing],
  );

  const addButton = useCallback(async (name: string, script: string): Promise<string | null> => {
    const result = await bridge.addButton(name, script);
    return result.ok ? null : (result.error ?? 'Não foi possível salvar.');
  }, []);

  const deleteButton = useCallback(async (id: string) => {
    const result = await bridge.deleteButton(id);
    if (!result.ok) {
      setError(result.error ?? 'Não foi possível excluir.');
      return;
    }
    setView({ kind: 'compact' });
  }, []);

  const toggleTheme = useCallback(() => {
    setState((current) => {
      const theme: ThemeName = current.theme === 'dark' ? 'light' : 'dark';
      void bridge.setTheme(theme);
      return { ...current, theme };
    });
  }, []);

  const entering = useCapsuleEntry();
  const expanded = view.kind !== 'compact' || state.pending !== null;

  /**
   * A panel dropped without going through `back` normalises to `compact`, so
   * no interruption leaves a half-applied state. `view.kind` is a dependency
   * even though the body does not read it: one panel straight to another has
   * to replay the reveal.
   */
  useEffect(() => {
    if (!expanded) {
      if (closeTimer.current === null) setPhase('compact');
      return undefined;
    }
    setPhase('expanding');
    const timer = setTimeout(() => setPhase('expanded'), PANEL_OPEN_MS);
    return () => clearTimeout(timer);
  }, [expanded, view.kind]);

  // A pending close must not outlive the component.
  useEffect(() => () => stopClosing(), [stopClosing]);
  const openPanel = view.kind === 'add' || view.kind === 'more' ? view.kind : null;
  // Only bodies that use the extra room can be dragged taller.
  const resizableHeight = view.kind === 'terminal' || view.kind === 'more';

  const islandClass = [
    'island',
    expanded || phase === 'collapsing' ? 'island--expanded' : '',
    phaseClass(phase),
    entering ? 'island--entering' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={islandClass} ref={islandRef}>
      <CompactBar
        state={state}
        visible={visible}
        hiddenCount={hiddenCount}
        measureRef={measureRef}
        openPanel={openPanel}
        onOpen={(button) => void openTerminal(button)}
        onMore={() => toggle('more')}
        onAdd={() => toggle('add')}
        onToggleTheme={toggleTheme}
        onClose={() => bridge.hideWindow()}
        onAutoSize={() => bridge.useAutoSize()}
        buttons={buttons}
        gestures={gestures}
        dragId={gestures.dragId}
        placeholder={gestures.placeholder}
      />

      {state.pending && (
        <AuthorizePanel
          pending={state.pending}
          onResolve={(accept) => void bridge.resolvePending(accept)}
        />
      )}

      {view.kind === 'more' && (
        <MorePanel
          buttons={hidden}
          offset={visibleCount}
          onOpen={(button) => void openTerminal(button)}
          onBack={back}
          gestures={gestures}
          dragId={gestures.dragId}
          placeholder={gestures.placeholder}
        />
      )}

      {view.kind === 'add' && (
        <AddButtonForm
          onSubmit={addButton}
          onBack={back}
          expansionComplete={phase === 'expanded'}
        />
      )}

      {view.kind === 'terminal' && openButton && (
        <ProcessPanel
          button={openButton}
          theme={state.theme}
          clearToken={clearToken}
          onRun={() => void bridge.run(openButton.id)}
          onStop={() => void bridge.stop(openButton.id)}
          onRestart={() => void bridge.restart(openButton.id)}
          onClear={() => {
            void bridge.clear(openButton.id);
            setClearToken((token) => token + 1);
          }}
          onDelete={() => void deleteButton(openButton.id)}
          onBack={back}
        />
      )}

      {(error ?? state.notice) && (
        <div className="panel">
          <div className={error ? 'error' : 'notice'}>{error ?? state.notice}</div>
        </div>
      )}

      <ResizeHandles resizableHeight={resizableHeight} />
    </div>
  );
}
