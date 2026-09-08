import { MIN_FREE_DRAG_WIDTH } from '../shared/layout';
import type { LayoutLimits, SizeMode } from '../shared/types';
import type { Anchor } from './visibility';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export const TOP_MARGIN = 12;

/** Below the title bar, the tab strip and the breadcrumbs. */
export const DEFAULT_TOP_OFFSET = 72;

export const ABSOLUTE_MAX_WIDTH = 900;
export const ABSOLUTE_MAX_HEIGHT = 760;

/** Share of the VS Code window the capsule may take, per size mode. */
export const AUTO_WIDTH_SHARE = 0.8;
export const MANUAL_WIDTH_SHARE = 0.95;

/** MIN_WIDTH is derived from the parts that must stay reachable. */
const GRIP_WIDTH = 28;
const PROJECT_MIN_WIDTH = 64;
const MORE_MIN_WIDTH = 76;
const ICON_BUTTON_WIDTH = 32;
const ICON_BUTTON_COUNT = 3;
const RESIZE_GUTTER = 8;
const BAR_GAPS = 6 * 4;
const BAR_CHROME = 24;

export const MIN_WIDTH =
  GRIP_WIDTH +
  PROJECT_MIN_WIDTH +
  MORE_MIN_WIDTH +
  ICON_BUTTON_WIDTH * ICON_BUTTON_COUNT +
  MIN_FREE_DRAG_WIDTH +
  RESIZE_GUTTER +
  BAR_GAPS +
  BAR_CHROME;

export const MIN_HEIGHT = 40;

export const DEFAULT_PANEL_HEIGHT = 320;
export const MIN_PANEL_HEIGHT = 120;
export const MAX_PANEL_HEIGHT = 900;

/** `auto` follows the content; `manual` makes the dragged width authoritative. */
export interface SizePreferences {
  sizeMode: SizeMode;
  manualWidth: number | null;
  panelHeight: number | null;
}

export const DEFAULT_SIZE_PREFERENCES: SizePreferences = {
  sizeMode: 'auto',
  manualWidth: null,
  panelHeight: null,
};

/**
 * The relative offset is what gets restored, so the capsule follows the editor
 * across monitors and resizes. The absolute point is the fallback when no VS
 * Code window is known.
 */
export interface SavedPlacement {
  relativeX: number;
  relativeY: number;
  absoluteX: number;
  absoluteY: number;
}

export function toRelative(widget: Point, anchor: Point): Pick<SavedPlacement, 'relativeX' | 'relativeY'> {
  return { relativeX: Math.round(widget.x - anchor.x), relativeY: Math.round(widget.y - anchor.y) };
}

export function toPlacement(widget: Point, anchor: Point | null): SavedPlacement {
  const relative = anchor ? toRelative(widget, anchor) : { relativeX: 0, relativeY: TOP_MARGIN };
  return {
    ...relative,
    absoluteX: Math.round(widget.x),
    absoluteY: Math.round(widget.y),
  };
}

/** Non-finite input falls back to `min`. */
export function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function clampToArea(position: Point, size: Size, area: Rect): Point {
  return {
    x: Math.round(clampValue(position.x, area.x, area.x + area.width - size.width)),
    y: Math.round(clampValue(position.y, area.y, area.y + area.height - size.height)),
  };
}

/** `size` must be the measured capsule, or the horizontal centre is wrong. */
export function defaultPosition(size: Size, anchor: Anchor | null, area: Rect): Point {
  const centreX = anchor && anchor.width > 0 ? anchor.x + anchor.width / 2 : area.x + area.width / 2;
  const top = (anchor ? anchor.y : area.y) + DEFAULT_TOP_OFFSET;
  return clampToArea({ x: Math.round(centreX - size.width / 2), y: Math.round(top) }, size, area);
}

/** A saved placement always wins; the default is only for a project with none. */
export function resolvePosition(
  saved: SavedPlacement | null,
  size: Size,
  anchor: Anchor | null,
  area: Rect,
): Point {
  if (!saved) return defaultPosition(size, anchor, area);
  const target = anchor
    ? { x: anchor.x + saved.relativeX, y: anchor.y + saved.relativeY }
    : { x: saved.absoluteX, y: saved.absoluteY };
  return clampToArea(target, size, area);
}

export function manualWidthCeiling(anchor: Anchor | null, area: Rect): number {
  const referenceWidth = anchor && anchor.width > 0 ? anchor.width : area.width;
  return Math.max(
    MIN_WIDTH,
    Math.round(Math.min(referenceWidth * MANUAL_WIDTH_SHARE, area.width)),
  );
}

/**
 * In `manual` mode the dragged width becomes the budget itself, which is what
 * lets a wider window show more scripts, and it may pass the automatic ceiling.
 */
export function computeLayoutLimits(
  anchor: Anchor | null,
  area: Rect,
  size: SizePreferences = DEFAULT_SIZE_PREFERENCES,
): LayoutLimits {
  const referenceWidth = anchor && anchor.width > 0 ? anchor.width : area.width;
  const referenceHeight = anchor && anchor.height > 0 ? anchor.height : area.height;
  const panelHeight = clampPanelHeight(size.panelHeight);

  if (size.sizeMode === 'manual' && size.manualWidth !== null) {
    return {
      sizeMode: 'manual',
      maxWidth: Math.round(
        clampValue(size.manualWidth, MIN_WIDTH, manualWidthCeiling(anchor, area)),
      ),
      // Only the VS Code window and the monitor cap a size the user asked for.
      maxHeight: Math.max(
        MIN_HEIGHT,
        Math.round(Math.min(referenceHeight * MANUAL_WIDTH_SHARE, area.height)),
      ),
      panelHeight,
    };
  }

  const maxHeight = Math.max(
    MIN_HEIGHT,
    Math.round(Math.min(ABSOLUTE_MAX_HEIGHT, referenceHeight * AUTO_WIDTH_SHARE)),
  );

  return {
    sizeMode: 'auto',
    maxWidth: Math.max(
      MIN_WIDTH,
      Math.round(Math.min(ABSOLUTE_MAX_WIDTH, referenceWidth * AUTO_WIDTH_SHARE)),
    ),
    maxHeight,
    panelHeight,
  };
}

export function clampPanelHeight(height: number | null | undefined): number {
  if (typeof height !== 'number' || !Number.isFinite(height)) return DEFAULT_PANEL_HEIGHT;
  return Math.round(clampValue(height, MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT));
}

/** In manual mode the measured width can never override the user's. */
export function resolveWindowWidth(contentWidth: number, limits: LayoutLimits): number {
  if (limits.sizeMode === 'manual') return Math.round(limits.maxWidth);
  return Math.round(clampValue(Math.ceil(contentWidth), MIN_WIDTH, limits.maxWidth));
}

export function clampSize(size: Size, limits: LayoutLimits): Size {
  return {
    width: resolveWindowWidth(size.width, limits),
    height: Math.round(clampValue(Math.ceil(size.height), MIN_HEIGHT, limits.maxHeight)),
  };
}
