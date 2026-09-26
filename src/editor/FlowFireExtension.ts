import { EditorState, Transaction, type ChangeSet, type Extension, type Text, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { editorInfoField } from 'obsidian';
import type { StatusDefinition } from '../types';
import { completes, isOperation } from '../services/flow/FlowTrigger';
import type { FireOp, FirePlan } from '../services/flow/FlowExecutor';
import type { TaskOp } from '../services/persistence/TaskOps';
import {
    editLines, replayEdits,
    type EditorLine, type LineEdit, type LineDraft, type NamedRow, type Refusal, type WriteSession,
} from '../utils/FileLines';
import { lineChanges } from './LineChanges';
import { linesOf } from './EditorDoc';
import { contentKeyOf } from '../services/core/ContentKey';
import { logError, logWarn } from '../log/log';

/**
 * What the editor's fire needs of the plugin: the settings' completion, the
 * flow layer's plan, the write layer's ops, and where refusals go. Closures,
 * so that the editor layer imports neither the index nor the repository.
 */
export interface EditorFireHost {
    /** False once the plugin has let go: nothing fires. */
    active(): boolean;
    statusDefinitions(): StatusDefinition[];
    fireOp(path: string): FireOp;
    applyOps(draft: LineDraft, session: WriteSession, target: NamedRow | EditorLine, ops: readonly TaskOp[]): boolean;
    /** Tell the user a write was not made, and why (the index's `reportRefusal`). */
    refused(refusal: Refusal): void;
    /** Tell the user a fire could not be planned (`FlowExecutor.reportDidNotFire`). */
    didNotFire(plan: Extract<FirePlan, { kind: 'failed' }>): void;
}

/** A row an editor transaction completed: its line in the document after it, and the text there. */
export interface CompletedRow {
    line: number;
    text: string;
}

/**
 * The rows a transaction completed: each change whose range is one line
 * before and one line after, over a line that goes from an incomplete task to
 * a complete one (`completes`). A line two changes touched is one row. A
 * change over several lines completes nothing: pasting or moving a completed
 * line is not completing it.
 */
export function completedRows(startDoc: Text, doc: Text, changes: ChangeSet, defs: StatusDefinition[]): CompletedRow[] {
    const rows: CompletedRow[] = [];
    const seen = new Set<number>();
    changes.iterChanges((fromA, toA, fromB, toB) => {
        const before = startDoc.lineAt(fromA);
        const after = doc.lineAt(fromB);
        if (startDoc.lineAt(toA).number !== before.number || doc.lineAt(toB).number !== after.number) return;
        if (!completes(before.text, after.text, defs)) return;
        const line = after.number - 1;
        if (seen.has(line)) return;
        seen.add(line);
        rows.push({ line, text: after.text });
    });
    return rows;
}

/**
 * The fire of a completion made in the editor, in the transaction that made
 * it (`transactionFilter`): a transaction that is an operation
 * (`isOperation`) and completes rows (`completedRows`) has each row's fire
 * planned from the document it leaves and written into the same transaction,
 * so the completion and its fire are one change, and one step to undo. A
 * transaction that is no operation — a file loaded or synced into the
 * editor, another pane's edit shown here, an undo, a redo — fires nothing,
 * whatever it completes.
 *
 * A completion is a step of its own to undo, fire or none: the transaction is
 * isolated in the history (`isolateHistory`), so completing rows one after
 * another, however quickly, is undone one completion at a time.
 *
 * Each row's fire is its own write, in the order the rows stand: planned from
 * the lines the rows before it left, where its row has been carried to, and
 * made through the one core every write of lines runs (`editLines`, with the
 * same ops and the same checks as a write to the file). A fire with nothing
 * to write is not written. A fire that is refused leaves its row completed
 * without it, and the user is told of that row; the other rows' fires stand.
 * What the fires wrote is turned into changes to the document
 * (`lineChanges`).
 */
export function fireFilter(host: EditorFireHost): Extension {
    return EditorState.transactionFilter.of((tr): TransactionSpec | readonly TransactionSpec[] => {
        if (!tr.docChanged || !isOperation(tr.annotation(Transaction.userEvent)) || !host.active()) return tr;
        const rows = completedRows(tr.startState.doc, tr.newDoc, tr.changes, host.statusDefinitions());
        if (rows.length === 0) return tr;
        const isolated: TransactionSpec = { annotations: isolateHistory.of('full') };
        const path = tr.startState.field(editorInfoField, false)?.file?.path;
        if (!path) return [tr, isolated];

        const before = linesOf(tr.newDoc);
        let lines: readonly string[] = before;
        const edits: LineEdit[] = [];
        // Where the row that stood at `line` of the document stands now, past
        // the fires already written; -1 if one of them took it away.
        const carried = (line: number): number =>
            edits.length === 0 ? line : replayEdits(before.length, edits)?.origin.indexOf(line) ?? -1;
        for (const row of rows) {
            const line = carried(row.line);
            if (line < 0) {
                logWarn(`[FlowFire] ${path}: a completed row was taken away by the fire of a row above it; not fired`);
                continue;
            }
            const fire = host.fireOp(path);
            // Planned where `applyOps` would plan it, first: from the lines
            // the write is handed, at the row.
            const ops = fire.op.plan(lines, line);
            const planned = fire.planned();
            if (planned?.kind === 'failed') queueMicrotask(() => host.didNotFire(planned));
            if (ops.length === 0) continue;
            // The row is named by the line our own writes' map says it is
            // (`replayEdits`), read as those writes left it: whatever a fire
            // above did to it (a move carrying it re-indented, say) is ours,
            // not a change of the note's. Before any fire, that is the line
            // the transaction completed.
            const edited = editLines(path, lines, '\n',
                (draft, _eol, session) => host.applyOps(draft, session, { line, text: lines[line], key: contentKeyOf(lines) }, ops));
            if (!edited.written) {
                host.refused(edited.refused);
                continue;
            }
            lines = edited.lines;
            edits.push(...edited.edits);
        }

        const changes = lineChanges(before, lines, edits);
        if (changes === null) {
            logError(`[FlowFire] ${path}: a fire's write does not follow; nothing written`);
            return [tr, isolated];
        }
        if (changes.length === 0) return [tr, isolated];
        return [tr, { ...isolated, changes, sequential: true }];
    });
}

export type { EditorHandle } from './EditorWrite';

/** The editor's fire, as one extension (`fireFilter`). */
export function flowFireExtension(host: EditorFireHost): Extension {
    return fireFilter(host);
}
