import type { App } from 'obsidian';
import type { Operations } from '../../services/operations/Operations';
import type { PeriodicNote } from '../../utils/PeriodicNotes';

/** What opening a periodic note asks of the operations. */
export type PeriodicNoteOpener = Pick<Operations, 'openPeriodicNote'>;

/**
 * Open the periodic note of `date` (`YYYY-MM-DD`) in the current leaf, made
 * of its template when it is not there: a click on a date or a week, month
 * or year label. A note that could not be made opens nothing; the user has
 * been told why (`Operations.openPeriodicNote`).
 */
export async function openPeriodicNoteInLeaf(app: App, notes: PeriodicNoteOpener, desc: PeriodicNote, date: string): Promise<void> {
    const file = await notes.openPeriodicNote(desc, date);
    if (file) await app.workspace.getLeaf(false).openFile(file);
}
