import { contentKeyOf, type ContentKey } from '../../../src/services/core/ContentKey';
import type { Hint, HintEvidence, PendingHint } from '../../../src/services/core/identity/IdentityHints';
import type { LedgerEntry } from '../../../src/services/core/identity/IdentityLedger';
import type { Task } from '../../../src/types';

/**
 * Evidence for a file that holds nothing but its task rows.
 *
 * The rule tests build tasks and claims without a file behind them. In a file
 * made only of rows, the whole content and the row texts say the same thing,
 * so each claim, the previous scan and this read are given the key of their
 * row texts. What those tests pin — which candidates conflict, what is
 * adopted, what the log keeps — is then asked exactly as before; what the
 * content adds when lines other than rows differ is pinned with real files
 * elsewhere.
 *
 * A claim that already carries a content keeps it.
 */
export function rowsOnlyEvidence(
    previous: readonly LedgerEntry[],
    tasks: readonly Task[],
    pending: readonly PendingHint[],
): HintEvidence {
    const ordered = [...tasks].sort((a, b) => a.line - b.line);
    return {
        pending: pending.map(entry => ({ ...entry, hint: withRowsContent(entry.hint) })),
        before: rowsKey(previous.map(entry => entry.fingerprint.originalText)),
        read: rowsKey(ordered.map(task => task.originalText)),
    };
}

/** A claim about a file made only of its rows. */
export function withRowsContent(hint: Omit<Hint, 'content'> & { content?: ContentKey }): Hint {
    return { content: hint.content ?? rowsKey(hint.rows.map(row => row.text)), rows: hint.rows };
}

function rowsKey(texts: readonly string[]): ContentKey {
    return contentKeyOf(texts);
}
