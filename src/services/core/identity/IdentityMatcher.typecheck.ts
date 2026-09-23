import type { Task } from '../../../types';
import type { LedgerEntry } from './IdentityLedger';
import { matchFile } from './IdentityMatcher';

/**
 * Compile-time checks on `matchFile`'s signature. Nothing imports this file,
 * so it is never bundled; `tsc` reads it with the rest of `src` (the build runs
 * `tsc -noEmit` first), and a check that stops holding fails the build.
 *
 * Each `@ts-expect-error` is the check: it is itself an error when the line
 * under it compiles.
 */
export function matchFileSignatureChecks(previous: LedgerEntry[], tasks: Task[], mint: (task: Task) => string): void {
    // A scan that leaves the evidence out would drop every pending claim
    // without a word, so leaving it out does not compile.
    // @ts-expect-error evidence is required
    matchFile(previous, tasks, mint);

    // Claims alone, without the contents they are weighed against, do not
    // compile either.
    // @ts-expect-error before and read are required
    matchFile(previous, tasks, mint, { pending: [] }, previous);

    // A scan that leaves out what the ladder pairs against would pair against
    // the ledger however far our own writes have moved the file past it.
    // @ts-expect-error the ladder's partner is required
    matchFile(previous, tasks, mint, { pending: [], before: null, read: '' });
}
