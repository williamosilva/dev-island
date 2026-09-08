import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const created: string[] = [];

/** Throwaway directory; every suite cleans up after itself. */
export function makeTempDir(prefix = 'dev-island-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  while (created.length > 0) {
    const dir = created.pop();
    if (!dir) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

export function writePackageJson(dir: string, value: unknown): void {
  writeFile(path.join(dir, 'package.json'), JSON.stringify(value, null, 2));
}

export function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}
