import * as path from 'node:path';

import { BrowserWindow } from 'electron';

import { DEV_SERVER_ENV, PRODUCT_NAME } from '../shared/branding';
import type { WidgetWindowPort } from './visibility';
import type { WindowPlacement } from './window-placement';
import { MIN_HEIGHT, MIN_WIDTH } from './window-geometry';

/** Compact capsule size before the renderer reports its real content size. */
const INITIAL_WIDTH = 520;
const INITIAL_HEIGHT = 46;

export function createWidgetWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: INITIAL_WIDTH,
    height: INITIAL_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: PRODUCT_NAME,
    frame: false,
    // Only the area around the capsule is transparent; the capsule itself
    // paints an opaque background so the editor never shows through it.
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    // Always-on-top is switched on by the visibility controller, and only
    // while the VS Code context holds.
    alwaysOnTop: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload is our own compiled CommonJS module, so it is not sandboxed;
      // the renderer itself still has no Node access at all.
      sandbox: false,
      devTools: process.env.NODE_ENV !== 'production',
      spellcheck: false,
    },
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setMenuBarVisibility(false);

  const devServer = process.env[DEV_SERVER_ENV];
  if (devServer) {
    void window.loadURL(devServer);
  } else {
    void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  return window;
}

/**
 * Adapter that exposes only what the visibility controller may do to the
 * window. Showing and hiding go through the placement so they can never be
 * mistaken for the user dragging the capsule.
 */
export function createWindowPort(
  getWindow: () => BrowserWindow | null,
  placement: WindowPlacement,
): WidgetWindowPort {
  const live = (): BrowserWindow | null => {
    const window = getWindow();
    return window && !window.isDestroyed() ? window : null;
  };

  return {
    isDestroyed: () => live() === null,
    isVisible: () => live()?.isVisible() ?? false,
    // Positioned first, then shown: the capsule never appears anywhere it is
    // not staying. The first show waits for the renderer's measurement.
    showInactive: () => placement.showWhenPositioned(() => live()?.showInactive()),
    hide: () => {
      placement.cancelPendingShow();
      // Immediate, and never waiting on an animation: the size is landed on
      // its target so the widget is never stuck half open when it returns.
      placement.settleBounds();
      placement.runProgrammatic(() => live()?.hide());
    },
    setAlwaysOnTop: (flag) => {
      // 'screen-saver' is what keeps the capsule above the VS Code window.
      if (flag) live()?.setAlwaysOnTop(true, 'screen-saver');
      else live()?.setAlwaysOnTop(false);
    },
    positionOver: (anchor) => placement.applyPosition(anchor),
  };
}
