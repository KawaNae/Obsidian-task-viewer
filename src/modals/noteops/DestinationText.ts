import { t } from '../../i18n';
import type { NotePlace, NoteRead } from '../../services/data/NotePlaces';
import type { Tone } from '../form/FormIssue';

/**
 * What a form holding the destination fields (`DestinationField`) says of
 * the note they name, as far as the destination alone says it
 * (`NoteRead`): why they name none, and the note a write makes. The same
 * of a send and of a task to make; what hangs on what goes there (the rows'
 * own note, the values a note has already) is the form's own.
 */
export const DestinationText = {
    /** Why the note field names no note a write can make: empty, or a character or a dot a name or a folder cannot have. */
    unnamed(read: Extract<NoteRead, { kind: 'unnamed' }>): string {
        const why = read.why;
        switch (why.why) {
            case 'empty': return t('modal.destination.nameEmpty');
            case 'chars': return t(why.at === 'name' ? 'modal.destination.nameChars' : 'modal.destination.folderChars', { chars: why.chars });
            case 'dot': return t(why.at === 'name' ? 'modal.destination.nameDot' : 'modal.destination.folderDot');
        }
    },

    /** Why the note field names no one note: more than one goes by what it holds, until one is picked. */
    ambiguous(read: Extract<NoteRead, { kind: 'ambiguous' }>): string {
        return t('modal.noteAmbiguous', { name: read.name, count: String(read.files.length), notes: read.files.map(file => file.path).join(', ') });
    },

    /** The note there is, by its path. */
    existing(path: string): string {
        return t('modal.destination.noteExisting', { note: path });
    },

    /**
     * The note a write makes, and the folder it makes with it: warnings, so
     * that a text typed to search with does not make a note unseen.
     */
    made(place: Extract<NotePlace, { kind: 'new' }>): { text: string; tone: Tone }[] {
        const made = { text: t(place.by === 'name' ? 'modal.destination.noteNewByName' : 'modal.destination.noteNew', { note: place.path }), tone: 'warning' as const };
        return place.folderMade === null ? [made] : [made, { text: t('modal.destination.noteFolderMade', { folder: place.folderMade }), tone: 'warning' }];
    },

    /**
     * The vault's other notes by the name of a note made at a path typed:
     * once made, neither is told from the other by its name alone. Null for
     * a note made by a name alone, which no note has, or one no note shares.
     */
    namesakes(place: Extract<NotePlace, { kind: 'new' }>): string | null {
        if (place.by !== 'path' || place.namesakes.length === 0) return null;
        return t('modal.destination.namesakes', { notes: place.namesakes.map(file => file.path).join(', ') });
    },
};
