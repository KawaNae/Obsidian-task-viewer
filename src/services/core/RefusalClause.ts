import { t } from '../../i18n';
import type { Refusal, RefusalReason } from '../persistence/FileLines';
import type { ContentKey } from './ContentKey';

/**
 * Why an operation planned from the index's copy of a row was given up before
 * it was planned: the check of the copy against the disk (`ReadingCheck`)
 * found the note changed in a way the index had not read (`stale`; `disk` is
 * the key of what the disk holds), or could not read it (`unreadable`).
 * Never a write's own reason: the write layer knows nothing of the check.
 */
export type CheckReason =
    | { kind: 'stale'; disk: ContentKey }
    | { kind: 'unreadable' };

/**
 * An operation the index did not make, as it is told (`TaskIndex.reportRefusal`):
 * refused by the write, or given up by the check before it.
 */
export type IndexRefusal = Omit<Refusal, 'reason'> & { reason: RefusalReason | CheckReason };

/**
 * Why a write was refused, as a clause: the one table of the reasons, which
 * every notice of a refusal gives in its own frame — a write not made
 * (`TaskIndex.reportRefusal`), a completion written without its flow
 * (`FlowExecutor.reportNotRun`).
 */
export function refusalClause(reason: RefusalReason): string {
    switch (reason.kind) {
        case 'gone': return t('notice.refusedGone');
        case 'changed': return t('notice.refusedChanged');
        case 'unplaceable': return reason.fence === null ? t('notice.refusedUnplaceable') : t('notice.refusedUnplaceableInFence', { line: reason.fence + 1 });
        case 'disturbs': return reason.fence === null ? t('notice.refusedDisturbs') : t('notice.refusedDisturbsInFence', { line: reason.fence + 1 });
        case 'failed': return t('notice.refusedFailed');
    }
}

/**
 * The one notice of an operation the index did not make. A write's refusal is
 * said in the frame of a write not made; the check's is said as what it
 * found, since a drag or a menu it stopped had not come to a write.
 */
export function refusalNotice({ reason, subject }: IndexRefusal): string {
    switch (reason.kind) {
        case 'stale': return t('notice.readAgain', { subject });
        case 'unreadable': return t('notice.notReadable', { subject });
        default: return t('notice.notWritten', { reason: refusalClause(reason), subject });
    }
}
