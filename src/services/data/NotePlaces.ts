import { type App, type TFile } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import { Outline } from '../parsing/utils/Outline';
import { splitLines } from '../persistence/FileLines';
import type { NoteSpot } from '../persistence/Notes';
import { Placement, type HeadingLookup } from '../persistence/utils/Placement';
import { NoteName, type NameCheck, type NoteAsk } from './NoteName';

/** The note a destination names: one to make at its path, or one there is, by its path. */
export type DestinationNote =
    | { kind: 'new'; path: string }
    | { kind: 'existing'; path: string };

/** Where lines go: a note, and where in it (`NoteSpot`): a section, or the end. */
export interface NoteDestination {
    note: DestinationNote;
    spot: NoteSpot;
}

/** A destination as asked of {@link NotePlaces.read}: the note field as typed, and where in the note. */
export interface PlaceAsk {
    note: NoteAsk;
    spot: NoteSpot;
}

/**
 * What the destination a note field and a spot name is, read off the vault
 * alone (`NotePlaces.read`): a new note a name or a path cannot make, and
 * why (`NoteName.check`); more than one note the note field points at, which
 * lines are not put in until one is chosen (`NoteName.find`); or a note, as
 * it stands now.
 */
export type NoteRead =
    | { kind: 'unnamed'; why: Extract<NameCheck, { ok: false }> }
    | { kind: 'ambiguous'; name: string; files: readonly TFile[] }
    | NotePlace;

/**
 * A note the fields name, as it stands now. Read again whenever a field
 * changes; the note may change between the reading and the write, which
 * reads it again.
 *
 * `new`: no note is at the path, and the write makes one; `by` says whether
 * a name alone was typed (the note goes to the folder for new notes) or a
 * path, `folderMade` the first folder on its path made with it, and
 * `namesakes` the vault's other notes by its name, which a link to it has to
 * tell it from (`NoteAt`). `existing`: one of the vault's, with its lines.
 */
export type NotePlace = NotePlaceOf<
    | { kind: 'new'; by: 'name' | 'path'; folderMade: string | null; namesakes: readonly TFile[] }
    | { kind: 'existing'; lines: readonly string[] }
>;

/** What every note the fields name has, beside what its kind has. */
type NotePlaceOf<K> = K & {
    /** The note's path, spelt as the vault spells it when it has the note. */
    path: string;
    /** Where the lines go. */
    to: NoteDestination;
    /**
     * The heading of the section `to.spot` names in the note: one, none (the
     * write makes it), or more than one (the write is refused); null for the
     * note's end.
     */
    heading: HeadingLookup | null;
    /** The names of the note's headings, in the order they stand: those the heading field offers. */
    headings: readonly string[];
    /** The note is one the index does not read (`tv-ignore`): lines put there are not seen. */
    ignored: boolean;
};

/**
 * The read of a destination that does not hang on what goes there: which
 * note the fields name, and what it is where the lines would go. What a
 * send asks first of where its rows go (`NoteOps.destinationFacts`), before
 * what the rows meet there.
 */
export class NotePlaces {
    constructor(
        private readonly app: App,
        private readonly getSettings: () => TaskViewerSettings,
    ) { }

    /**
     * What `ask` names (see {@link NoteRead}), the note read as the vault
     * holds it now. A name alone is a note in `newFolder` (the folder for new
     * notes, by a note it is reckoned from: `NoteName.defaultFolder`) unless
     * the vault has one by it.
     */
    async read(ask: PlaceAsk, newFolder: string): Promise<NoteRead> {
        const at = NoteName.find(this.app.vault, ask.note, newFolder);
        if (at.kind === 'ambiguous') return at;
        const section = ask.spot === 'end' ? null : ask.spot;
        if (at.kind === 'new') {
            const name = NoteName.check(at.path);
            if (!name.ok) return { kind: 'unnamed', why: name };
            return {
                kind: 'new',
                by: at.by,
                folderMade: at.folderMade,
                namesakes: at.namesakes,
                path: at.path,
                to: { note: { kind: 'new', path: at.path }, spot: ask.spot },
                heading: section ? { kind: 'none' } : null,
                headings: [],
                ignored: false,
            };
        }

        const path = at.file.path;
        const { lines } = splitLines(await this.app.vault.read(at.file));
        const outline = Outline.read(lines);
        return {
            kind: 'existing',
            lines,
            path,
            to: { note: { kind: 'existing', path }, spot: ask.spot },
            heading: section ? Placement.heading(outline, section.heading) : null,
            headings: outline.headings.map(h => h.text),
            ignored: FileParsePipeline.resolveSections(lines, this.getSettings()) === null,
        };
    }
}
