#!/usr/bin/env node
'use strict';

// Thin launcher so the published bin never depends on a build step at runtime.
const path = require('node:path');
const fs = require('node:fs');

const entry = path.join(__dirname, '..', 'dist', 'cli', 'index.js');
if (!fs.existsSync(entry)) {
  process.stderr.write('dev-island: build missing. Run "npm run build" in the package.\n');
  process.exit(1);
}

require(entry).run();
