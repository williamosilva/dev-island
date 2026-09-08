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

Uso:
  ${PRODUCT_ID} setup                      configuração global, uma única vez
  ${PRODUCT_ID} start                      inicia o widget em segundo plano
  ${PRODUCT_ID} stop                       encerra o widget e seus terminais
  ${PRODUCT_ID} init                       sincroniza/repara o projeto atual (opcional)
  ${PRODUCT_ID} remove-shell-integration   remove o bloco criado no perfil do PowerShell

Depois de "${PRODUCT_ID} setup", qualquer projeto Node aberto em um terminal
integrado do VS Code é detectado automaticamente: "${PRODUCT_ID} init" não é
mais necessário.

Opções:
  --no-start       não abre o widget ao final (setup e init)
  --preview        permite exibir o widget fora do VS Code (só para testes)
  -h, --help       mostra esta ajuda
  -v, --version    mostra a versão
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
    fail('o MVP suporta apenas Windows com PowerShell.');
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
      fail(`comando desconhecido "${command}".`);
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
      fail((error as Error)?.message ?? 'erro inesperado');
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void run();
}
