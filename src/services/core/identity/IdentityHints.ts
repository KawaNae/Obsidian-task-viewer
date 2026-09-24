import type { Task } from '../../../types';
import type { LedgerEntry } from './IdentityLedger';
import { Outline } from '../../parsing/utils/Outline';

/**
 * What a scan knows about the states a file may be in when it reads it, and
 * how it tells whether the lines it read are one of them.
 *
 * The plugin's own writes say what they left: the whole row list, and the
 * content it sits in (see `WriteClaims`). A write's record is a claim, not an
 * instruction — "after this write, the file's task rows read like this" —
 * and it is checked against what the scan actually read before it counts.
 * The last scan's ledger says the same about the state it read. Both are
 * states the read may be of, and the one rule for all of them lives here and
 * in `matchFile`: a state counts only if it reproduces the read whole, and
 * when more than one reading of the lines is open, a row keeps a name only
 * where every reading gives it that name.
 *
 * Two earlier designs said a claim the other way round — a multiset of line
 * texts matched by recorded line numbers, then a list of per-line edits
 * replayed over the previous rows. Both made the reader reconstruct a state
 * the writer already knew. The writer knows the answer; letting it say the
 * answer is shorter than any scheme for re-deriving it.
 *
 * Records are filed inside the `vault.process` callback, the only place where
 * the written text is settled and the `modify` event has not fired yet — a
 * record filed after the `await` is too late for the scan that write
 * triggers (measured: the scan's read starts before `vault.process`
 * resolves).
 */

/** One task row of a file, as a state of it reads. */
export interface ClaimedRow {
    /** The row that carries this line's identity. */
    runtimeId: string;
    /**
     * Whether no scan has recorded this row yet — a write made the line, and
     * named it on the spot.
     *
     * The name is the write's to give, so the ledger not holding it is the
     * normal case rather than evidence against the state. It is not a promise
     * that the ledger has never held it: a scan can commit a created row and a
     * later record still carry it, which is the case this flag exists to
     * survive.
     */
    created: boolean;
    text: string;
}

/** A state the read may be, whole: its task rows in the order a scan matches them. */
export interface ExactState {
    rows: readonly ClaimedRow[];
}

/**
 * Every way the lines a scan read may be told, from where they stand among
 * the states known (see `WriteClaims.reading`).
 *
 * - `states`: the known states whose content is the content read — the
 *   ledger's, and the records of our writes. Each is the read if nothing
 *   changed the file after it; one followed by a change nobody reported is
 *   the read only if that change put the file back.
 * - `after`: the read may be a change made after the newest state known —
 *   no known state has its content, or one does and a change nobody
 *   reported came after it. The ladder then pairs against `partner`, the
 *   newest known state's rows.
 */
export interface Reading {
    states: readonly ExactState[];
    after: boolean;
    partner: readonly LedgerEntry[];
}

/** A reading that tells nothing: every row is new. */
export const UNKNOWN_READING: Reading = { states: [], after: true, partner: [] };

/**
 * True when the state is what was read: its rows, line for line and in order,
 * are the rows read. The content has already been compared by key; the rows
 * are checked as well because a key two contents shared would still have to
 * reproduce every row's text before it decided anything.
 */
export function reproduces(
    state: ExactState,
    tasks: readonly Task[],
    byRuntimeId: ReadonlyMap<string, LedgerEntry>,
): boolean {
    const rows = state.rows;
    if (rows.length !== tasks.length) return false;

    const spoken = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
        if (!Outline.VERBATIM.holds(rows[i].text, tasks[i].originalText)) return false;

        const runtimeId = rows[i].runtimeId;
        // One row, one line. A state that puts the same identity on two lines
        // is a state no file can bear out, and believing it would leave two
        // tasks answering to one name — the ledger would hold the number twice
        // and every lookup by it would find whichever came first. The ladder
        // cannot produce this (it takes each previous row once), so this is
        // the only door it could come through. It holds for a created row as
        // much as a continued one.
        if (spoken.has(runtimeId)) return false;
        spoken.add(runtimeId);

        const entry = byRuntimeId.get(runtimeId);
        if (!entry) {
            // A row the ledger no longer holds was built on a generation this
            // scan has left behind — unless the write itself named it, in
            // which case no scan has had the chance to record it yet and its
            // absence says nothing at all.
            if (!rows[i].created) return false;
            // No parser check for this one. The name carries a parserId, but
            // the write burned it in from its own parse — comparing it here
            // would check the write against itself rather than against
            // anything the file says. The row is checked on its text like
            // every other, and the question disappears at stage 3, where
            // names stop carrying a parserId at all.
            continue;
        }
        // Never across parsers, the rule every rung of the ladder follows.
        // Turning a third-party notation off can leave the text identical and
        // the parser different. A created row whose name the ledger does hold
        // is one an earlier scan already committed, and it answers here on the
        // same terms as any other.
        if (entry.fingerprint.parserId !== tasks[i].parserId) return false;
    }

    return true;
}

/** The ledger's rows as a state of the file: the one the last scan read. */
export function ledgerState(rows: readonly LedgerEntry[]): ExactState {
    return {
        rows: rows.map(entry => ({
            runtimeId: entry.runtimeId,
            created: false,
            text: entry.fingerprint.originalText,
        })),
    };
}
