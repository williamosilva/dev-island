/**
 * Minimal stand-in for the parts of Electron the window modules touch.
 * `vitest.config.ts` aliases `electron` to this file, so the placement logic
 * can be exercised with fully controlled monitors and windows.
 */
export interface StubDisplay {
  id: number;
  workArea: { x: number; y: number; width: number; height: number };
}

const PRIMARY: StubDisplay = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };

let displays: StubDisplay[] = [PRIMARY];

export const screen = {
  getPrimaryDisplay(): StubDisplay {
    return displays[0] ?? PRIMARY;
  },
  /** Picks the display whose work area contains the rectangle's centre. */
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): StubDisplay {
    const centreX = rect.x + rect.width / 2;
    const centreY = rect.y + rect.height / 2;
    return (
      displays.find(
        (display) =>
          centreX >= display.workArea.x &&
          centreX < display.workArea.x + display.workArea.width &&
          centreY >= display.workArea.y &&
          centreY < display.workArea.y + display.workArea.height,
      ) ??
      displays[0] ??
      PRIMARY
    );
  },
};

export function setStubDisplays(list: StubDisplay[]): void {
  displays = list.length > 0 ? list : [PRIMARY];
}

export function resetStubDisplays(): void {
  displays = [PRIMARY];
}

export const app = {};
export const ipcMain = {};
export const nativeTheme = { shouldUseDarkColors: false };
export class BrowserWindow {}
