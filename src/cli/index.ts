import { PRODUCT_ID, PRODUCT_NAME } from '../shared/branding';
import { ProjectError } from '../core/project';
import { UnsupportedPlatformError } from '../core/shell-adapter';
import { runInit } from './commands/init';
import { runSetup } from './commands/setup';
import { runRemoveShellIntegration } from './commands/remove-shell-integration';
import { runStart } from './commands/start';
import { runStop } from './commands/stop';
import { fail, info } from './ui';

const VERSION = '0.1.0';

const USAGE = `${PRODUCT_NAME} ${VERSION}

Usage:
  ${PRODUCT_ID} setup                      one-time global setup
  ${PRODUCT_ID} start                      starts the widget in the background
  ${PRODUCT_ID} stop                       stops the widget and its terminals
  ${PRODUCT_ID} init                       syncs/repairs the current project (optional)
  ${PRODUCT_ID} remove-shell-integration   removes the block added to the PowerShell profile

After "${PRODUCT_ID} setup", any Node project opened in a VS Code integrated
terminal is detected automatically: "${PRODUCT_ID} init" is no longer needed.

Options:
  --no-start       does not open the widget at the end (setup and init)
  --preview        allows showing the widget outside VS Code (for testing only)
  -h, --help       shows this help
  -v, --version    shows the version
`;

export async function main(argv: readonly string[]): Promise<number> {
  const args = [...argv];
  const command = args.find((arg) => !arg.startsWith('-'));
  const flags = new Set(args.filter((arg) => arg.startsWith('-')));

  if (flags.has('-v') || flags.has('--version')) {
    info(VERSION);
    return 0;
  }
  if (flags.has('-h') || flags.has('--help') || command === 'help') {
    info(USAGE);
    return 0;
  }
  if (!command) {
    info(USAGE);
    return 1;
  }

  if (process.platform !== 'win32') {
    fail('this tool only supports Windows with PowerShell.');
    return 1;
  }

  switch (command) {
    case 'setup':
      return runSetup({ noStart: flags.has('--no-start') });
    case 'init':
      return runInit({
        cwd: process.cwd(),
        noStart: flags.has('--no-start'),
      });
    case 'start':
      return runStart({ cwd: process.cwd() });
    case 'stop':
      return runStop();
    case 'remove-shell-integration':
      return runRemoveShellIntegration();
    default:
      fail(`unknown command "${command}".`);
      info(USAGE);
      return 1;
  }
}

export async function run(): Promise<void> {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ProjectError || error instanceof UnsupportedPlatformError) {
      fail(error.message);
    } else {
      fail((error as Error)?.message ?? 'unexpected error');
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void run();
}
