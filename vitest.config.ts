import * as path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Window placement talks to Electron's `screen`; the stub gives the tests
      // deterministic monitors without launching Electron.
      electron: path.resolve(__dirname, 'tests/stubs/electron.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each suite creates its own temp directory; running them in parallel is safe.
    reporters: 'default',
  },
});
