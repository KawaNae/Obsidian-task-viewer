import { t } from '../../i18n';
import type { RefusalReason } from '../persistence/FileLines';

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
