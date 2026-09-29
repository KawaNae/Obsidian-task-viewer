import type { TFile } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import type { RowSnapshot, SendRow } from '../core/TaskIndex';
import { outermostRows } from '../core/SendRows';
import { Destination, type Section } from '../persistence/Destination';
import { logWarn } from '../../log/log';
import type { InheritedValue } from './InheritedValues';
import type { TaskWriteService } from './TaskWriteService';

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

/** What came of a send: made, with the note the rows went to; or not, and the user told why. */
export type SendResult =
    | { kind: 'done'; note: TFile }
    | { kind: 'not-done' };

/**
 * The operations on notes the UI asks for: sending rows and their subtrees
 * to a section of a note (`v0.58-features.md`, 送る操作への一般化). Each takes
 * what the dialog holds as its arguments; what is told the user, the
 * operation tells, and the dialog only decides from the result whether it
 * closes.
 *
 * A send to the rows' own note is made (段 B2); one to another note, new or
 * there already, is not yet (段 B3).
 */
export class NoteOps {
    constructor(
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
     * (`Destination.taskSection`): the one a send can go to until a send to
     * another note is made (段 B3), which answers its own default.
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
     * Send the rows `req` names to its destination (`TaskIndex.send`). A
     * send the service does not make yet, or that its caller asked wrongly,
     * is not made, and said in the log: no user of the dialog can ask it.
     */
    async send(req: SendRequest): Promise<SendResult> {
        const { note, section } = req.to;
        if (note.kind === 'new') {
            logWarn(`[NoteOps] send: a send to a new note is not made yet: ${note.folder}/${note.name}`);
            return { kind: 'not-done' };
        }
        if (req.frontmatter.length > 0) {
            logWarn(`[NoteOps] send: frontmatter is written only to another note, which a send does not go to yet: ${note.path}`);
            return { kind: 'not-done' };
        }
        const written = await this.writeService.send(req.rows, { path: note.path, section });
        return written.kind === 'done' ? { kind: 'done', note: written.note } : { kind: 'not-done' };
    }
}
