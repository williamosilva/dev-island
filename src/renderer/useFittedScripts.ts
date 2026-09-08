import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { barWidth, BAR_CHROME, BAR_GAP, fitButtons, type FitResult } from './fit';

export interface FittedScripts extends FitResult {
  /** Width the window must have, derived from the compact bar alone. */
  baseWidth: number;
  /** Attach to the hidden row that mirrors the real bar. */
  measureRef: RefObject<HTMLDivElement>;
  /** Call after the measured content changed. */
  remeasure(): void;
}

interface Measurement extends FitResult {
  baseWidth: number;
}

function widthOf(element: Element | null | undefined): number {
  return element instanceof HTMLElement ? element.getBoundingClientRect().width : 0;
}

/**
 * Decides how many script buttons the compact bar can show.
 *
 * Every width is read from a hidden copy of the real elements, so the answer
 * follows the actual font, the Windows display scale and the length of each
 * script name — never a hard-coded count. The budget comes from `maxWidth`
 * (derived from the VS Code window), not from the current window width, so
 * measuring cannot feed back into resizing.
 */
export function useFittedScripts(count: number, maxWidth: number): FittedScripts {
  const measureRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<Measurement>({
    visibleCount: count,
    hiddenCount: 0,
    baseWidth: 0,
  });

  const remeasure = useCallback(() => {
    const root = measureRef.current;
    if (!root) return;

    const input = {
      maxWidth,
      projectWidth: widthOf(root.querySelector('[data-measure="project"]')),
      controlsWidth: widthOf(root.querySelector('[data-measure="controls"]')),
      moreWidth: widthOf(root.querySelector('[data-measure="more"]')),
      buttonWidths: [...root.querySelectorAll('[data-measure="script"]')].map(widthOf),
      gap: BAR_GAP,
      chrome: BAR_CHROME,
    };
    const fit = fitButtons(input);
    const next: Measurement = { ...fit, baseWidth: barWidth(input, fit) };

    setResult((current) =>
      current.visibleCount === next.visibleCount &&
      current.hiddenCount === next.hiddenCount &&
      current.baseWidth === next.baseWidth
        ? current
        : next,
    );
  }, [maxWidth]);

  useEffect(() => {
    remeasure();
    const root = measureRef.current;
    if (!root) return;

    const observer = new ResizeObserver(() => remeasure());
    observer.observe(root);
    for (const child of root.children) observer.observe(child);
    return () => observer.disconnect();
  }, [remeasure, count]);

  // Fonts land after the first paint and change every measured width.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (!fonts?.ready) return;
    let cancelled = false;
    void fonts.ready.then(() => {
      if (!cancelled) remeasure();
    });
    return () => {
      cancelled = true;
    };
  }, [remeasure]);

  return { ...result, measureRef, remeasure };
}
