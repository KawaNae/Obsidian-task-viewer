import type { CliData, CliFlags } from 'obsidian';
import { suggestKey } from '../api/OperationSchemas';
import { cliError } from './CliOutputFormatter';
import { issueText } from '../utils/values/IssueText';

/**
 * Keys injected by the Obsidian CLI framework itself, exempt from strict
 * validation. Verified empirically (2026-07-03, Obsidian 1.12): `vault=` is
 * consumed by the framework and never reaches handler params, so the
 * allowlist is currently empty. The e2e suite doubles as a canary — every
 * call goes through `vault=dev`, so an injected key would fail all of them.
 */
const FRAMEWORK_KEYS: ReadonlySet<string> = new Set();

/**
 * Strict CLI parameter validation, applied to every command by the
 * registrar's handler wrapper. Unknown flags and values on boolean flags
 * error instead of being silently ignored — a typo like `statuss=x` used to
 * return a successful-looking unfiltered result.
 *
 * Returns a cliError JSON string, or null when the params are valid.
 */
export function validateCliParams(
    params: CliData,
    flags: CliFlags | null,
    command: string,
): string | null {
    const known = flags ? Object.keys(flags) : [];
    for (const key of Object.keys(params)) {
        if (FRAMEWORK_KEYS.has(key)) continue;
        if (!flags || !(key in flags)) {
            if (known.length === 0) {
                return cliError(`Unknown flag: ${key}. '${command}' takes no flags`);
            }
            const suggestion = suggestKey(key, known);
            return cliError(
                `Unknown flag: ${key}.` +
                (suggestion ? ` Did you mean: ${suggestion}?` : ` Available flags: ${known.join(', ')}`),
            );
        }
        if (!flags[key].value && params[key] !== 'true') {
            return cliError(`Flag '${key}' is a boolean flag and does not take a value. Pass '${key}' alone`);
        }
    }
    return null;
}

/**
 * A flag written with `=` and nothing after it (`count=`), refused for every
 * command, whatever the flag. An empty value is taken neither as the flag
 * left out (its default) nor as a value: leaving a flag out is how the
 * default is asked for. A flag given alone is not empty (`'true'`).
 *
 * Returns a cliError JSON string, or null when no flag is empty.
 */
export function refuseEmptyFlags(params: CliData): string | null {
    for (const [key, value] of Object.entries(params)) {
        if (value === '') return cliError(issueText({ code: 'empty' }, key));
    }
    return null;
}
