import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import { history, redo, undo } from '@codemirror/commands';
import { editorInfoField } from 'obsidian';
import { AwayRunner, flowFireExtension, type EditorHandle, type EditorFireHost } from '../../../src/editor/FlowFireExtension';

/**
 * A note open in an editor, over the plugin's own editor extension
 * (`flowFireExtension`), without a view: transactions are made on an
 * `EditorState` as the view would make them, and the moves a completion
 * leaves waiting are run as the view's plugin runs them (`AwayRunner`).
 *
 * `host` is the index's (`TaskIndex.editorFireHost`), so a fire here plans,
 * writes and refuses as it does in the app. The editor keeps a history, as
 * Obsidian's does (CM6's `history`), for `undo` and `redo`.
 */
export function editorSession(host: EditorFireHost, path: string, text: string) {
    const stateOf = (note: string, doc: string) => EditorState.create({
        doc,
        extensions: [editorInfoField.init(() => ({ file: { path: note } })), history(), flowFireExtension(host)],
    });
    let state = stateOf(path, text);
    let connected = true;
    const transactions: Transaction[] = [];
    let runs: Promise<void>[] = [];
    const handle: EditorHandle = {
        get state() { return state; },
        dom: { get isConnected() { return connected; } },
        dispatch: (spec: TransactionSpec) => apply(spec),
    };
    let runner = new AwayRunner(handle, host);

    function apply(spec: TransactionSpec): Transaction {
        return made(state.update(spec));
    }

    function made(tr: Transaction): Transaction {
        state = tr.state;
        transactions.push(tr);
        runs = [...runs, ...runner.added([tr], state)];
        return tr;
    }

    /** Where column `column` of line `line` (0-based) stands. */
    const at = (line: number, column = 0) => state.doc.line(line + 1).from + column;

    return {
        get state() { return state; },
        /** The editor as a write to it takes it (`EditorHandle`): what the menu writes through. */
        handle,
        /** Every transaction made, the plugin's included. */
        transactions,
        /** The document's text. */
        text: () => state.doc.toString(),
        lines: () => state.doc.toString().split('\n'),
        at,
        /**
         * Make one transaction of `changes`, marked `userEvent` (none: a
         * click, which Obsidian's editor makes unmarked).
         */
        change: (changes: TransactionSpec['changes'], userEvent?: string): Transaction =>
            apply({ changes, ...(userEvent ? { annotations: Transaction.userEvent.of(userEvent) } : {}) }),
        /** Check the box of line `line` as a click does: `x` over its status. */
        check: (line: number, userEvent?: string): Transaction => {
            const from = state.doc.line(line + 1).text.indexOf('[') + 1;
            return apply({
                changes: { from: at(line, from), to: at(line, from + 1), insert: 'x' },
                selection: EditorSelection.cursor(at(line, from + 1)),
                ...(userEvent ? { annotations: Transaction.userEvent.of(userEvent) } : {}),
            });
        },
        /** Ctrl+Z, as the history makes it (`undo`, marked `undo`). Whether there was a step to undo. */
        undo: (): boolean => undo({ state, dispatch: made }),
        /** Ctrl+Y (`redo`, marked `redo`). */
        redo: (): boolean => redo({ state, dispatch: made }),
        /** Wait for every move a completion here left waiting. */
        settled: async (): Promise<void> => {
            while (runs.length > 0) {
                const pending = runs;
                runs = [];
                await Promise.all(pending);
            }
        },
        /**
         * The editor closes, as Obsidian closes it: the plugin let go of its
         * state, then its element leaves the document. A move that finishes
         * after it is written to the file.
         */
        close: () => {
            runner.close();
            connected = false;
        },
        /**
         * The editor is given the note `note`, as Obsidian gives a tab
         * another note: a state of its own (`setState`), the plugin let go of
         * the one before and started again on the new one.
         */
        show: (note: string, doc: string) => {
            runner.close();
            state = stateOf(note, doc);
            runner = new AwayRunner(handle, host);
        },
    };
}

export type EditorSession = ReturnType<typeof editorSession>;
