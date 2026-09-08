/**
 * Development launcher: compiles the Node-side code, serves the renderer with
 * Vite and starts Electron pointing at that dev server.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

function compileNodeSide() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsc, '-p', 'tsconfig.node.json'], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tsc saiu com ${code}`))));
  });
}

async function main() {
  await compileNodeSide();

  const server = await createServer({ configFile: path.join(root, 'vite.config.ts') });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error('Vite não retornou uma URL local.');
  console.log(`renderer: ${url}`);

  const electron = spawn(electronPath, [root], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DEV_ISLAND_DEV_SERVER_URL: url,
    },
  });

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  electron.on('exit', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
