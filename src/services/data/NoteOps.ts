import { Notice, type App, type TFile } from 'obsidian';
import { t } from '../../i18n';
import type { Task, TaskViewerSettings } from '../../types';
import { HeadingInserter } from '../../utils/HeadingInserter';
import { openFile } from '../../utils/NavigationUtils';
import type { RowSnapshot, SendRow, SendWrite } from '../core/TaskIndex';
import { refusalClause, refusalNotice } from '../core/RefusalClause';
import { outermostRows } from '../core/SendRows';
import { unresolvedAt, type UnresolvedReference } from '../flow/FlowReferences';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import { Outline } from '../parsing/utils/Outline';
import { Destination, type Section } from '../persistence/Destination';
import { splitLines } from '../persistence/FileLines';
import { FrontmatterLineEditor } from '../persistence/utils/FrontmatterLineEditor';
import { Placement, type HeadingLookup } from '../persistence/utils/Placement';
import { logWarn } from '../../log/log';
import { inheritedAt, type InheritedValue } from './InheritedValues';
import type { TaskWriteService } from './TaskWriteService';
import { NoteName, type NameCheck } from './NoteName';
import { anchorsIn, linksTo, type AnchorLink, type LineSpan } from './NoteRefs';

export type { SendRow } from '../core/TaskIndex';

/** The note a send goes to: one to make, by its folder and name, or one there is, by its path. */
export type SendNote =
    | { kind: 'new'; folder: string; name: string }
    | { kind: 'existing'; path: string };

/** Where a send goes: a note, and the section of it (`Section`). */
export interface SendDestination {
    note: SendNote;
    section: Section;
}

/** A send, as its dialog asks for it (`NoteOps.send`). */
export interface SendRequest {
    /** The rows, as the dialog was opened on them, each with its draft if the user wrote one. */
    rows: readonly SendRow[];
    to: SendDestination;
    /**
     * The keys to write into the note's frontmatter, those the user chose of
     * the values the rows inherit (`InheritedValues`); none for a send to
     * the rows' own note, which holds them already.
     */
    frontmatter: readonly InheritedValue[];
}

/**
 * What the send dialog opens on (`NoteOps.previewSend`): the rows it sends,
 * each once and in the order they stand, each with its note's lines as the
 * disk holds them; where they go unless the user says otherwise; the values
 * they inherit, to offer as the note's frontmatter; and the links that break
 * when they leave their note.
 */
export interface SendPreview {
    rows: readonly RowSnapshot[];
    /**
     * The destination the dialog opens with, at the settings' section
     * (`Destination.taskSection`). The note is the one the first row's text
     * links to, when it links to exactly one: a note of the vault, or else a
     * new note where the link spells it (its folder, or the settings' folder
     * for new notes when it spells none). Otherwise a new note in the
     * settings' folder for new notes, named after the row's text
     * (`NoteName.fromText`). A new note that is one of the vault's once
     * named — case aside — is that note, as the dialog's fields say
     * (`NoteName.at`).
     */
    defaults: SendDestination;
    /**
     * The values the rows inherit, each said as a frontmatter key
     * (`inheritedAt`), in the order the first row's are: the frontmatter the
     * dialog offers to write into the note. Of more than one row, only the
     * keys every row inherits alike, line for line. Which to check by
     * default is `obsidian`'s to say.
     */
    candidates: readonly InheritedValue[];
    /**
     * The links, anywhere in the vault, to a block of a row's subtree by its
     * `^id` (`linksTo`): they break when the rows go to another note. The
     * same wherever they go; the dialog says nothing of them for the rows'
     * own note.
     */
    links: readonly AnchorLink[];
}

/** What the send dialog's fields say of the destination (`NoteOps.destinationFacts`), as typed. */
export interface DestinationAsk {
    folder: string;
    name: string;
    /** The heading to go under; empty for the settings' (`taskHeading`). */
    heading: string;
}

/**
 * What the destination the fields name is, for the dialog to say before the
 * send (`NoteOps.destinationFacts`): a name no note can have, and why
 * (`NoteName.check`); or a note, and what a send there meets.
 */
export type DestinationFacts =
    | { kind: 'unnamed'; why: Extract<NameCheck, { ok: false }> }
    | NoteFacts;

/**
 * A note the fields name, as it stands now. Asked again whenever a field
 * changes; the note may change between the asking and the send, which reads
 * it again.
 */
export interface NoteFacts {
    /**
     * `new`: no note is at the path, and the send makes one. `existing`: one
     * of the vault's, the rows' own note or not. `same`: the note every row
     * stands in, where the rows are carried and nothing is written into the
     * frontmatter.
     */
    kind: 'new' | 'existing' | 'same';
    /** The note's path, spelt as the vault spells it when it has the note. */
    path: string;
    /** Where the send goes, as `SendRequest.to` takes it. */
    to: SendDestination;
    /** The heading of `to.section` in the note: one, none (the send makes it), or more than one (the send is refused). */
    heading: HeadingLookup;
    /** The names of the note's headings, in the order they stand: those the heading field offers. */
    headings: readonly string[];
    /** The keys of `SendPreview.candidates` the note's frontmatter has already: a send does not write them. */
    present: readonly string[];
    /** The note is one the index does not read (`tv-ignore`): the rows are not seen there. */
    ignored: boolean;
    /** The vault's other notes by the note's name, in other folders (`NoteAt.namesakes`). */
    namesakes: readonly TFile[];
    /**
     * The `^id`s of rows from other notes that the note carries already: once
     * sent, neither line is the anchor. None for rows of the note itself.
     */
    shared: readonly string[];
    /**
     * The references in the commands of the rows and their descendants that
     * the note does not resolve (`unresolvedAt`), read with the heading the
     * send makes when it has none.
     */
    unresolved: readonly UnresolvedReference[];
}

/**
 * What came of a send: made, with the note the rows went to; made for some
 * rows, and not for those of the notes `refused` names; or not made. The
 * user has been told, once — but of `not-done` only when the caller did not
 * ask to show it itself (`tellRefusal: false`).
 *
 * `why` is what came of it in one sentence, for the dialog to show beside the
 * draft it keeps: the notice's words. `partly` is told by a notice all the
 * same, since the note was written, and its notice links it.
 */
export type SendResult =
    | { kind: 'done'; note: TFile }
    | { kind: 'partly'; note: TFile; refused: readonly string[]; why: string }
    | { kind: 'not-done'; why: string };

/**
 * The operations on notes the UI asks for: sending rows and their subtrees
 * to a section of a note (`v0.58-features.md`, 送る操作への一般化). Each takes
 * what the dialog holds as its arguments; what is told the user, the
 * operation tells, and the dialog only decides from the result whether it
 * closes.
 */
export class NoteOps {
    constructor(
        private app: App,
        private writeService: TaskWriteService,
        private getSettings: () => TaskViewerSettings,
    ) { }

    /**
     * What a send of `taskIds` opens on, read as the disk holds each row
     * (`TaskIndex.rowSnapshot`): a row inside another's subtree goes with
     * that one (`outermostRows`). Null when a row is not the one on the
     * disk, and the user told why, as for a write.
     */
    async previewSend(taskIds: readonly string[]): Promise<SendPreview | null> {
        const rows: RowSnapshot[] = [];
        for (const id of taskIds) {
            const row = await this.writeService.rowSnapshot(id);
            if (!row) return null;
            rows.push(row);
        }
        const sent = outermostRows(rows);
        if (sent.length === 0) return null;
        const settings = this.getSettings();
        return {
            rows: sent,
            defaults: { note: this.defaultNote(sent[0].task), section: Destination.taskSection(settings) },
            candidates: commonValues(sent.map(row => inheritedAt(row.lines, row.task.line, settings))),
            links: byNote(sent).flatMap(({ path, rows: ofNote }) => linksTo(
                this.app.metadataCache,
                path,
                anchorsIn(ofNote.flatMap(row => row.task.subtreeLines ?? [])),
                ofNote.map(row => spanOf(row.task)),
            )),
        };
    }

    /**
     * What the destination the dialog's fields name is (see
     * {@link NoteFacts}), the note read as the vault holds it now. The
     * section is the heading typed, or the settings' when none is, at the
     * settings' level and side (`Destination.sectionNamed`).
     */
    async destinationFacts(preview: SendPreview, ask: DestinationAsk): Promise<DestinationFacts> {
        const name = NoteName.check(ask.name);
        if (!name.ok) return { kind: 'unnamed', why: name };
        const settings = this.getSettings();
        const heading = ask.heading.trim();
        const section = Destination.sectionNamed(heading === '' ? settings.taskHeading : heading, settings);
        const at = NoteName.at(this.app.vault, ask.folder, ask.name);
        const rows = preview.rows;
        const sentTasks = byNote(rows).flatMap(({ rows: ofNote }) => withDescendants(ofNote, settings));

        if (at.kind === 'new') {
            return {
                kind: 'new',
                path: at.path,
                to: { note: { kind: 'new', folder: ask.folder, name: ask.name }, section },
                heading: { kind: 'none' },
                headings: [],
                present: [],
                ignored: false,
                namesakes: at.namesakes,
                shared: [],
                unresolved: unresolvedAt(sentTasks, [HeadingInserter.headingLine(section)]),
            };
        }

        const path = at.file.path;
        const { lines } = splitLines(await this.app.vault.read(at.file));
        const outline = Outline.read(lines);
        const found = Placement.heading(outline, section.heading);
        const inNote = new Set(anchorsIn(lines));
        return {
            kind: rows.every(row => row.task.file === path) ? 'same' : 'existing',
            path,
            to: { note: { kind: 'existing', path }, section },
            heading: found,
            headings: outline.headings.map(h => h.text),
            present: preview.candidates.filter(one => FrontmatterLineEditor.hasKey(lines, one.key)).map(one => one.key),
            ignored: FileParsePipeline.resolveTree(path, lines, settings) === null,
            namesakes: at.namesakes,
            shared: anchorsIn(rows.filter(row => row.task.file !== path).flatMap(row => row.task.subtreeLines ?? []))
                .filter(id => inNote.has(id)),
            unresolved: unresolvedAt(sentTasks, found.kind === 'none' ? [...lines, HeadingInserter.headingLine(section)] : lines),
        };
    }

    /** The note a send of `task` goes to by default (see `SendPreview.defaults`). */
    private defaultNote(task: Task): SendNote {
        const links = NoteName.linksIn(task.content);
        if (links.length === 1) {
            const linked = this.app.metadataCache.getFirstLinkpathDest(links[0], task.file);
            if (!linked) {
                const spelt = links[0].replace(/\.md$/i, '');
                const cut = spelt.lastIndexOf('/');
                return {
                    kind: 'new',
                    folder: cut < 0 ? NoteName.defaultFolder(this.app, task.file) : spelt.slice(0, cut),
                    name: spelt.slice(cut + 1),
                };
            }
            // A link to an attachment names no note to send to.
            if (linked.extension === 'md') return { kind: 'existing', path: linked.path };
        }
        return { kind: 'new', folder: NoteName.defaultFolder(this.app, task.file), name: NoteName.fromText(task.content) };
    }

    /**
     * Send the rows `req` names to its destination (`TaskIndex.send`), and
     * tell the user what came of it, once.
     *
     * A new note is looked up again as the send is made (`NoteName.at`): a
     * path a note has, in any case, is that note, and the rows go to it as to
     * one there is. A send its caller asked wrongly — a name no note can
     * have, a key given twice — is not made, and said in the log: the dialog
     * does not ask it.
     *
     * With `opts.tellRefusal` false, a send not made is not told: the caller
     * shows `why` itself, as the hub's source mode shows a draft it could
     * not write, and a notice would say it twice.
     */
    async send(req: SendRequest, opts: { tellRefusal?: boolean } = {}): Promise<SendResult> {
        const wrongly: SendResult = { kind: 'not-done', why: t('notice.notSent') };
        const { note, section } = req.to;
        let path: string;
        let create = false;
        if (note.kind === 'new') {
            const name = NoteName.check(note.name);
            if (!name.ok) {
                logWarn(`[NoteOps] send: not a name a note can have (${name.why}): ${note.name}`);
                return wrongly;
            }
            const at = NoteName.at(this.app.vault, note.folder, note.name);
            path = at.kind === 'existing' ? at.file.path : at.path;
            create = at.kind === 'new';
        } else {
            path = note.path;
        }
        const keys = req.frontmatter.map(one => one.key);
        if (new Set(keys).size !== keys.length) {
            logWarn(`[NoteOps] send: a frontmatter key is given twice: ${keys.join(', ')}`);
            return wrongly;
        }
        const written = await this.writeService.send(req.rows, { path, create, section, frontmatter: req.frontmatter }, opts);
        if (written.kind === 'not-done') return written.refused ? { kind: 'not-done', why: refusalNotice(written.refused) } : wrongly;
        return this.tell(written, req.rows.length, opts.tellRefusal !== false);
    }

    /**
     * Tell the user what came of a send the note was written for, once, the
     * note a link that opens it (`openFile`): the rows sent, and that an
     * undo in the note they came from leaves them in both (判断 8); some sent
     * and the others not, and why; none sent. When what went of the rows
     * that were not sent could not be taken out of the note again, they are
     * in both notes, and the notice says so. A send within the rows' own
     * note is not told, and none sent is not when `tellNotDone` is false.
     */
    private tell(written: Extract<SendWrite, { kind: 'done' }>, asked: number, tellNotDone: boolean): SendResult {
        const { note, landed, refused, takenBack } = written;
        const why = refused.map(one => t('notice.sendRefused', { note: one.file, reason: refusalClause(one.reason), subject: one.subject }));
        const stranded = takenBack ? [] : [t('notice.sendStranded', { note: note.path })];
        if (refused.length === 0) {
            // Within its own note, the rows are where the user looks: one
            // write, which an undo takes back whole.
            if (landed.every(path => path === note.path)) return { kind: 'done', note };
            this.tellOf(asked === 1 ? t('notice.sent', { subject: written.subject, note: note.path }) : t('notice.sentRows', { count: asked, note: note.path }), note);
            return { kind: 'done', note };
        }
        if (landed.length === 0 && takenBack) {
            const text = [t('notice.notSent'), ...why].join(' ');
            if (tellNotDone) new Notice(text);
            return { kind: 'not-done', why: text };
        }
        const head = landed.length === 0 ? t('notice.notSent') : t('notice.sentPartly', { note: note.path });
        const text = [head, ...why, ...stranded].join(' ');
        this.tellOf(text, note);
        return { kind: 'partly', note, refused: refused.map(one => one.file), why: text };
    }

    /**
     * Tell the user `text`, the note's path in it a link that opens the note
     * as the plugin opens a note (`openFile`, by the setting
     * `reuseExistingTab`).
     */
    private tellOf(text: string, note: TFile): void {
        const notice = new Notice(text);
        // Off Obsidian (the unit tests) a notice has no element to link in.
        const el = (notice as { messageEl?: HTMLElement }).messageEl;
        const at = text.indexOf(note.path);
        if (!el || at < 0) return;
        el.empty();
        el.appendText(text.slice(0, at));
        const link = el.createEl('a', { text: note.path, href: '#', cls: 'internal-link' });
        link.addEventListener('click', (e) => {
            e.preventDefault();
            notice.hide();
            openFile(this.app, note.path, this.getSettings().reuseExistingTab);
        });
        el.appendText(text.slice(at + note.path.length));
    }
}

/** The rows grouped by the note they stand in, the notes in the order their first row stands. */
function byNote(rows: readonly RowSnapshot[]): { path: string; rows: RowSnapshot[] }[] {
    const out: { path: string; rows: RowSnapshot[] }[] = [];
    for (const row of rows) {
        const of = out.find(one => one.path === row.task.file);
        if (of) of.rows.push(row);
        else out.push({ path: row.task.file, rows: [row] });
    }
    return out;
}

/** The lines of a row and its subtree. */
function spanOf(task: Task): LineSpan {
    return { start: task.line, end: task.line + (task.subtreeLines?.length ?? 1) };
}

/**
 * The rows of one note and every task in their subtrees, read off the lines
 * the rows were read in (`RowSnapshot.lines`), as the index reads them.
 */
function withDescendants(rows: readonly RowSnapshot[], settings: TaskViewerSettings): Task[] {
    const spans = rows.map(row => spanOf(row.task));
    const { tasks } = FileParsePipeline.parse(rows[0].task.file, [...rows[0].lines], settings);
    return tasks.filter(task => spans.some(span => task.line >= span.start && task.line < span.end));
}

/** The values of `each[0]` every list holds alike: the same key, said in the same lines. */
function commonValues(each: readonly (readonly InheritedValue[])[]): InheritedValue[] {
    const [first = [], ...rest] = each;
    const same = (a: InheritedValue, b: InheritedValue) =>
        a.key === b.key && a.yaml.length === b.yaml.length && a.yaml.every((line, i) => line === b.yaml[i]);
    return first.filter(one => rest.every(other => other.some(value => same(value, one))));
}
