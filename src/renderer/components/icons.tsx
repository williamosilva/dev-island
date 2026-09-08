/**
 * The only icons in the widget: theme, add and close, plus the six-dot grip.
 * They are inline SVG drawn with `currentColor`, so they follow the theme and
 * no icon library is pulled in for four shapes. Scripts stay textual.
 */
const SVG_PROPS = {
  width: 14,
  height: 14,
  viewBox: '0 0 14 14',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

export function PlusIcon(): JSX.Element {
  return (
    <svg {...SVG_PROPS}>
      <path d="M7 2.6v8.8M2.6 7h8.8" />
    </svg>
  );
}

export function CloseIcon(): JSX.Element {
  return (
    <svg {...SVG_PROPS}>
      <path d="M3.4 3.4l7.2 7.2M10.6 3.4l-7.2 7.2" />
    </svg>
  );
}

/** Shown while the light theme is active. */
export function SunIcon(): JSX.Element {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="7" cy="7" r="2.6" />
      <path d="M7 1v1.4M7 11.6V13M1 7h1.4M11.6 7H13M2.76 2.76l1 1M10.24 10.24l1 1M11.24 2.76l-1 1M3.76 10.24l-1 1" />
    </svg>
  );
}

/** Shown while the dark theme is active. */
export function MoonIcon(): JSX.Element {
  return (
    <svg {...SVG_PROPS}>
      <path d="M11.6 8.4A5 5 0 0 1 5.6 2.4a5 5 0 1 0 6 6z" />
    </svg>
  );
}

/** The grip is two columns of three dots. */
export const GRIP_DOT_COUNT = 6;
