import { EditorState, Transaction, type ChangeSet, type Extension, type Text, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { editorInfoField } from 'obsidian';
import type { StatusDefinition } from '../types';
import { completes, isOperation } from '../services/flow/FlowTrigger';
import type { FireOp } from '../services/flow/FlowExecutor';
import { editLines, editorRow } from '../services/persistence/FileLines';
import { firingTrials, type ApplyOps, type FiringOutcome } from '../services/persistence/FiringTrials';
import { lineChanges } from './LineChanges';
import { linesOf } from './EditorDoc';
import { contentKeyOf } from '../services/core/ContentKey';
import { logError } from '../log/log';

/**
 * What the editor's fire needs of the plugin: the settings' completion, the
 * flow layer's plan, the write layer's ops, and where the fires not run are
 * told. Closures,
 * so that the editor layer imports neither the index nor the repository.
 */
export interface EditorFireHost {
    /** False once the plugin has let go: nothing fires. */
    active(): boolean;
    statusDefinitions(): StatusDefinition[];
    fireOp(path: string): FireOp;
    applyOps: ApplyOps;
    /**
     * Tell the user of each completed row whose flow was not run, and why,
     * once the transaction that completed them is through: the rows stay
     * completed (`FlowNotices.firing`).
     */
    told(outcome: FiringOutcome<FireOp>): void;
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
 * The fires are one write over the document the transaction leaves, tried as
 * a card's write tries the fires of the rows it completed (`firingTrials`),
 * through the one core every write of lines runs (`editLines`, with the same
 * ops and the same checks as a write to the file): each row's fire is
 * planned inside the write from the lines the fires above it left, where its
 * row has been carried to, and a fire that is refused is set aside, its row
 * completed without it; the other rows' fires stand. The completion is in
 * the document already, so the write that fires nothing writes nothing, and
 * is always made. What the write made is turned into changes to the document
 * (`lineChanges`), and what the user is owed of the fires not run is told
 * once the transaction is through (`EditorFireHost.told`).
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
        const key = contentKeyOf(before);
        // Each row named by the line the transaction left it on, reading as it
        // left it: the write's session carries it across the fires above it.
        const completed = rows.map(row => editorRow(row.line, row.text, key));
        const firing = firingTrials(host.applyOps, () => completed, () => host.fireOp(path));
        const edited = firing.trials.settle(edit => editLines(path, before, '\n', edit));
        if (!edited.written) {
            // The write without fires writes nothing, and is never refused:
            // a refusal here is a bug of the write's.
            logError(`[FlowFire] ${path}: the completion alone was refused (${edited.refused.reason.kind}); nothing fired`);
            return [tr, isolated];
        }
        const outcome: FiringOutcome<FireOp> = { written: true, refused: null, fires: firing.settled().fires };
        // Not inside the transaction filter: the notice waits for it.
        queueMicrotask(() => host.told(outcome));

        const changes = lineChanges(before, edited.lines, edited.edits);
        if (changes === null) {
            logError(`[FlowFire] ${path}: a fire's write does not follow; nothing written`);
            return [tr, isolated];
        }
        if (changes.length === 0) return [tr, isolated];
        return [tr, { ...isolated, changes, sequential: true }];
    });
}
