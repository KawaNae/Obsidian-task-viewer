import type { AnchoredRow } from '../../../src/services/core/TaskIndex';
import type { Task } from '../../../src/types';

/**
 * `freshByAnchor` over an index double that reads no disk: fresh as held, so
 * a write's row is looked up by its anchor in what the double holds
 * (`TaskWriteService.freshByAnchor`).
 */
export function heldByAnchor(index: { getTaskByAnchor(file: string, anchor: string): Task | undefined }) {
    return (file: string, anchor: string): Promise<AnchoredRow> => {
        const task = index.getTaskByAnchor(file, anchor);
        return Promise.resolve(task ? { kind: 'row', task } : { kind: 'none' });
    };
}

/** The row an anchor found, or undefined when it found none or could not read the note. */
export function rowOf(found: AnchoredRow): Task | undefined {
    return found.kind === 'row' ? found.task : undefined;
}
