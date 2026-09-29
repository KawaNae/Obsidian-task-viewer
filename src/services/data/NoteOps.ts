import { Notice, type App, type TFile } from 'obsidian';
import { t } from '../../i18n';
import type { TaskViewerSettings } from '../../types';
import { openFile } from '../../utils/NavigationUtils';
import type { RowSnapshot, SendRow, SendWrite } from '../core/TaskIndex';
import { refusalClause } from '../core/RefusalClause';
import { outermostRows } from '../core/SendRows';
import { Destination, type Section } from '../persistence/Destination';
import { logWarn } from '../../log/log';
import type { InheritedValue } from './InheritedValues';
import type { TaskWriteService } from './TaskWriteService';
import { NoteName } from './NoteName';

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
 * disk holds them; and where they go unless the user says otherwise.
 */
export interface SendPreview {
    rows: readonly RowSnapshot[];
    defaults: SendDestination;
}

/**
 * What came of a send: made, with the note the rows went to; made for some
 * rows, and not for those of the notes `refused` names; or not made. The
 * user has been told, once, either way.
 */
export type SendResult =
    | { kind: 'done'; note: TFile }
    | { kind: 'partly'; note: TFile; refused: readonly string[] }
    | { kind: 'not-done' };

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
     *
     * The destination is the rows' own note, at the settings' section
     * (`Destination.taskSection`), until the dialog answers its own default
     * (段 B5).
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
        return {
            rows: sent,
            defaults: { note: { kind: 'existing', path: sent[0].task.file }, section: Destination.taskSection(this.getSettings()) },
        };
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
     */
    async send(req: SendRequest): Promise<SendResult> {
        const { note, section } = req.to;
        let path: string;
        let create = false;
        if (note.kind === 'new') {
            const name = NoteName.check(note.name);
            if (!name.ok) {
                logWarn(`[NoteOps] send: not a name a note can have (${name.why}): ${note.name}`);
                return { kind: 'not-done' };
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
            return { kind: 'not-done' };
        }
        const written = await this.writeService.send(req.rows, { path, create, section, frontmatter: req.frontmatter });
        if (written.kind === 'not-done') return written;
        return this.tell(written, req.rows.length);
    }

    /**
     * Tell the user what came of a send the note was written for, once, the
     * note a link that opens it (`openFile`): the rows sent, and that an
     * undo in the note they came from leaves them in both (判断 8); some sent
     * and the others not, and why; none sent. When what went of the rows
     * that were not sent could not be taken out of the note again, they are
     * in both notes, and the notice says so. A send within the rows' own
     * note is not told.
     */
    private tell(written: Extract<SendWrite, { kind: 'done' }>, asked: number): SendResult {
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
            new Notice([t('notice.notSent'), ...why].join(' '));
            return { kind: 'not-done' };
        }
        const head = landed.length === 0 ? t('notice.notSent') : t('notice.sentPartly', { note: note.path });
        this.tellOf([head, ...why, ...stranded].join(' '), note);
        return { kind: 'partly', note, refused: refused.map(one => one.file) };
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
