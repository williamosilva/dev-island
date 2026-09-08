import { resolveDataDir } from '../../core/paths';
import { uninstallShellIntegration } from '../shell-setup';
import { heading, step } from '../ui';

export function runRemoveShellIntegration(): number {
  const dataDir = resolveDataDir();
  heading('remove-shell-integration');

  let problems = 0;
  for (const result of uninstallShellIntegration({ dataDir })) {
    step(
      result.removed
        ? `bloco removido de ${result.profilePath}`
        : `nada a remover em ${result.profilePath}`,
    );
    if (result.unterminated) {
      problems += 1;
      step(
        `warning: start marker without an end marker in ${result.profilePath}. ` +
          'Nothing was removed; check the file by hand.',
      );
    }
    if (result.hookScriptRemoved) step('script de hook removido');
  }
  return problems > 0 ? 1 : 0;
}
