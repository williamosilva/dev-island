import type { ThemeName } from '../shared/types';

/**
 * The two palettes, kept in TypeScript so the CSS has a single source of truth
 * and the values can be asserted in tests. `applyThemeTokens` writes them as
 * custom properties; `styles.css` only ever reads `var(--di-*)`.
 */
/**
 * Two palettes, quiet and precise.
 *
 * The surfaces (`bg`, `bgElevated`, `bgTerminal`, `bgInput`) are opaque: the
 * capsule floats over the editor and its text has to stay readable whatever is
 * behind it. The interaction tints (`hover`, `active`) and the `border` are
 * deliberately translucent instead, so they read the same on either surface
 * without needing a second set of colours.
 */
export interface ThemeTokens {
  /** Opaque on purpose: the editor must not show through. */
  bg: string;
  bgElevated: string;
  bgTerminal: string;
  bgInput: string;
  border: string;
  text: string;
  textMuted: string;
  textDisabled: string;
  hover: string;
  active: string;
  accent: string;
  running: string;
  danger: string;
  shadow: string;
  /**
   * The two hairlines that give the capsule its depth.
   *
   * They are `inset`, deliberately: the window is exactly the size of the
   * capsule, so an outer shadow has nowhere to fade into and is cut off at the
   * window's rectangular edge — which is the rectangle showing through.
   */
  insetTop: string;
  insetBottom: string;
  selection: string;
}

export const THEME_TOKENS: Record<ThemeName, ThemeTokens> = {
  dark: {
    bg: '#090909',
    bgElevated: '#151515',
    bgTerminal: '#0c0c0c',
    bgInput: '#1c1c1e',
    border: 'rgba(255, 255, 255, 0.10)',
    text: '#f5f5f7',
    textMuted: '#a1a1a6',
    textDisabled: '#6e6e73',
    hover: 'rgba(255, 255, 255, 0.08)',
    active: 'rgba(255, 255, 255, 0.13)',
    accent: '#0a84ff',
    running: '#30d158',
    danger: '#ff453a',
    shadow: 'rgba(0, 0, 0, 0.55)',
    insetTop: 'rgba(255, 255, 255, 0.07)',
    insetBottom: 'rgba(0, 0, 0, 0.35)',
    selection: 'rgba(10, 132, 255, 0.32)',
  },
  light: {
    bg: '#fbfbfd',
    bgElevated: '#ffffff',
    bgTerminal: '#ffffff',
    bgInput: '#ffffff',
    border: 'rgba(0, 0, 0, 0.10)',
    text: '#1d1d1f',
    textMuted: '#6e6e73',
    textDisabled: '#aeaeb2',
    hover: 'rgba(0, 0, 0, 0.055)',
    active: 'rgba(0, 0, 0, 0.10)',
    accent: '#0071e3',
    running: '#248a3d',
    danger: '#d70015',
    shadow: 'rgba(0, 0, 0, 0.14)',
    insetTop: 'rgba(255, 255, 255, 0.90)',
    insetBottom: 'rgba(0, 0, 0, 0.07)',
    selection: 'rgba(0, 113, 227, 0.22)',
  },
};

/** `bgElevated` -> `--di-bg-elevated`. */
export function cssVariableName(token: keyof ThemeTokens): string {
  return `--di-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export interface StyleTarget {
  style: { setProperty(property: string, value: string): void };
  setAttribute(name: string, value: string): void;
}

export function applyThemeTokens(target: StyleTarget, theme: ThemeName): ThemeTokens {
  const tokens = THEME_TOKENS[theme];
  for (const [token, value] of Object.entries(tokens)) {
    target.style.setProperty(cssVariableName(token as keyof ThemeTokens), value);
  }
  // Lets the stylesheet key off the theme where a variable is not enough.
  target.setAttribute('data-theme', theme);
  return tokens;
}

export function terminalTheme(theme: ThemeName): {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
} {
  const tokens = THEME_TOKENS[theme];
  return {
    background: tokens.bgTerminal,
    foreground: tokens.text,
    cursor: tokens.text,
    selectionBackground: tokens.selection,
  };
}
