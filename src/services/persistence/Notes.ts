import { type App, TFile } from 'obsidian';
import { logWarn } from '../../log/log';
import { DateUtils } from '../../utils/DateUtils';
import { normalizeTrailingNewline, processTemplate } from '../../utils/NoteTemplateProcessor';
import { notePath, type PeriodicNote } from '../../utils/PeriodicNotes';
import { Outline } from '../parsing/utils/Outline';
import type { Section } from './Destination';
import {
    UnfollowableDraft, createFile, editLines, fileGone, joinContent, processLines, splitLines, writeFailed,
    type DraftEdit, type LineDraft, type WriteChannel, type WriteChannels, type WriteMade, type WriteRefused,
} from './FileLines';
import { Block, Placement, type PlacedLine, type SectionLookup, type Spot } from './utils/Placement';

/**
 * Notes as a write takes them whole: a note made with lines put in it, and a
 * block put in a section of a note, the note made when it is not there.
 */

/** Where a block goes in a note: a section, or the end of the note (`Placement.end`). */
export type NoteSpot = Section | 'end';

/** A note made, and the note. */
export type NoteMade = WriteMade & { file: TFile };

/** A block put in a note, the line its first line went to, and the note. */
export type NotePut = WriteRefused | (WriteMade & { line: number; file: TFile });

/**
 * The line of the heading {@link sectionSpot} makes for `to`: what a note
 * with none by the name will hold once lines are put in the section.
 */
export function headingLine(to: Section): string {
    return '#'.repeat(to.level) + ' ' + to.heading;
}

/**
 * Where lines go in the section `to` names, at its side
 * (`Placement.into`: the heading looked up as a link to it is, at any
 * level), `head` the first of them. If the note has no heading by the name,
 * makes one at `to.level` at the end of the file — where `Placement.end`
 * says lines appended to the note go — and the lines go under it. If it has
 * more than one, the lines go nowhere: which of them is meant, no link to
 * the heading tells either. The one place a write that adds lines to a
 * section makes its heading: a block put in a note ({@link putInNote}), a
 * send's carried rows (`SendWriter`).
 *
 * The spot is asked again once the heading is made, so it is `Placement`'s
 * answer either way. Whether the lines read as put is the write's check.
 */
export function sectionSpot(draft: LineDraft, to: Section, head: string): Spot | Extract<SectionLookup, { kind: 'many' }> {
    const found = Placement.into(draft.reading(), to, head);
    if (found.kind === 'spot') return found.spot;
    if (found.kind === 'many') return found;
    // At the end, before the empty element a terminated file splits into,
    // so the file still ends with its terminator. One blank line sets the
    // new heading off from the text above it.
    const end = Placement.end(draft.reading());
    const blank = end.at > 0 && !Outline.isBlank(draft.lines[end.at - 1]) ? [''] : [];
    draft.put(end, Block.read([...blank, headingLine(to)]));
    const made = Placement.into(draft.reading(), to, head);
    if (made.kind !== 'spot') throw new UnfollowableDraft(`the heading '${to.heading}' just made is not one to put lines under`);
    return made.spot;
}

/**
 * Put `block` where `where` says in the lines of `draft`: in the section
 * ({@link sectionSpot}), or at the end of the note. Answers the line its
 * first line went to, or how many headings go by the section's name.
 */
export function putBlock(draft: LineDraft, where: NoteSpot, block: readonly PlacedLine[]): number | Extract<SectionLookup, { kind: 'many' }> {
    const spot = where === 'end' ? Placement.end(draft.reading()) : sectionSpot(draft, where, block[0].text);
    if ('kind' in spot) return spot;
    draft.put(spot, block);
    return spot.at;
}

/**
 * Make the note at `path` of `seed` — its content before anything is put in
 * it: `''` for an empty note, a periodic note's template as expanded — with
 * `edit` made to its lines, held to the same check as a write to a note that
 * is there (`editLines`), and created whole (`createFile`), in the folders
 * its path names. The lines are written with the seed's terminator and mark.
 * An empty note's lines are those `''` splits into, one empty line, so a
 * note made with lines put at its end ends with a terminator.
 *
 * Made, or refused and told once through `channel`: `failed` when the seed
 * could not be made (a template unreadable) or the note not created, the
 * edit's own refusal otherwise. Creations of one path run one at a time
 * ({@link putInNote}).
 */
export function createNote(
    app: App,
    path: string,
    channel: WriteChannel | undefined,
    subject: string,
    seed: () => string | Promise<string>,
    edit?: DraftEdit,
): Promise<WriteRefused | NoteMade> {
    return inCreationLineOf(path, () => makeNote(app, path, channel, subject, seed, edit));
}

/** {@link createNote}, in the path's line already. */
async function makeNote(
    app: App,
    path: string,
    channel: WriteChannel | undefined,
    subject: string,
    seed: () => string | Promise<string>,
    edit?: DraftEdit,
): Promise<WriteRefused | NoteMade> {
    let content: string;
    try {
        content = await seed();
    } catch (error) {
        return writeFailed(channel, path, subject, error);
    }
    if (edit) {
        const split = splitLines(content);
        const edited = editLines(path, split.lines, split.eol, edit, { about: subject });
        if (!edited.written) {
            channel?.refused(edited.refused);
            return edited;
        }
        content = joinContent(edited.lines, split);
    }
    const made = content;
    return createFile(app, path, channel, subject, () => made);
}

/**
 * Put `block` in the note at `path`, where `where` says ({@link putBlock}):
 * in a section, its heading made when the note has none by the name and the
 * block put nowhere when it has more than one (`headings`); or at the end.
 * A note there is written in place (`processLines`). A note not there is
 * made with the block in it when `create` says what it holds before
 * ({@link createNote}'s seed), in one write; without `create`, or with a
 * folder by the name, the write is refused as `gone`. Answers the line the
 * block's first line went to, with the note.
 *
 * The writes of this and {@link createNote} to one path run one at a time,
 * each once the one before it is done, and whether the note is there is
 * asked then: of two blocks put in a note not there yet, the first makes
 * the note, and the second is put in the note it made, as it would be in a
 * note that was there.
 */
export function putInNote(
    app: App,
    path: string,
    channel: WriteChannel | undefined,
    put: { where: NoteSpot; block: readonly PlacedLine[]; create?: () => string | Promise<string> },
): Promise<NotePut> {
    return inCreationLineOf(path, async (): Promise<NotePut> => {
        const subject = put.block[0].text.trim();
        let at = -1;
        const edit: DraftEdit = (draft, _eol, session) => {
            const placed = putBlock(draft, put.where, put.block);
            if (typeof placed !== 'number') {
                const heading = put.where === 'end' ? '' : put.where.heading;
                return session.refuse({ kind: 'headings', name: heading, count: placed.count });
            }
            at = placed;
            return true;
        };

        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            const outcome = await processLines(app, file, channel, edit, subject);
            return outcome.written ? { ...outcome, line: at, file } : outcome;
        }
        if (file !== null || !put.create) return fileGone(channel, path, subject);
        const made = await makeNote(app, path, channel, subject, put.create, edit);
        return made.written ? { ...made, line: at } : made;
    });
}

/**
 * The periodic note of `date` (`YYYY-MM-DD`), made of its template when it
 * is not there ({@link createNote}); null when it could not be made, which
 * the channel of its path has told once. Asked after the writes to its path
 * already asked, so a note one of them makes is the one answered.
 */
export function openPeriodicNote(app: App, desc: PeriodicNote, date: string, channelFor: WriteChannels): Promise<TFile | null> {
    const path = notePath(desc, date);
    return inCreationLineOf(path, async () => {
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) return file;
        const made = await makeNote(app, path, channelFor(path), path, () => templateOf(app, desc, date));
        return made.written ? made.file : null;
    });
}

/**
 * Put `line` in the section `to` of the periodic note of `date`
 * (`YYYY-MM-DD`; {@link putInNote}), the note made of its template with the
 * line in it when it is not there, in one write.
 *
 * @returns what the write did (`NotePut`): the note written, or why not,
 * told once through the channel of its path. A caller finds the line again
 * by the note's path: a timer follows its running line by its `^id`, and
 * closes it where it stands when it stops.
 */
export async function putInPeriodicNote(
    app: App,
    desc: PeriodicNote,
    date: string,
    line: string,
    to: Section,
    channelFor: WriteChannels,
): Promise<NotePut> {
    const path = notePath(desc, date);
    return putInNote(app, path, channelFor(path), {
        where: to, block: Block.line(line), create: () => templateOf(app, desc, date),
    });
}

/**
 * What a new periodic note of `date` holds: its template (the path, or the
 * path with `.md`) expanded for the date, ending with a terminator; '' with
 * no template, or one that cannot be found, which is logged — a note is made
 * all the same.
 */
async function templateOf(app: App, desc: PeriodicNote, date: string): Promise<string> {
    if (!desc.template) return '';
    const file = app.vault.getAbstractFileByPath(desc.template) ?? app.vault.getAbstractFileByPath(`${desc.template}.md`);
    if (!(file instanceof TFile)) {
        logWarn(`[task-viewer] Template not found for ${desc.kind} note: ${desc.template}`);
        return '';
    }
    const raw = await app.vault.read(file);
    return normalizeTrailingNewline(processTemplate(raw, {
        noteType: desc.kind,
        triggerDate: DateUtils.parseDate(date),
        filenameFormat: desc.format,
        weekStartDay: desc.weekStartDay.template,
    }));
}

/**
 * Run `run` once every write already in the line of `path` through this
 * module has settled, and keep the line waiting for it in turn: a note is
 * made at a path once, and a write that finds it there writes to it.
 */
function inCreationLineOf<T>(path: string, run: () => Promise<T>): Promise<T> {
    const ahead = creationLine.get(path);
    const mine = ahead ? ahead.then(run) : run();
    const settled = mine.then(() => undefined, () => undefined);
    creationLine.set(path, settled);
    void settled.then(() => {
        if (creationLine.get(path) === settled) creationLine.delete(path);
    });
    return mine;
}

/** Each path's latest write through {@link inCreationLineOf}, settled when it is done. */
const creationLine = new Map<string, Promise<void>>();
