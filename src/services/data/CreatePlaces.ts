import { TFile, type App } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { logWarn } from '../../log/log';
import { dailyNotes, notePath } from '../../utils/PeriodicNotes';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import { NoteSections } from '../parsing/tree/NoteSections';
import { NoteTasks } from '../parsing/tree/NoteTasks';
import { Outline } from '../parsing/utils/Outline';
import { Destination, type Section } from '../persistence/Destination';
import { draftOver, splitLines } from '../persistence/FileLines';
import { periodicNoteSeed, putBlock } from '../persistence/Notes';
import { Block, Placement, type HeadingLookup } from '../persistence/utils/Placement';
import type { Operations } from '../operations/Operations';
import type { WriteAnswer, WriteTelling } from '../operations/WriteAnswer';

/**
 * Where a new line goes (I#3): the daily note of a day, under the settings'
 * section (a view's empty space, "Create task"), or the head of a row's
 * children (a card's menu, "Add child task").
 */
export type CreatePlace =
    | { kind: 'dailyNote'; date: string }
    | { kind: 'childOf'; taskId: string };

/** What a line put in a place inherits there: the values its section resolves to, as a row's `cascadeContext` holds them. */
export type Inherits = NonNullable<Task['cascadeContext']>;

/**
 * What a place is, for the create dialog to say before the line is written
 * (`CreatePlaces.facts`), and what a line put there inherits (`inherits`):
 * what the read layer gives the line once it is written, and nothing else.
 * A daily note's day is not one of them: the reading gives a line no date of
 * the note's name (the decision of 2026-10-04, 論点1).
 *
 * - `dailyNote`: the note of the day (`path`), there (`existing`) or made of
 *   its template (`new`), and the heading of the settings' section in it as
 *   the note stands now (`heading`: one, none — the write makes it — or more
 *   than one, where the write puts the line nowhere). `ignored`: a note the
 *   index does not read (`tv-ignore`), where the line is not seen.
 * - `childOf`: the row the line goes under, by its text.
 * - `gone`: the row is no longer in the index.
 */
export type PlaceFacts =
    | {
        kind: 'dailyNote';
        path: string;
        section: Section;
        note: 'existing' | 'new';
        heading: HeadingLookup;
        ignored: boolean;
        inherits: Inherits;
    }
    | { kind: 'childOf'; parent: string; inherits: Inherits }
    | { kind: 'gone'; inherits: Inherits };

/** A task line as the reading takes it, put where a new line goes to find the section it lands in. */
const PROBE = '- [ ] _';

/**
 * The places a new task line is made in, as the create dialog asks of them:
 * what a place is and what a line there inherits ({@link facts}), the
 * note a line put there is in ({@link noteOf}), and the write of the line
 * there ({@link create}). Beside `NoteOps`, which answers
 * the same of a send's destination.
 */
export class CreatePlaces {
    constructor(
        private readonly app: App,
        private readonly operations: Operations,
        private readonly getSettings: () => TaskViewerSettings,
        private readonly getTask: (taskId: string) => Task | undefined,
    ) { }

    /**
     * The path of the note a line put in `place` is in: the day's note,
     * there or not yet; the note of the row it goes under. Null when the row
     * is no longer in the index.
     */
    noteOf(place: CreatePlace): string | null {
        if (place.kind === 'childOf') return this.getTask(place.taskId)?.file ?? null;
        return notePath(dailyNotes(this.app), place.date);
    }

    /**
     * What `place` is, read as the vault holds it now (see
     * {@link PlaceFacts}). What a line there inherits is the resolution's
     * answer (`FileParsePipeline.resolveSections`, the reading the index
     * makes) for the section the line lands in:
     *
     * - in a daily note, where the write puts it — the note's lines, or its
     *   template's as expanded for the day when it is not there, with the
     *   line put in the settings' section (`putBlock`, the heading made when
     *   there is none, as the write makes it);
     * - under a row, the row's section, which its children stand in.
     */
    async facts(place: CreatePlace): Promise<PlaceFacts> {
        const settings = this.getSettings();
        if (place.kind === 'childOf') {
            const parent = this.getTask(place.taskId);
            if (!parent) return { kind: 'gone', inherits: {} };
            const lines = await this.linesOf(parent.file);
            return { kind: 'childOf', parent: parent.content, inherits: inheritsAt(lines ?? [], parent.line, settings) };
        }

        const desc = dailyNotes(this.app);
        const path = notePath(desc, place.date);
        const there = await this.linesOf(path);
        const lines = there ?? splitLines(await periodicNoteSeed(this.app, desc, place.date)).lines;
        const section = Destination.taskSection(settings);
        const heading = Placement.heading(Outline.read(lines), section.heading);
        const facts = { kind: 'dailyNote' as const, path, section, note: there ? 'existing' as const : 'new' as const, heading };
        if (heading.kind === 'many') return { ...facts, ignored: false, inherits: {} };

        const working = [...lines];
        let at: number;
        try {
            const placed = putBlock(draftOver(working).draft, section, Block.line(PROBE));
            if (typeof placed !== 'number') return { ...facts, ignored: false, inherits: {} };
            at = placed;
        } catch (e) {
            logWarn(`[CreatePlaces] where a line goes in ${path} could not be read: ${String(e)}`);
            return { ...facts, ignored: false, inherits: {} };
        }
        const read = FileParsePipeline.resolveSections(working, settings);
        if (!read) return { ...facts, ignored: true, inherits: {} };
        const landed = NoteSections.at(read.sections, at);
        return { ...facts, ignored: false, inherits: landed ? NoteTasks.inheritance(landed) : {} };
    }

    /**
     * Write `line` in `place`: under the daily note's section, the note made
     * of its template when it is not there (`putInDailyNote`), or at the head
     * of the row's children (`insertLine`). Whether it was written, and why
     * not, as the write answers (`WriteAnswer`), told as `opts` says.
     */
    create(place: CreatePlace, line: string, opts: WriteTelling = {}): Promise<WriteAnswer> {
        return place.kind === 'dailyNote'
            ? this.operations.putInDailyNote(place.date, line, opts)
            : this.operations.insertLine(place.taskId, line, 'firstChild', undefined, opts);
    }

    /** The lines of the note at `path` as the vault holds them; null when there is none. */
    private async linesOf(path: string): Promise<string[] | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        return splitLines(await this.app.vault.read(file)).lines;
    }
}

/** What a line standing at `row` of `lines` inherits: its section's resolved values; none in a note the index does not read. */
function inheritsAt(lines: readonly string[], row: number, settings: TaskViewerSettings): Inherits {
    const read = FileParsePipeline.resolveSections(lines, settings);
    const section = read ? NoteSections.at(read.sections, row) : undefined;
    return section ? NoteTasks.inheritance(section) : {};
}
