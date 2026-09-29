import { type App, TFile } from 'obsidian';
import { HeadingInserter } from '../../../utils/HeadingInserter';
import { indentUnit } from '../../../utils/ObsidianConfig';
import { TaskLineClassifier } from '../../parsing/utils/TaskLineClassifier';
import { carryTo, putNumbered, subtreeBlock } from '../Carry';
import type { Section } from '../Destination';
import {
    createFile, editLines, fileGone, readInLine, splitLines, takeBack,
    type LineDraft, type MarkedLine, type Refusal, type RowTarget, type TakeBack, type WriteChannel, type WriteChannels, type WriteSession,
} from '../FileLines';
import { replaceSubtree } from '../ReplaceSubtree';
import type { PlannedTarget } from '../TaskRefs';
import type { CompletionFire, FiringOutcome, SubtreeReplacement } from '../TaskOps';
import type { FileOperations } from '../utils/FileOperations';
import { FrontmatterLineEditor } from '../utils/FrontmatterLineEditor';
import { ListNumber } from '../utils/ListNumber';
import { noteLink } from '../utils/NoteLink';
import { Placement, type PlacedLine, type Spot } from '../utils/Placement';
import type { InlineTaskWriter } from './InlineTaskWriter';

/**
 * A row a send takes: the row, named with the subtree the send was planned
 * on (`RowBasis.subtree`), and the draft of the row and its subtree the user
 * wrote before sending it, if any (`SubtreeReplacement`).
 */
export interface SentRow {
    target: PlannedTarget;
    draft?: SubtreeReplacement;
}

/** A key a send writes into its note's frontmatter: its name, and its lines (the key's line and what continues it). */
export interface FrontmatterKey {
    key: string;
    yaml: readonly string[];
}

/** Where a send goes: a note, made by the send when `create` says so, and the section of it. */
export interface SendTo {
    path: string;
    /** No note is at `path`, and the send makes one. */
    create: boolean;
    section: Section;
    /** Keys to write into the note's frontmatter, each only where the note has none by its name. */
    frontmatter: readonly FrontmatterKey[];
}

/** Whether a line rewritten completes its row, and the fire of a completed row of the note at `path` (the flow layer's). */
export interface SendCompleting<F extends CompletionFire> {
    completes(before: string, after: string): boolean;
    fire(path: string): F;
}

/**
 * What came of a send (`SendWriter.send`): nothing written, and the refusal
 * told as any write's is; or the note written, the rows of `landed` there
 * and gone from where they stood, and those of the notes `refused` names
 * still where they stood, their refusals told to nobody.
 */
export type SendOutcome<F extends CompletionFire> =
    | { kind: 'not-sent' }
    | {
        kind: 'sent';
        note: TFile;
        /** The notes whose rows went: each note they came from, and the note itself for its own rows. */
        landed: readonly string[];
        /** Why each note whose rows stayed kept them. */
        refused: readonly Refusal[];
        /**
         * Whether what went to the note of the rows that stayed was taken
         * out of it again (`takeBack`): true when none stayed. When false,
         * those rows are in both notes.
         */
        takenBack: boolean;
        /** Each write made that fired rows a draft completed, for the fires it did not run (`FiringOutcome`). */
        writes: readonly FiringOutcome<F>[];
    };

/** A row as a send puts it in its note: one of the note's own, carried; or the lines another note's write leaves of one, put there new. */
type Item =
    | { own: RowTarget }
    | { from: string; block: readonly PlacedLine[] };

/** What a write to the note left: its lines, and where the lines each note the rows came from sent stand in them. */
interface Placed {
    left: readonly string[];
    blocks: ReadonlyArray<{ from: string; range: readonly [number, number] }>;
}

/** What the write of a note the rows come from leaves of each row, in its order: its lines, and those lines as a block to put. */
type Rehearsed = ReadonlyArray<{ lines: readonly string[]; block: readonly PlacedLine[] }>;

/**
 * The writes of a send: rows and their subtrees taken to a section of a note
 * (`v0.58-features.md`, 送る操作への一般化; the order and what is taken back,
 * `note-ops-plan.md` 3).
 */
export class SendWriter {
    constructor(
        private app: App,
        private inline: InlineTaskWriter,
        private fileOps: FileOperations,
        private channelOf: WriteChannels,
    ) { }

    /**
     * Send `rows` to the section `to` names of its note: each row with the
     * note it stands in, in the order they are to land in — the order they
     * stand in, note by note — none in another's subtree.
     *
     * Each row is taken as the dialog says: edited, and then sent. A row with
     * a draft is written as the draft says first (`replaceSubtree`), each
     * row the draft completed fires where it stands (`completing`, as the
     * hub's source mode fires it), and what that left of the row and its
     * subtree is what is sent, `==>` lines and all, to fire at its next
     * completion where it lands. The note gets the rows in their order: the
     * first where `Placement.into` puts lines in the section, the heading
     * made when the note has none (`HeadingInserter.sectionSpot`), each after
     * it just past the one before, as its sibling. A note with more than one
     * heading by the name takes none of them (`headings`).
     *
     * The rows of the note itself are carried within it (`carryTo`), in the
     * note's one write. When they are all there is, that write is the whole
     * send, and refused, nothing is written.
     *
     * A row of another note is put in the note first, and then taken away
     * from where it stood, its place left with a line that links to the note
     * (`[[Note]]`, as the user's settings spell a link: `noteLink`), under the
     * row's own marker: the link needs the note, which may be one the send
     * makes. So:
     *
     * 1. Each other note's write is tried on its lines, writing nothing: what
     *    it would leave of each row once the drafts and fires are written is
     *    what goes to the note. Refused, nothing is written, and the refusal
     *    is told.
     * 2. The note is written: made of those rows, the frontmatter keys and
     *    its heading (`editLines`, `createFile`), or written in one write,
     *    with the keys it has none of and its own rows carried. Refused,
     *    nothing is written anywhere, and the refusal is told.
     * 3. Each other note is written in one write: the drafts, the fires, and
     *    each row's subtree replaced by the link — only where the subtree
     *    then reads as it did when it was tried, so what went to the note is
     *    what is taken away here (`changed` otherwise). A refusal here is
     *    told to nobody: it is in the outcome.
     * 4. If a note refused, the note sent to is taken back while it reads as
     *    its write left it (`takeBack`): the lines of the notes that refused
     *    taken out of it, or, when no row went, the note taken away, or
     *    written back as it was.
     */
    async send<F extends CompletionFire>(
        rows: ReadonlyArray<{ file: string; row: SentRow }>,
        to: SendTo,
        completing: SendCompleting<F>,
    ): Promise<SendOutcome<F>> {
        const own = rows.filter(one => one.file === to.path).map(one => one.row);
        const others: { path: string; rows: SentRow[] }[] = [];
        for (const { file, row } of rows) {
            if (file === to.path) continue;
            const from = others.find(one => one.path === file);
            if (from) from.rows.push(row);
            else others.push({ path: file, rows: [row] });
        }
        const subject = rows[0]?.row.target.subject ?? to.path;

        // 1. What each other note's write leaves of the rows it sends.
        const rehearsed = new Map<string, Rehearsed>();
        for (const from of others) {
            const tried = await this.rehearse(from.path, from.rows, completing);
            if (tried === null) return { kind: 'not-sent' };
            rehearsed.set(from.path, tried);
        }
        const taken = new Map<string, number>();
        const items = (sentOwn: readonly RowTarget[]): Item[] => {
            let ownAt = 0;
            taken.clear();
            return rows.map(({ file }): Item => {
                if (file === to.path) return { own: sentOwn[ownAt++] };
                const k = taken.get(file) ?? 0;
                taken.set(file, k + 1);
                return { from: file, block: rehearsed.get(file)![k].block };
            });
        };

        // 2. The note.
        const written = to.create
            ? await this.makeNote(to, items([]), subject)
            : await this.writeNote(to, own, items, completing);
        if (written === null) return { kind: 'not-sent' };
        const { note, placed, before, outcome } = written;
        const writes: FiringOutcome<F>[] = outcome ? [outcome] : [];
        const landed: string[] = own.length > 0 ? [to.path] : [];

        // 3. The notes the rows came from.
        const refused: Refusal[] = [];
        for (const from of others) {
            const left = await this.leaveLinks(from.path, from.rows, rehearsed.get(from.path)!, note, completing);
            if (left.written) {
                landed.push(from.path);
                writes.push(left);
            } else {
                refused.push(left.refused);
            }
        }
        if (refused.length === 0) return { kind: 'sent', note, landed, refused, takenBack: true, writes };

        // 4. What went to the note of the rows that stayed.
        const stayed = new Set(refused.map(one => one.file));
        const how: TakeBack = landed.length > 0
            ? { kind: 'remove', ranges: placed.blocks.filter(one => stayed.has(one.from)).map(one => one.range) }
            : to.create ? { kind: 'made' } : { kind: 'restore', lines: before };
        const back = await takeBack(this.app, note, this.channelOf(note.path), placed.left, how);
        return { kind: 'sent', note, landed, refused, takenBack: back.taken, writes };
    }

    /**
     * Try the write of the note at `path` that sends `rows` on its lines as
     * the disk holds them, writing nothing ({@link leaveLinks}'s drafts and
     * fires, `InlineTaskWriter.firingTrials`), and answer what it leaves of
     * each row, in their order; null when it is refused, and the refusal told.
     */
    private async rehearse<F extends CompletionFire>(path: string, rows: readonly SentRow[], completing: SendCompleting<F>): Promise<Rehearsed | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        const channel = this.channelOf(path);
        if (!(file instanceof TFile)) {
            fileGone(channel, path, rows[0]?.target.subject ?? path);
            return null;
        }
        const { lines, eol } = splitLines(await readInLine(this.app, file));
        let sent: RowTarget[] = [];
        const firing = this.inline.firingTrials(
            (draft, session) => {
                const drafted = writeDrafts(draft, session, rows, completing);
                if (drafted === false) return false;
                sent = drafted.sent;
                return drafted.completed;
            },
            () => completing.fire(path),
            (draft, session): Rehearsed | false => {
                const left: { lines: readonly string[]; block: readonly PlacedLine[] }[] = [];
                for (const target of sent) {
                    const line = session.row(target);
                    if (line === null) return false;
                    const outline = draft.reading();
                    left.push({ lines: draft.lines.slice(line, outline.subtreeEnd(line)), block: subtreeBlock(outline, line) });
                }
                return left;
            },
        );
        const follow = channel ? channel.follow.bind(channel) : undefined;
        const edited = firing.trials.settle(one => editLines(path, lines, eol, one, { follow }));
        if (!edited.written) {
            channel?.refused(edited.refused);
            return null;
        }
        return firing.settled().after ?? null;
    }

    /**
     * Make the note `to` of the rows `items` sends and the frontmatter keys:
     * the lines are put together as a write to an empty note, held to the
     * same check (`editLines`), and the note is made of them whole
     * (`createFile`), in the folders its path names. Null when it is not,
     * and the user told why.
     */
    private async makeNote(to: SendTo, items: readonly Item[], subject: string): Promise<{ note: TFile; placed: Placed; before: readonly string[]; outcome: null } | null> {
        const channel = this.channelOf(to.path);
        let placed: Placed | null = null;
        // The lines of an empty note: the one a file with no terminator splits into.
        const edited = editLines(to.path, [''], '\n', (draft, _eol, session) => {
            placed = this.placeInNote(draft, session, items, to);
            return placed !== null;
        }, { about: subject });
        if (!edited.written) {
            channel?.refused(edited.refused);
            return null;
        }
        const created = await createFile(this.app, to.path, channel, subject, async () => {
            await this.fileOps.ensureDirectoryExists(to.path);
            return edited.lines.join('\n');
        });
        if (!created.written) return null;
        return { note: created.file, placed: placed!, before: [], outcome: null };
    }

    /**
     * Write the note `to`, one there is, in one write: the keys it has none
     * of, and the rows `items` makes of `own`, its own rows as their drafts
     * and fires leave them, carried, and every other one put. Null when it is
     * refused, and the user told why.
     */
    private async writeNote<F extends CompletionFire>(
        to: SendTo,
        own: readonly SentRow[],
        items: (sentOwn: readonly RowTarget[]) => readonly Item[],
        completing: SendCompleting<F>,
    ): Promise<{ note: TFile; placed: Placed; before: readonly string[]; outcome: FiringOutcome<F> | null } | null> {
        const file = this.app.vault.getAbstractFileByPath(to.path);
        const channel = this.channelOf(to.path);
        if (!(file instanceof TFile)) {
            fileGone(channel, to.path, own[0]?.target.subject ?? to.path);
            return null;
        }
        // The lines the write was handed, and where the own rows are to be
        // found once their drafts are written. Made anew on each run.
        let before: readonly string[] = [];
        let sentOwn: RowTarget[] = [];
        const outcome = await this.inline.writeFiring(file, channel, (draft, session) => {
            before = [...draft.lines];
            const drafted = writeDrafts(draft, session, own, completing);
            if (drafted === false) return false;
            sentOwn = drafted.sent;
            return drafted.completed;
        }, () => completing.fire(to.path), (draft, session) => this.placeInNote(draft, session, items(sentOwn), to) ?? false);
        if (!outcome.written) return null;
        return { note: file, placed: outcome.after!, before, outcome: own.length > 0 ? outcome : null };
    }

    /**
     * Inside the note's write: add the frontmatter keys it has none of, and
     * put the rows `items` makes in the section, in their order (see
     * {@link send}). Answers what the write leaves, or null when it is
     * refused, the reason said through the session.
     */
    private placeInNote(draft: LineDraft, session: WriteSession, items: readonly Item[], to: SendTo): Placed | null {
        const missing = to.frontmatter.filter(one => !FrontmatterLineEditor.hasKey(draft.lines, one.key));
        if (missing.length > 0) {
            const fmEnd = FrontmatterLineEditor.ensureBlock(draft);
            FrontmatterLineEditor.applyUpdates(draft, fmEnd, Object.fromEntries(missing.map(one => [one.key, [...one.yaml]])));
        }
        // Where each row's first line is, once put: the row itself when it
        // was carried, the line marked when it was put new.
        const heads: RowTarget[] = [];
        const puts: { from: string; mark: MarkedLine; length: number }[] = [];
        for (let k = 0; k < items.length; k++) {
            const item = items[k];
            let head: string;
            if ('own' in item) {
                const line = session.row(item.own);
                if (line === null) return null;
                head = ListNumber.first(draft.lines[line]);
            } else {
                head = ListNumber.first(item.block[0].text);
            }
            let spot: Spot;
            if (k === 0) {
                const inSection = HeadingInserter.sectionSpot(draft, to.section, head);
                if ('kind' in inSection) {
                    session.refuse({ kind: 'headings', name: to.section.heading, count: inSection.count });
                    return null;
                }
                spot = inSection;
            } else {
                const before = session.row(heads[k - 1]);
                if (before === null) return null;
                spot = Placement.afterSubtree(draft.reading(), before, head, indentUnit(this.app));
            }
            if ('own' in item) {
                // Asked again, past the heading the first spot may have made.
                const line = session.row(item.own);
                if (line === null) return null;
                carryTo(draft, line, spot, { flow: 'carry' });
                heads.push(item.own);
            } else {
                putNumbered(draft, spot, item.block);
                const mark = session.mark(spot.at);
                heads.push(mark);
                puts.push({ from: item.from, mark, length: item.block.length });
            }
        }
        const blocks: { from: string; range: readonly [number, number] }[] = [];
        for (const put of puts) {
            const at = session.row(put.mark);
            if (at === null) return null;
            blocks.push({ from: put.from, range: [at, at + put.length] });
        }
        return { left: [...draft.lines], blocks };
    }

    /**
     * Write the note at `path` the rows `rows` came from, once they are in
     * `note`: each draft, each fire, and each row's subtree replaced by a
     * line that links to `note` under the row's own marker (`1. [ ] 設計`
     * leaves `1. [[設計]]`), as one write (see {@link send}, 3). Each row is
     * taken away only while its subtree reads as `rehearsed` says went to
     * the note. A refusal is told to nobody: the caller has it from the
     * outcome.
     */
    private async leaveLinks<F extends CompletionFire>(
        path: string,
        rows: readonly SentRow[],
        rehearsed: Rehearsed,
        note: TFile,
        completing: SendCompleting<F>,
    ): Promise<FiringOutcome<F>> {
        const file = this.app.vault.getAbstractFileByPath(path);
        const channel = quiet(this.channelOf(path));
        if (!(file instanceof TFile)) return fileGone(channel, path, rows[0]?.target.subject ?? path);
        const link = noteLink(this.app.fileManager, note, path);
        let sent: RowTarget[] = [];
        return this.inline.writeFiring(file, channel, (draft, session) => {
            const drafted = writeDrafts(draft, session, rows, completing);
            if (drafted === false) return false;
            sent = drafted.sent;
            return drafted.completed;
        }, () => completing.fire(path), (draft, session) => {
            for (let k = 0; k < sent.length; k++) {
                const line = session.row(sent[k]);
                if (line === null) return false;
                const now = draft.lines.slice(line, draft.reading().subtreeEnd(line));
                const went = rehearsed[k].lines;
                if (now.length !== went.length || now.some((text, i) => text !== went[i])) return session.refuse({ kind: 'changed' });
                const marker = TaskLineClassifier.extractMarker(draft.lines[line]);
                if (replaceSubtree(draft, session, line, { text: marker + link, children: [] }) === false) return false;
            }
            return true;
        });
    }
}

/**
 * Write each row's draft, where it has one (`replaceSubtree`), and answer
 * where each row is to be found then — the row, or the line its
 * replacement marked — and the rows the drafts completed, in the order they
 * stand; false when the write is refused, the reason said through the
 * session.
 */
function writeDrafts<F extends CompletionFire>(
    draft: LineDraft,
    session: WriteSession,
    rows: readonly SentRow[],
    completing: SendCompleting<F>,
): { sent: RowTarget[]; completed: RowTarget[] } | false {
    const sent: RowTarget[] = [];
    const completed: RowTarget[] = [];
    for (const row of rows) {
        const line = session.row(row.target);
        if (line === null) return false;
        if (!row.draft) {
            sent.push(row.target);
            continue;
        }
        const rewritten = replaceSubtree(draft, session, line, row.draft);
        if (rewritten === false) return false;
        sent.push(rewritten[0].row);
        for (const one of rewritten) {
            if (completing.completes(one.was, one.now)) completed.push(one.row);
        }
    }
    return { sent, completed };
}

/** `channel`, with a refusal told to nobody: a write whose caller says what came of it. */
function quiet(channel: WriteChannel | undefined): WriteChannel | undefined {
    return channel ? { ...channel, refused: () => { } } : undefined;
}
