import * as path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The production HTML ships a strict CSP. The dev server needs inline scripts
 * and a websocket for HMR, so the meta tag is stripped while serving.
 */
function relaxCspInDev(): Plugin {
  return {
    name: 'dev-island:relax-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '');
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  // Electron loads the bundle from disk, so every asset URL must be relative.
  base: './',
  plugins: [react(), relaxCspInDev()],
  clearScreen: false,
  server: {
    port: 5199,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome128',
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/index.html'),
    },
  },
});
