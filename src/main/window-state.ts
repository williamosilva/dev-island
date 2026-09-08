import { readJsonIfExists, writeJsonAtomic } from '../core/fs-atomic';
import { normalizeProjectPath, windowStateFile } from '../core/paths';
import type { SizeMode } from '../shared/types';
import {
  DEFAULT_SIZE_PREFERENCES,
  MAX_PANEL_HEIGHT,
  MIN_PANEL_HEIGHT,
  MIN_WIDTH,
  type SavedPlacement,
  type SizePreferences,
} from './window-geometry';

/**
 * Version 2 keys the position by project root. `legacy` is the single position
 * a version 1 file had, which belonged to whichever project was open then and
 * so is kept but never applied.
 */
interface StoredWindowState {
  version: 2;
  projects?: Record<string, SavedPlacement>;
  legacy?: SavedPlacement;
  sizeMode?: SizeMode;
  manualWidth?: number;
  panelHeight?: number;
}

function readNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : null;
}

function readSize(parsed: unknown): SizePreferences {
  const raw = parsed as Record<string, unknown> | null;
  if (!raw) return { ...DEFAULT_SIZE_PREFERENCES };

  const manualWidth = readNumber(raw.manualWidth, MIN_WIDTH, 10_000);
  // Manual mode needs a usable width behind it, so a hand-edited file cannot
  // leave the widget stuck at an impossible size.
  const sizeMode: SizeMode = raw.sizeMode === 'manual' && manualWidth !== null ? 'manual' : 'auto';

  return {
    sizeMode,
    manualWidth,
    panelHeight: readNumber(raw.panelHeight, MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT),
  };
}

function readPlacementValue(raw: unknown): SavedPlacement | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  const numbers = ['relativeX', 'relativeY', 'absoluteX', 'absoluteY'] as const;
  for (const key of numbers) {
    if (typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key])) return null;
  }
  return {
    relativeX: candidate.relativeX as number,
    relativeY: candidate.relativeY as number,
    absoluteX: candidate.absoluteX as number,
    absoluteY: candidate.absoluteY as number,
  };
}

function readProjects(parsed: unknown): Map<string, SavedPlacement> {
  const raw = (parsed as { projects?: unknown } | null)?.projects;
  const placements = new Map<string, SavedPlacement>();
  if (typeof raw !== 'object' || raw === null) return placements;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const placement = readPlacementValue(value);
    // Normalised, so a hand-written key still finds its project.
    if (placement && key.length > 0) placements.set(normalizeProjectPath(key), placement);
  }
  return placements;
}

function readLegacy(parsed: unknown): SavedPlacement | null {
  const raw = parsed as { placement?: unknown; legacy?: unknown } | null;
  return readPlacementValue(raw?.legacy) ?? readPlacementValue(raw?.placement);
}

export interface WindowStateOptions {
  /** Writes are coalesced while the user drags. 0 writes immediately. */
  debounceMs?: number;
}

/**
 * Persists where the user dragged the capsule, per project.
 *
 * Lives in the per-user data directory: no window geometry is ever written
 * into a project, and `.dev-island` is never touched from here.
 */
export class WindowStateStore {
  private placements: Map<string, SavedPlacement> | undefined;
  private legacy: SavedPlacement | null = null;
  private cachedSize: SizePreferences | undefined;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private project: string | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly options: WindowStateOptions = {},
  ) {}

  private load(): void {
    if (this.placements !== undefined && this.cachedSize !== undefined) return;
    let parsed: unknown = null;
    try {
      parsed = readJsonIfExists<unknown>(windowStateFile(this.dataDir));
    } catch {
      parsed = null;
    }
    // A file written before size was tracked reads back as the defaults.
    this.placements = readProjects(parsed);
    this.legacy = readLegacy(parsed);
    this.cachedSize = readSize(parsed);
  }

  setProject(projectRoot: string | null): void {
    this.project = projectRoot === null ? null : normalizeProjectPath(projectRoot);
  }

  get projectKey(): string | null {
    return this.project;
  }

  get(): SavedPlacement | null {
    this.load();
    if (this.project === null) return null;
    return this.placements?.get(this.project) ?? null;
  }

  /** Kept but never applied; see {@link StoredWindowState}. */
  getLegacy(): SavedPlacement | null {
    this.load();
    return this.legacy;
  }

  getSize(): SizePreferences {
    this.load();
    return { ...(this.cachedSize ?? DEFAULT_SIZE_PREFERENCES) };
  }

  /** With no active project there is no key, so nothing is stored. */
  save(placement: SavedPlacement): void {
    this.load();
    if (this.project === null) return;
    this.placements?.set(this.project, placement);
    this.schedule();
  }

  saveSize(size: Partial<SizePreferences>): SizePreferences {
    this.load();
    const next = { ...(this.cachedSize ?? DEFAULT_SIZE_PREFERENCES), ...size };
    this.cachedSize = next;
    this.schedule();
    return { ...next };
  }

  private schedule(): void {
    this.dirty = true;
    const debounceMs = this.options.debounceMs ?? 400;
    if (debounceMs <= 0) {
      this.flush();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), debounceMs);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;

    const size = this.cachedSize ?? DEFAULT_SIZE_PREFERENCES;
    const stored: StoredWindowState = { version: 2, sizeMode: size.sizeMode };
    if (this.placements && this.placements.size > 0) {
      stored.projects = Object.fromEntries(this.placements);
    }
    if (this.legacy) stored.legacy = this.legacy;
    if (size.manualWidth !== null) stored.manualWidth = size.manualWidth;
    if (size.panelHeight !== null) stored.panelHeight = size.panelHeight;
    writeJsonAtomic(windowStateFile(this.dataDir), stored);
  }
}
