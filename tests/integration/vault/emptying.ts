import * as fs from 'fs';
import * as path from 'path';
import type { Problem } from './problem';

/**
 * The emptying of the E2E vault's folder, and the checks that it is that
 * folder. Nothing here asks Obsidian, so the checks can be tried on folders
 * of a test's own.
 *
 * A folder is emptied only when it says it is the E2E vault: a marker file
 * at its top holds the folder's own absolute path. The marker is put there
 * by hand, once, when the vault is set up on a machine; the code here never
 * makes or deletes it. A folder copied or moved elsewhere then holds a path
 * that is not its own, and a vault the user works in holds no marker.
 */

/** The marker's name at the top of the E2E vault's folder. */
export const MARKER = '.tv-e2e-vault';

/** The path with its links resolved and its letter case as on disk, or null when there is nothing at it. */
function realPath(p: string): string | null {
    try {
        return fs.realpathSync.native(p);
    } catch {
        return null;
    }
}

/** Whether `inner` is `outer` or lies inside it. */
function within(inner: string, outer: string): boolean {
    const rel = path.relative(outer, inner);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Why `folder` may not be emptied, or null when it may. `kept` are folders
 * that are never emptied, whatever their markers say (the vaults the user
 * works in): the folder may be none of them, lie in none, and hold none.
 */
export function whyNotEmptiable(folder: string, kept: readonly string[]): Problem | null {
    const real = realPath(folder);
    if (real === null || !fs.statSync(real).isDirectory()) {
        return {
            what: `the E2E vault's folder ${folder} is not there`,
            fix: 'make the folder and set it up as an E2E vault (DEVELOPER.md, the E2E vault)',
        };
    }
    for (const k of kept) {
        const keptReal = realPath(k) ?? path.resolve(k);
        if (within(real, keptReal) || within(keptReal, real)) {
            return {
                what: `the E2E vault's folder ${real} is, lies in, or holds ${keptReal}, a vault that is never emptied`,
                fix: 'give the E2E vault a folder of its own (`E2E_PATHS` in dev-paths.mjs)',
            };
        }
    }
    const markerPath = path.join(real, MARKER);
    let written: string;
    try {
        written = fs.readFileSync(markerPath, 'utf-8').trim();
    } catch {
        return {
            what: `${real} has no ${MARKER}, which marks the folder as the E2E vault`,
            fix: `when the folder is the E2E vault, put ${MARKER} at its top holding its absolute path (DEVELOPER.md, the E2E vault)`,
        };
    }
    const writtenReal = path.isAbsolute(written) ? realPath(written) : null;
    if (writtenReal !== real) {
        return {
            what: `${markerPath} holds ${JSON.stringify(written)}, not the path of the folder it is in (${real})`,
            fix: `when the folder is the E2E vault, write its absolute path into ${MARKER}`,
        };
    }
    return null;
}

/**
 * Delete everything in `folder` but the marker, once `whyNotEmptiable`
 * finds nothing against it; otherwise delete nothing and say why.
 */
export function emptyVaultFolder(folder: string, kept: readonly string[]): Problem | null {
    const refusal = whyNotEmptiable(folder, kept);
    if (refusal) return refusal;
    const real = fs.realpathSync.native(folder);
    for (const name of fs.readdirSync(real)) {
        if (name === MARKER) continue;
        // A link is deleted, not what it points to.
        fs.rmSync(path.join(real, name), { recursive: true, force: true });
    }
    return null;
}
