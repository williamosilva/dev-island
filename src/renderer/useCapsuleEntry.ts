import { useEffect, useState } from 'react';

/** Matches `--di-capsule-in`; the class comes off once the arrival is over. */
export const CAPSULE_ENTRY_MS = 200;

/**
 * True while the capsule is playing its arrival.
 *
 * The trigger is the page becoming visible, which in Electron follows the
 * window itself being shown — and the window is only shown once it has been
 * placed. So the animation always starts from the final position: it is the
 * capsule that moves, never the window, and there is no jump between
 * coordinates for the eye to catch.
 *
 * Hiding is deliberately not animated. The widget disappears the moment the
 * user leaves VS Code, and nothing here may delay that.
 */
export function useCapsuleEntry(): boolean {
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') {
        // Hidden again: drop the class so the next arrival can replay it.
        if (timer !== null) clearTimeout(timer);
        timer = null;
        setEntering(false);
        return;
      }
      setEntering(true);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setEntering(false);
      }, CAPSULE_ENTRY_MS);
    };

    document.addEventListener('visibilitychange', onVisibility);
    // Already visible on the very first paint: arrive now.
    if (document.visibilityState === 'visible') onVisibility();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  return entering;
}
