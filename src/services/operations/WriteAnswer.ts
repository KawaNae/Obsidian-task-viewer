import { t } from '../../i18n';
import { refusalNotice, type IndexRefusal } from '../core/RefusalClause';

/**
 * What an operation that writes answers its caller (I#9): written, or not,
 * and why not. `refused` is null for a write turned away without a reason to
 * tell (a read-only row, the operations taken down).
 *
 * The user is told why a write was refused once: by a notice of the write
 * layer, or, when the caller asked for the refusal with `tellRefusal: false`
 * ({@link WriteTelling}), by the caller in its own place — a dialog that
 * waits for the write says it inside, and a notice would say it twice. The
 * index learns from a refusal either way.
 */
export type WriteAnswer =
    | { written: true }
    | { written: false; refused: IndexRefusal | null };

/** How a write's refusal is told: by the write layer's notice (the default), or left to the caller. */
export interface WriteTelling {
    tellRefusal?: boolean;
}

export const WRITTEN: WriteAnswer = { written: true };

/** A write not made, `refused` its reason when there is one to tell. */
export function notWritten(refused: IndexRefusal | null = null): WriteAnswer {
    return { written: false, refused };
}

/**
 * Why a write was not made, as a dialog says it: the refusal's notice, or,
 * with no reason to tell, that it could not be written.
 */
export function refusalText(refused: IndexRefusal | null): string {
    return refused ? refusalNotice(refused) : t('notice.notWrittenAtAll');
}
