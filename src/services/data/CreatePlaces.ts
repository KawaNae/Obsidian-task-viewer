import type { NewRow } from '../persistence/NewRow';
import { TFile, type App } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { logWarn } from '../../log/log';
import { dailyNotes, notePath } from '../../utils/PeriodicNotes';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import { NoteSections } from '../parsing/tree/NoteSections';
import { NoteTasks } from '../parsing/tree/NoteTasks';
import type { ResolvedSources, SectionNode } from '../parsing/tree/Sections';
import { Destination } from '../persistence/Destination';
import { draftOver, splitLines } from '../persistence/FileLines';
import { putBlock, seedOf, type NoteSeed, type NoteSpot } from '../persistence/Notes';
import { Block, type HeadingLookup } from '../persistence/utils/Placement';
import type { Operations } from '../operations/Operations';
import type { WriteAnswer, WriteTelling } from '../operations/WriteAnswer';
import { spotIn, type DestinationAsk, type NoteDestination } from './NotePlaces';
import { NoteName } from './NoteName';

/**
 * The note a place to create in is in, by what it is: the daily note of
 * `date` (`YYYY-MM-DD`), made of the day's template when it is not there;
 * or the note at `path`, made empty when it is not there. The note's path
 * and what it is made of are both read off this one value
 * (`CreatePlaces.noteOf`, `CreatePlaces.create`), so they cannot name
 * different days.
 */
export type PlaceNote =
    | { kind: 'daily'; date: string }
    | { kind: 'path'; path: string };

/**
 * Where a new line goes: in a note, where `spot` says (a section, or the
 * end of the note) — a view's empty space puts it under the settings'
 * section of the day's daily note ({@link CreatePlaces.dailyNote}), or where
 * the user chooses ({@link CreatePlaces.fromDestination});
 * or the head of a row's children (a card's menu, "Add child task").
 */
export type CreatePlace =
    | { kind: 'note'; note: PlaceNote; spot: NoteSpot }
    | { kind: 'childOf'; taskId: string };

/** A place in a note: the place the place fields of the hub on a task to make name, and are opened on. */
export type PlaceInNote = Extract<CreatePlace, { kind: 'note' }>;

/** What a line put in a place inherits there: the values its section resolves to, as a row's `cascadeContext` holds them. */
export type Inherits = NonNullable<Task['cascadeContext']>;

/**
 * What a line put in a place inherits there (`inherits`), and where each of
 * those values comes from (`inheritedFrom`, as a row's holds it; absent when
 * no layer above says anything).
 */
export interface Inheritance {
    inherits: Inherits;
    inheritedFrom?: ResolvedSources;
}

/**
 * What a place is, for the hub on a task not written yet to say before the
 * line is written (`CreatePlaces.facts`), and what a line put there inherits
 * (`inherits`):
 * what the read layer gives the line once it is written, and nothing else,
 * with where it comes from (`inheritedFrom`).
 * A daily note's day is not one of them: the reading gives a line no date of
 * the note's name.
 *
 * - `note`: the note at `path`, there (`existing`) or made of `seed` when
 *   it is not (`new`: empty, or the daily note's template), and where in it
 *   the line goes (`spot`): in a section, whose heading is as the note
 *   stands now (`heading`: one, none — the write makes it — or more than
 *   one, where the write puts the line nowhere); or at the end of the note
 *   (`heading` null). `ignored`: a note the index does not read
 *   (`tv-ignore`), where the line is not seen.
 * - `childOf`: the row the line goes under, by its text (`parent`), the
 *   note it is in (`path`), and the heading of the section it stands in
 *   (`under`: the nearest above it; null above the note's first heading).
 * - `gone`: the row is no longer in the index.
 */
export type PlaceFacts =
    | {
        kind: 'note';
        path: string;
        spot: NoteSpot;
        note: 'existing' | 'new';
        seed: NoteSeed['kind'];
        heading: HeadingLookup | null;
        ignored: boolean;
    } & Inheritance
    | { kind: 'childOf'; parent: string; path: string; under: string | null } & Inheritance
    | { kind: 'gone' } & Inheritance;

/** A task line as the reading takes it, put where a new line goes to find the section it lands in. */
const PROBE = '- [ ] _';

/**
 * The places a new task line is made in, as the hub on a task not written
 * yet asks of them: the daily note's place ({@link dailyNote}), the place
 * a note and a spot chosen name ({@link fromDestination}) and the place
 * fields that name a place ({@link askOf}), what a place
 * is and what a line there inherits ({@link facts}), the note a line put
 * there is in ({@link noteOf}), and the write of the line there
 * ({@link create}). Beside `NoteOps`, which answers the same of a send's
 * destination.
 */
export class CreatePlaces {
    constructor(
        private readonly app: App,
        private readonly operations: Operations,
        private readonly getSettings: () => TaskViewerSettings,
        private readonly getTask: (taskId: string) => Task | undefined,
    ) { }

    /** The place a view's "Create task for daily note" on `date` puts a line in: the settings' section of the day's daily note. */
    dailyNote(date: string): PlaceInNote {
        return { kind: 'note', note: { kind: 'daily', date }, spot: Destination.taskSection(this.getSettings()) };
    }

    /**
     * The place the place fields' answer `to` names (`PlaceFields`): its
     * note by its path, made empty when it is not there, and where in it.
     *
     * `openedOn`, the place the hub on a task not written yet opened on: an
     * answer in its note stays the note it is — a daily note is still made
     * of its day's template — and takes the answer's spot alone. That is the
     * one place a daily note comes from: the fields answer with a path, and
     * every place the hub moved to since is the note at a path, which the
     * answer's path names again on its own.
     */
    fromDestination(to: NoteDestination, openedOn?: CreatePlace): PlaceInNote {
        if (openedOn?.kind === 'note' && this.pathOf(openedOn.note) === to.note.path) return { ...openedOn, spot: to.spot };
        return { kind: 'note', note: { kind: 'path', path: to.note.path }, spot: to.spot };
    }

    /**
     * The place fields as they name `place`, as they open (`PlacePane`'s
     * `initial`): the note field the note's name, holding its path as
     * picked — the note the path names, there or not yet
     * (`NoteName.find`) — and the heading field the section's heading, or
     * empty for the note's end.
     */
    askOf(place: PlaceInNote): DestinationAsk {
        return { note: NoteName.askOf(this.pathOf(place.note)), heading: place.spot === 'end' ? '' : place.spot.heading };
    }

    /**
     * The path of the note a line put in `place` is in: the day's note or
     * the note at the path, there or not yet; the note of the row it goes
     * under. Null when the row is no longer in the index.
     */
    noteOf(place: CreatePlace): string | null {
        if (place.kind === 'childOf') return this.getTask(place.taskId)?.file ?? null;
        return this.pathOf(place.note);
    }

    /**
     * What `place` is, read as the vault holds it now (see
     * {@link PlaceFacts}). What a line there inherits is the resolution's
     * answer (`FileParsePipeline.resolveSections`, the reading the index
     * makes) for the section the line lands in:
     *
     * - in a note, where the write puts it — the note's lines, or the lines
     *   a note not there is made of (`Notes.seedOf`, as the write makes it),
     *   with the line put where the spot says (`putBlock`, the heading made
     *   when there is none, as the write makes it);
     * - under a row, the row's section, which its children stand in.
     */
    async facts(place: CreatePlace): Promise<PlaceFacts> {
        const settings = this.getSettings();
        if (place.kind === 'childOf') {
            const parent = this.getTask(place.taskId);
            if (!parent) return { kind: 'gone', inherits: {} };
            const section = sectionAt(await this.linesOf(parent.file) ?? [], parent.line, settings);
            return { kind: 'childOf', parent: parent.content, path: parent.file, under: section?.heading?.text ?? null, ...inheritanceOf(section) };
        }

        const { spot } = place;
        const path = this.pathOf(place.note);
        const seed = seedFor(place.note);
        const there = await this.linesOf(path);
        const lines = there ?? splitLines(await seedOf(this.app, seed)).lines;
        const { heading, ignored } = spotIn(lines, spot, settings);
        const facts = { kind: 'note' as const, path, spot, note: there ? 'existing' as const : 'new' as const, seed: seed.kind, heading, ignored };
        if (heading?.kind === 'many' || ignored) return { ...facts, inherits: {} };

        const working = [...lines];
        let at: number;
        try {
            const placed = putBlock(draftOver(working).draft, spot, Block.line(PROBE));
            if (typeof placed !== 'number') return { ...facts, inherits: {} };
            at = placed;
        } catch (e) {
            logWarn(`[CreatePlaces] where a line goes in ${path} could not be read: ${String(e)}`);
            return { ...facts, inherits: {} };
        }
        return { ...facts, ...inheritanceOf(sectionAt(working, at, settings)) };
    }

    /**
     * Write `row`, with its property lines, in `place`: where the spot says
     * in the note, the note made of what its place says when it is not there
     * (`Operations.putInNote`), or at the head of the row's children
     * (`insertLine`). Whether it was written, and why not, as the write
     * answers (`WriteAnswer`), told as `opts` says.
     */
    create(place: CreatePlace, row: NewRow, opts: WriteTelling = {}): Promise<WriteAnswer> {
        if (place.kind === 'childOf') return this.operations.insertLine(place.taskId, row, 'firstChild', undefined, opts);
        return this.operations.putInNote(this.pathOf(place.note), place.spot, row, { ...opts, seed: seedFor(place.note) });
    }

    /** The path of `note`: the day's note as the daily notes' settings name it, or the path itself. */
    private pathOf(note: PlaceNote): string {
        return note.kind === 'daily' ? notePath(dailyNotes(this.app), note.date) : note.path;
    }

    /** The lines of the note at `path` as the vault holds them; null when there is none. */
    private async linesOf(path: string): Promise<string[] | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        return splitLines(await this.app.vault.read(file)).lines;
    }
}

/** What the note `note` names is made of when it is not there: the day's template, or nothing. */
function seedFor(note: PlaceNote): NoteSeed {
    return note.kind === 'daily' ? { kind: 'daily', date: note.date } : { kind: 'empty' };
}

/** The section a line standing at `row` of `lines` is in, its values resolved; none in a note the index does not read. */
export function sectionAt(lines: readonly string[], row: number, settings: TaskViewerSettings): SectionNode | undefined {
    const read = FileParsePipeline.resolveSections(lines, settings);
    return read ? NoteSections.at(read.root, row) : undefined;
}

/** What a line standing in `section` inherits, and from where, as the reading gives a row there (`NoteTasks`); none with no section. */
function inheritanceOf(section: SectionNode | undefined): Inheritance {
    if (!section) return { inherits: {} };
    const inheritedFrom = NoteTasks.sourcesOf(section);
    return inheritedFrom ? { inherits: NoteTasks.inheritance(section), inheritedFrom } : { inherits: NoteTasks.inheritance(section) };
}

/**
 * Whether `a` and `b` are the same place: the same note, by what it is (the
 * daily note of the same day, or the note at the same path), and the same
 * spot in it (the end, or the section of the same heading, level and side);
 * or the head of the same row's children.
 */
export function samePlace(a: CreatePlace, b: CreatePlace): boolean {
    if (a.kind === 'childOf') return b.kind === 'childOf' && a.taskId === b.taskId;
    if (b.kind === 'childOf') return false;
    const sameNote = a.note.kind === 'daily'
        ? b.note.kind === 'daily' && a.note.date === b.note.date
        : b.note.kind === 'path' && a.note.path === b.note.path;
    return sameNote && sameSpot(a.spot, b.spot);
}

/** Whether `a` and `b` are the same spot: both the end, or the section of the same heading, level and side. */
function sameSpot(a: NoteSpot, b: NoteSpot): boolean {
    if (a === 'end' || b === 'end') return a === b;
    return a.heading === b.heading && a.level === b.level && a.side === b.side;
}
