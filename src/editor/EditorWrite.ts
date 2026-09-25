import type { EditorState, StateEffect, TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { editorInfoField } from 'obsidian';
import type { TaskOp } from '../services/persistence/TaskOps';
import { editLines, type EditorLine, type LineDraft, type NamedRow, type Refusal, type WriteOutcome, type WriteSession } from '../utils/FileLines';
import { lineChanges } from './LineChanges';
import { linesOf } from './EditorDoc';
import { logError } from '../log/log';

/** What a write to an editor reads and writes of it. */
export interface EditorHandle {
    readonly state: EditorState;
    dispatch(spec: TransactionSpec): void;
}

/** The one loop that applies ops to a row inside a write (`InlineTaskWriter.applyOps`). */
export type ApplyOps = (draft: LineDraft, session: WriteSession, target: NamedRow | EditorLine, ops: readonly TaskOp[]) => boolean;

/**
 * Write `ops` to the row at a line the editor pointed at, in the editor's
 * document: the one core every write of lines runs (`editLines`, with the
 * same ops and the same check as a write to the file), turned into changes to
 * the document (`lineChanges`) and dispatched with `effects` as one
 * transaction. The line is taken only in the content it was taken in
 * (`EditorLine.key`): the editor has to read as it did.
 *
 * The transaction is a step of its own to undo (`isolateHistory`), whatever
 * was typed just before or after it. It is an operation in the editor, marked
 * as none (`isOperation`): a rewrite that completes the row fires in it, as a
 * click on the box does (`fireFilter`).
 *
 * Nothing is dispatched when the write is not made. The refusal is the
 * caller's to tell.
 */
export function writeInEditor(
    editor: EditorHandle,
    path: string,
    at: EditorLine,
    ops: readonly TaskOp[],
    applyOps: ApplyOps,
    effects: readonly StateEffect<unknown>[] = [],
): WriteOutcome {
    const edited = editLines(path, linesOf(editor.state.doc), '\n',
        (draft, _eol, session) => applyOps(draft, session, at, ops));
    if (!edited.written) return { written: false, refused: edited.refused };
    const changes = lineChanges(edited.before, edited.lines, edited.edits);
    if (changes === null) {
        logError(`[EditorWrite] ${path}: a write's report does not follow; nothing written`);
        return { written: false, refused: { file: path, reason: { kind: 'failed' }, subject: at.text.trim() } };
    }
    editor.dispatch({ changes, effects: [...effects], annotations: isolateHistory.of('full') });
    return { written: true, refused: null };
}

/** What the editor menu's write needs of the plugin. */
export interface EditorLineHost {
    applyOps: ApplyOps;
    /** Tell the user a write was not made, and why (the index's `reportRefusal`). */
    refused(refusal: Refusal): void;
    /** The write to the file, for an editor that no longer shows it (`TaskIndex.writeLine`). */
    writeLine(path: string, at: EditorLine, ops: readonly TaskOp[]): Promise<boolean>;
}

/**
 * The editor menu's write of `ops` to the line it was opened on: in the
 * editor, while the editor still shows the note, and to the file once it
 * does not. Either way the line holds only in the content the menu was opened
 * in (`EditorLine.key`), the editor's or the file's; in any other, nothing is
 * written, and the user is told.
 *
 * Written in the editor, it reaches the file as the user's typing does, when
 * the editor saves. `editor` is null when the menu's editor is gone.
 *
 * @returns whether the line was written.
 */
export async function writeEditorLine(
    editor: EditorHandle | null,
    path: string,
    at: EditorLine,
    ops: readonly TaskOp[],
    host: EditorLineHost,
): Promise<boolean> {
    if (editor === null || editor.state.field(editorInfoField, false)?.file?.path !== path) {
        return host.writeLine(path, at, ops);
    }
    const outcome = writeInEditor(editor, path, at, ops, host.applyOps);
    if (outcome.refused) host.refused(outcome.refused);
    return outcome.written;
}
