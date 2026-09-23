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
    // A scan that leaves the reading out would forget every write of ours it
    // knows of without a word, so leaving it out does not compile.
    // @ts-expect-error the reading is required
    matchFile(previous, tasks, mint);

    // Known states alone, without saying whether the read may be a change
    // after them, do not compile either.
    // @ts-expect-error after is required
    matchFile(previous, tasks, mint, { states: [], partner: previous });

    // A scan that leaves out what the ladder pairs against would pair against
    // the ledger however far our own writes have moved the file past it.
    // @ts-expect-error the ladder's partner is required
    matchFile(previous, tasks, mint, { states: [], after: true });
}
