import { EditorState, StateEffect, StateField, Transaction, type ChangeSet, type Extension, type Text, type TransactionSpec } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { editorInfoField } from 'obsidian';
import type { StatusDefinition } from '../types';
import { completes, isOperation } from '../services/flow/FlowTrigger';
import type { FireOp, FirePlan, PendingAway, SourceWrite } from '../services/flow/FlowExecutor';
import type { TaskOp } from '../services/persistence/TaskOps';
import {
    editLines, replayEdits,
    type EditorLine, type LineEdit, type EditorSubtree, type LineDraft, type NamedRow, type Refusal, type WriteOutcome, type WriteSession,
} from '../utils/FileLines';
import { lineChanges } from './LineChanges';
import { keyOf, linesOf } from './EditorDoc';
import { shows, writeInEditor, type EditorHandle } from './EditorWrite';
import { contentKeyOf } from '../services/core/ContentKey';
import { logError, logWarn } from '../log/log';

/**
 * What the editor's fire needs of the plugin: the settings' completion, the
 * flow layer's plan, the write layer's ops, and where refusals and the rest of
 * a completing write go. Closures, so that the editor layer imports neither
 * the index nor the repository.
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
    /** The rest of a move to another file (`FlowExecutor.finishAway`). */
    finishAway(away: PendingAway, writeSource: SourceWrite): Promise<void>;
    /** The source's write to the file, for an editor closed before the move got to it. */
    writeFile(path: string, at: EditorSubtree, ops: readonly TaskOp[]): Promise<WriteOutcome>;
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

/** Where the document's line `line` (0-based) starts. */
function startOf(lines: readonly string[], line: number): number {
    let offset = 0;
    for (let i = 0; i < line; i++) offset += lines[i].length + 1;
    return offset;
}

/**
 * A move to another file a completion in this editor planned, waiting for its
 * destination: `pos` is where the row's line starts in `doc`, carried across
 * every transaction of this editor's own since (`changes.mapPos`) — a
 * position the editor moved, not a guess.
 *
 * The position counts only in `doc`, the content it was carried into. A
 * change shown from outside (`set`: a write to the file, ours or another
 * app's) is Obsidian's diff of two contents, which cannot tell twins apart:
 * carried across it, a position can land on the row's twin. So neither it
 * nor anything after it is followed, and the source's write, made in another
 * content, is refused (`EditorLine.key`).
 */
interface Away {
    id: number;
    path: string;
    pos: number;
    doc: Text;
    pending: PendingAway;
}

/** Whether a transaction carries a move's position: one this editor made to the content the position counts in. */
function follows(away: Away, tr: Transaction): boolean {
    return away.doc === tr.startState.doc && !tr.isUserEvent('set');
}

const addAway = StateEffect.define<Omit<Away, 'doc'>>();
const dropAway = StateEffect.define<number>();

/** The moves this editor's completions planned and has not yet written back. */
const awayField = StateField.define<readonly Away[]>({
    create: () => [],
    update(aways, tr) {
        // Carried first: one this transaction adds already stands where it
        // says, in the document the transaction leaves.
        let next = tr.docChanged
            ? aways.map(away => (follows(away, tr) ? { ...away, pos: tr.changes.mapPos(away.pos, 1), doc: tr.newDoc } : away))
            : aways;
        for (const effect of tr.effects) {
            if (effect.is(addAway)) next = [...next, { ...effect.value, doc: tr.newDoc }];
            else if (effect.is(dropAway)) next = next.filter(away => away.id !== effect.value);
        }
        return next;
    },
});

let nextAwayId = 0;

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
        const aways: Array<{ row: CompletedRow; pending: PendingAway }> = [];
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
            const pending = fire.away();
            if (pending) aways.push({ row, pending });
            if (ops.length === 0) continue;
            const edited = editLines(path, lines, '\n',
                (draft, _eol, session) => host.applyOps(draft, session, { line, text: row.text, key: contentKeyOf(lines) }, ops));
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
        // What the rows' moves to another file owe once the transaction is
        // made, from the row where every fire left it.
        const effects: StateEffect<Omit<Away, 'doc'>>[] = [];
        for (const { row, pending } of aways) {
            const line = carried(row.line);
            if (line < 0) {
                logWarn(`[FlowFire] ${path}: a move's row is not where the write left it; not moved`);
                continue;
            }
            effects.push(addAway.of({
                id: nextAwayId++,
                path,
                pos: startOf(lines, line),
                pending: { ...pending, source: { ...pending.source, line, key: contentKeyOf(lines) } },
            }));
        }
        if (changes.length === 0 && effects.length === 0) return [tr, isolated];
        return [tr, { ...isolated, changes, effects, sequential: true }];
    });
}

export type { EditorHandle } from './EditorWrite';

/**
 * The rest of each move to another file an editor's completion planned: the
 * destination, then the source's write to this editor, to the row where its
 * position has been carried to, in the content it was carried into (`Away`).
 * The editor has to read as that content, and the row as the completion left
 * it: undone since, or edited, it is not taken away; shown a change from
 * outside since, nothing is. Either way the user is told the task is now in
 * both files. An editor that no longer shows the note by then (`shows`:
 * closed, or showing another) has the write made to the file instead, at the
 * line the row was last carried to, if the file reads as that content.
 */
export class AwayRunner {
    /** The plugin has let go of the editor: its state, and the moves in it, are `last`. */
    private closed = false;
    /** The editor's state as the plugin last held it, for a move that finishes after the plugin let go of it. */
    private last: EditorState;

    constructor(private readonly editor: EditorHandle, private readonly host: EditorFireHost) {
        this.last = editor.state;
    }

    /** The moves a transaction added, started once it is made. */
    added(transactions: readonly Transaction[], state: EditorState): Promise<void>[] {
        this.last = state;
        const runs: Promise<void>[] = [];
        for (const tr of transactions) {
            for (const effect of tr.effects) {
                if (effect.is(addAway)) runs.push(Promise.resolve().then(() => this.run(effect.value)));
            }
        }
        return runs;
    }

    close(): void {
        this.last = this.editor.state;
        this.closed = true;
    }

    private async run(away: Omit<Away, 'doc'>): Promise<void> {
        let dropped = false;
        await this.host.finishAway(away.pending, async (_at, ops) => {
            const written = await this.writeSource(away, ops);
            dropped = written.inEditor;
            return written.outcome;
        });
        if (!dropped && !this.closed) this.editor.dispatch({ effects: dropAway.of(away.id) });
    }

    /** The source's write, and whether it was made in the editor, which then let go of the move. */
    private async writeSource(away: Omit<Away, 'doc'>, ops: readonly TaskOp[]): Promise<{ outcome: WriteOutcome; inEditor: boolean }> {
        const state = this.closed ? this.last : this.editor.state;
        const now = state.field(awayField, false)?.find(candidate => candidate.id === away.id);
        if (!now) {
            // The state holds no such move (the plugin let go of the editor
            // and was given it again, reloaded): the position counts in none
            // of its content.
            return {
                outcome: { written: false, refused: { file: away.path, reason: { kind: 'changed' }, subject: away.pending.source.text.trim() } },
                inEditor: false,
            };
        }
        const at: EditorSubtree = {
            line: now.doc.lineAt(Math.min(now.pos, now.doc.length)).number - 1,
            text: away.pending.source.text,
            subtree: away.pending.source.subtree,
            key: keyOf(now.doc),
        };
        if (!shows(this.editor, away.path)) return { outcome: await this.host.writeFile(away.path, at, ops), inEditor: false };

        // A step of its own to undo, whether or not the user typed since the
        // completion: undone, the original comes back as the completion left it.
        const outcome = writeInEditor(this.editor, away.path, at, ops, this.host.applyOps, [dropAway.of(away.id)]);
        if (!outcome.written) this.editor.dispatch({ effects: dropAway.of(away.id) });
        return { outcome, inEditor: true };
    }
}

/**
 * The editor's fire, as one extension: the filter, the moves it leaves
 * waiting, and the plugin that finishes them.
 */
export function flowFireExtension(host: EditorFireHost): Extension {
    const runner = ViewPlugin.fromClass(class {
        private readonly runner: AwayRunner;
        constructor(view: EditorView) {
            this.runner = new AwayRunner(view, host);
        }
        update(update: ViewUpdate): void {
            void this.runner.added(update.transactions, update.state);
        }
        destroy(): void {
            this.runner.close();
        }
    });
    return [awayField, fireFilter(host), runner];
}
