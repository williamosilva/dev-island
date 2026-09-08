import { PRODUCT_NAME } from '../shared/branding';

/** Plain-text output only: the CLI never prints icons or colours. */
export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function step(message: string): void {
  process.stdout.write(`  ${message}\n`);
}

export function fail(message: string): void {
  process.stderr.write(`${PRODUCT_NAME}: ${message}\n`);
}

export function heading(message: string): void {
  process.stdout.write(`${PRODUCT_NAME} - ${message}\n`);
}
