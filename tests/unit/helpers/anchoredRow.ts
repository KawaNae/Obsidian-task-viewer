import type { AnchoredRow, AnchoredWrite, RowUpdates } from '../../../src/services/operations/Operations';
import type { Task } from '../../../src/types';
import type { WriteAnswer } from '../../../src/services/operations/WriteAnswer';

/** An index double's reads, and the writes by name it stands in for. */
interface IndexDouble {
    getTaskByAnchor(file: string, anchor: string): Task | undefined;
    updateTask?(taskId: string, updates: Partial<Task>): Promise<boolean>;
    deleteTask?(taskId: string, options?: { fireFlow?: boolean }): Promise<boolean>;
}

/**
 * `freshByAnchor` over an index double that reads no disk: fresh as held, so
 * a write's row is looked up by its anchor in what the double holds
 * (`Operations.freshByAnchor`).
 */
export function heldByAnchor(index: Pick<IndexDouble, 'getTaskByAnchor'>) {
    return (file: string, anchor: string): Promise<AnchoredRow> => {
        const task = index.getTaskByAnchor(file, anchor);
        return Promise.resolve(task ? { kind: 'row', task } : { kind: 'none' });
    };
}

/**
 * The operations a timer test's double stands in for, over an index double
 * that answers the writes by name itself: the anchor looked up as held
 * ({@link heldByAnchor}), and a write by anchor made as the write by the
 * name that answers (`Operations.updateByAnchor`).
 */
export function opsOver(index: IndexDouble) {
    const freshByAnchor = heldByAnchor(index);
    return {
        freshByAnchor,
        updateTask: async (taskId: string, updates: Partial<Task>): Promise<WriteAnswer> => answerOf(await index.updateTask!(taskId, updates)),
        deleteTask: (taskId: string, options?: { fireFlow?: boolean }) => index.deleteTask!(taskId, options),
        updateByAnchor: async (file: string, anchor: string, updates: RowUpdates): Promise<AnchoredWrite> => {
            const found = await freshByAnchor(file, anchor);
            if (found.kind !== 'row') return found;
            const made = typeof updates === 'function' ? updates(found.task) : updates;
            return (await index.updateTask!(found.task.id, made)) ? { kind: 'written', task: found.task } : { kind: 'not-written', refused: null };
        },
    };
}

/** A write's answer as a double's yes or no says it: not written with no reason to tell. */
export function answerOf(written: boolean): WriteAnswer {
    return written ? { written: true } : { written: false, refused: null };
}

/** The row an anchor found, or undefined when it found none or could not read the note. */
export function rowOf(found: AnchoredRow): Task | undefined {
    return found.kind === 'row' ? found.task : undefined;
}
