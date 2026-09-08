import { useEffect, type RefObject } from 'react';

import { bridge } from './bridge';
import { prefersReducedMotion } from './reorder-stage';

/**
 * Keeps the frameless window the size of the widget.
 *
 * Width and height come from two different places on purpose:
 *
 * - the **width** is the base width computed from the compact bar, so opening
 *   `Theme`, `Add`, `More` or a terminal can never make the window
 *   narrower (and therefore can never make fewer scripts fit, which would feed
 *   back into an ever-shrinking capsule);
 * - the **height** is measured from the rendered content, because that is the
 *   only thing a panel is allowed to change.
 *
 * A resize is sent only when a dimension actually changed, so the
 * ResizeObserver, React and `setBounds` cannot chase each other.
 *
 * The first size of all is applied whole — there is nothing on screen yet to
 * animate, and the window is only shown once it is the right size. Every later
 * change asks to be stepped, unless the user asked for less movement.
 */
export function useAutoResize(ref: RefObject<HTMLElement>, baseWidth: number): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || baseWidth <= 0) return;

    let lastWidth = 0;
    let lastHeight = 0;
    let first = true;

    const publish = (): void => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (height < 2) return;
      if (baseWidth === lastWidth && height === lastHeight) return;
      lastWidth = baseWidth;
      lastHeight = height;
      const animate = !first && !prefersReducedMotion();
      first = false;
      bridge.resizeWindow(baseWidth, height, animate);
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, baseWidth]);
}
