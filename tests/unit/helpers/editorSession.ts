import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import { editorInfoField } from 'obsidian';
import { AwayRunner, flowFireExtension, type EditorHandle, type EditorFireHost } from '../../../src/editor/FlowFireExtension';

/**
 * A note open in an editor, over the plugin's own editor extension
 * (`flowFireExtension`), without a view: transactions are made on an
 * `EditorState` as the view would make them, and the moves a completion
 * leaves waiting are run as the view's plugin runs them (`AwayRunner`).
 *
 * `host` is the index's (`TaskIndex.editorFireHost`), so a fire here plans,
 * writes and refuses as it does in the app.
 */
export function editorSession(host: EditorFireHost, path: string, text: string) {
    let state = EditorState.create({
        doc: text,
        extensions: [editorInfoField.init(() => ({ file: { path } })), flowFireExtension(host)],
    });
    const transactions: Transaction[] = [];
    let runs: Promise<void>[] = [];
    const handle: EditorHandle = {
        get state() { return state; },
        dispatch: (spec: TransactionSpec) => apply(spec),
    };
    const runner = new AwayRunner(handle, host);

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
        /** Wait for every move a completion here left waiting. */
        settled: async (): Promise<void> => {
            while (runs.length > 0) {
                const pending = runs;
                runs = [];
                await Promise.all(pending);
            }
        },
        /** The editor closes: a move that finishes after it is written to the file. */
        close: () => runner.close(),
    };
}

export type EditorSession = ReturnType<typeof editorSession>;
