import * as path from 'path';
import { E2E_PATHS } from '../../../dev-paths.mjs';

/**
 * Where the E2E suite's vault is, and the name the Obsidian CLI knows it by.
 * Every test reaches the vault through these two, so the suite never drives
 * a vault the user works in.
 */

/** The folder of the E2E vault, emptied and written again on every run. */
export const VAULT_PATH: string = E2E_PATHS.vault;

/**
 * The vault's name for the CLI's `vault=`. The CLI picks the vault whose
 * folder has this name, letter case aside, and no vault whose name merely
 * contains it.
 */
export const VAULT_NAME: string = path.basename(VAULT_PATH);
