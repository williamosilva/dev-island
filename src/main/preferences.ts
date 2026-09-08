import { readJsonIfExists, writeJsonAtomic } from '../core/fs-atomic';
import { uiPreferencesFile } from '../core/paths';
import type { ThemeName } from '../shared/types';

export const THEMES: readonly ThemeName[] = ['light', 'dark'];

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

interface StoredPreferences {
  version: 1;
  /** Absent until the user picks a theme by hand. */
  theme?: ThemeName;
}

/**
 * UI preferences that outlive the process.
 *
 * The system theme is consulted only to pick a starting point. Once the user
 * chooses, that choice wins for good: hiding the widget, switching projects and
 * restarting the app all keep it, and the app never falls back to the system
 * theme again.
 */
export class PreferencesStore {
  private cached: StoredPreferences | null = null;

  constructor(
    private readonly dataDir: string,
    /** `nativeTheme.shouldUseDarkColors` in production; injected in tests. */
    private readonly systemPrefersDark: () => boolean,
  ) {}

  private load(): StoredPreferences {
    if (this.cached) return this.cached;
    let parsed: unknown = null;
    try {
      parsed = readJsonIfExists<unknown>(uiPreferencesFile(this.dataDir));
    } catch {
      parsed = null;
    }
    const theme = (parsed as { theme?: unknown } | null)?.theme;
    this.cached = isThemeName(theme) ? { version: 1, theme } : { version: 1 };
    return this.cached;
  }

  /** False while the theme still comes from Windows. */
  hasExplicitTheme(): boolean {
    return this.load().theme !== undefined;
  }

  getTheme(): ThemeName {
    const stored = this.load().theme;
    if (stored) return stored;
    return this.systemPrefersDark() ? 'dark' : 'light';
  }

  /** Records an explicit choice. Unknown values are ignored. */
  setTheme(theme: unknown): ThemeName {
    if (!isThemeName(theme)) return this.getTheme();
    this.cached = { version: 1, theme };
    writeJsonAtomic(uiPreferencesFile(this.dataDir), this.cached);
    return theme;
  }
}
