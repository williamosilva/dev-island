/**
 * Single source of truth for the product name.
 *
 * Everything user-visible (window title, CLI banner, PowerShell block markers,
 * user-data folder, named pipe) derives from the constants below, so renaming
 * the tool later is a one-file change.
 */

export const PRODUCT_NAME = 'Dev Island';

/** Also the npm package, the bin name and the user-data folder. */
export const PRODUCT_ID = 'dev-island';

export const PROJECT_DIR = `.${PRODUCT_ID}`;

export const BUTTONS_FILE = 'buttons.json';

/**
 * Version of the managed PowerShell block. Bump it whenever the hook gains a
 * capability, so `init` can tell an old block apart from a current one.
 */
export const SHELL_BLOCK_VERSION = 3;

/**
 * Markers wrapped around the block appended to the PowerShell profile.
 * The begin marker carries the version; {@link SHELL_BLOCK_BEGIN_PREFIX} is
 * what matching uses, so blocks written by earlier versions are still found
 * and replaced (or removed) instead of piling up.
 */
export const SHELL_BLOCK_BEGIN_PREFIX = `# >>> ${PRODUCT_NAME} integration`;
export const SHELL_BLOCK_BEGIN = `${SHELL_BLOCK_BEGIN_PREFIX} v${SHELL_BLOCK_VERSION} >>>`;
export const SHELL_BLOCK_END = `# <<< ${PRODUCT_NAME} integration <<<`;

/** Suffixed with the current user at runtime. */
export const PIPE_BASENAME = PRODUCT_ID;

/** Environment variable used to point a run at an isolated data directory. */
export const DATA_DIR_ENV = 'DEV_ISLAND_DATA_DIR';

export const DEV_SERVER_ENV = 'DEV_ISLAND_DEV_SERVER_URL';
