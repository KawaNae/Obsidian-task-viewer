import type { App } from 'obsidian';
import type { WriteChannels } from '../../services/persistence/FileLines';
import { openPeriodicNote } from '../../services/persistence/Notes';
import type { PeriodicNote } from '../../utils/PeriodicNotes';

/**
 * Open the periodic note of `date` (`YYYY-MM-DD`) in the current leaf, made
 * of its template when it is not there: a click on a date or a week, month
 * or year label. A note that could not be made opens nothing; the channel
 * has told why.
 */
export async function openPeriodicNoteInLeaf(app: App, desc: PeriodicNote, date: string, channelFor: WriteChannels): Promise<void> {
    const file = await openPeriodicNote(app, desc, date, channelFor);
    if (file) await app.workspace.getLeaf(false).openFile(file);
}
