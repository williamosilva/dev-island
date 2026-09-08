import type { DevIslandApi } from '../shared/api';

declare global {
  interface Window {
    devIsland: DevIslandApi;
  }
}

function resolve(): DevIslandApi {
  const api = (globalThis as { window?: { devIsland?: DevIslandApi } }).window?.devIsland;
  if (!api) throw new Error('The preload bridge is not available.');
  return api;
}

/**
 * The only way the UI reaches the main process.
 *
 * Resolved on first use rather than at import time, so a renderer module can be
 * imported in a plain Node test without a `window` around it.
 */
export const bridge: DevIslandApi = new Proxy({} as DevIslandApi, {
  get: (_target, property) => Reflect.get(resolve(), property),
});
