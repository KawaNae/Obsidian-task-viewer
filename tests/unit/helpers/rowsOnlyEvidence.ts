import { contentKeyOf, type ContentKey } from '../../../src/services/core/identity/ContentKey';
import { ledgerState, type ClaimedRow, type ExactState, type Reading } from '../../../src/services/core/identity/IdentityHints';
import type { LedgerEntry } from '../../../src/services/core/identity/IdentityLedger';
import type { Task } from '../../../src/types';

/** A write's record as the rule tests build it: its rows, and the content it left when that is not just its rows. */
export interface RecordOf {
    rows: ClaimedRow[];
    content?: ContentKey;
}

/**
 * The reading a scan would make of a file that holds nothing but its task rows.
 *
 * The rule tests build tasks and records without a file behind them. In a
 * file made only of rows, the whole content and the row texts say the same
 * thing, so each record, the previous scan and this read are given the key of
 * their row texts. The known states whose content is the read are the ones in
 * the running (see `WriteClaims.reading`); the read may be a change after the
 * newest of them when none has its content, or when `outside` says a change
 * nobody reported came after them. What the content adds when lines other
 * than rows differ is pinned with real files elsewhere.
 *
 * A record that already carries a content keeps it.
 */
export function rowsOnlyReading(
    previous: readonly LedgerEntry[],
    tasks: readonly Task[],
    records: readonly RecordOf[],
    options: { outside?: boolean; partner?: readonly LedgerEntry[] } = {},
): Reading {
    const ordered = [...tasks].sort((a, b) => a.line - b.line);
    const read = rowsKey(ordered.map(task => task.originalText));
    const states: ExactState[] = [];
    if (rowsKey(previous.map(entry => entry.fingerprint.originalText)) === read) states.push(ledgerState(previous));
    for (const record of records) {
        if (contentOf(record) === read) states.push({ rows: record.rows });
    }
    return {
        states,
        after: states.length === 0 || options.outside === true,
        partner: options.partner ?? previous,
    };
}

/** The key of the content a record left, in a file made only of rows. */
export function contentOf(record: RecordOf): ContentKey {
    return record.content ?? rowsKey(record.rows.map(row => row.text));
}

function rowsKey(texts: readonly string[]): ContentKey {
    return contentKeyOf(texts);
}
