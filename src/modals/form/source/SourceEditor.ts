import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionStatus } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { EditorSelection, EditorState, Prec, type Extension, type StateCommand } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { App } from 'obsidian';
import { BRACKET_CLOSERS, BRACKET_PAIRS } from '../../../utils/BracketRules';
import { lineMapOf, trackLines } from './LineMap';
import { linkTagCompletionSource } from './SourceCompletion';

/**
 * The source editor: a row's line and the lines under it, as text to edit,
 * in two CodeMirror editors used as one. It knows no hub and no index: it is
 * opened with the lines to show and hands back the draft, with where each of
 * its child lines came from (`LineMap`). Where the text comes from, how its
 * indent maps to the file's, and when a draft is written are the caller's.
 *
 * - The parent editor holds one line: no change that would break it is
 *   taken, and Enter goes on to the children's editor.
 * - The children's editor holds any number of lines, indented from 0. Tab
 *   indents by the unit it is given, Shift+Tab outdents, and Enter keeps the
 *   indent of the line it breaks, as it is spelled.
 * - Both pair brackets as the task name field does (`BracketRules`), and
 *   complete links and tags as its suggest does (`LinkTagCandidates`).
 */

export interface SourceEditorOptions {
    /** The row's line, without its indent. */
    parent: string;
    /** The lines under it, with their indent below the row's children's taken off. Empty for none. */
    children: readonly string[];
    /** What Tab indents a child line by: spaces, or tabs. */
    indentUnit: string;
    /** Where link and tag completions come from; none without it. */
    app?: App;
    /** Mod+Enter in either editor: the caller's apply. */
    onSubmit?: () => void;
    /** Either editor's text changed. */
    onChange?: () => void;
}

/** A child line of the draft, and the line it was opened as. */
export interface SourceDraftLine {
    text: string;
    /** The line (1-based) of the children opened that this line continues; null for a new line. */
    was: number | null;
}

export interface SourceDraft {
    parent: string;
    children: SourceDraftLine[];
}

interface EditorHooks {
    onSubmit?: () => void;
    onChange?: () => void;
}

/**
 * The brackets the editors pair: `BracketRules`' pairs, closed only at the
 * end, before whitespace, or before a closer (`shouldAutoClose`), as
 * `closeBrackets` reads them from the language data. CodeMirror derives each
 * closer from its opener; that it derives `BRACKET_PAIRS`' is under test.
 */
export const bracketPairing: Extension = [
    closeBrackets(),
    EditorState.languageData.of(() => [{
        closeBrackets: { brackets: Object.keys(BRACKET_PAIRS), before: [...BRACKET_CLOSERS].join('') },
    }]),
];

function common(app: App | undefined, hooks: EditorHooks): Extension[] {
    return [
        history(),
        bracketPairing,
        app ? autocompletion({ override: [linkTagCompletionSource(app)], icons: false }) : [],
        EditorState.tabSize.of(4),
        EditorView.lineWrapping,
        hooks.onSubmit ? Prec.high(keymap.of([{ key: 'Mod-Enter', run: () => { hooks.onSubmit?.(); return true; } }])) : [],
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        hooks.onChange ? EditorView.updateListener.of((u) => { if (u.docChanged) hooks.onChange?.(); }) : [],
    ];
}

/** The parent editor holds one line: a change that would make it two is not taken. */
export const singleLine: Extension = EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr));

/**
 * A line break that keeps the indent of the line it breaks, spelled as that
 * line spells it (a break inside the indent keeps the part before it).
 */
export const newlineKeepingIndent: StateCommand = ({ state, dispatch }) => {
    if (state.readOnly) return false;
    dispatch(state.update(state.changeByRange((range) => {
        const line = state.doc.lineAt(range.from);
        const indent = /^[ \t]*/.exec(line.text)![0].slice(0, range.from - line.from);
        const insert = state.lineBreak + indent;
        return {
            changes: { from: range.from, to: range.to, insert },
            range: EditorSelection.cursor(range.from + insert.length),
        };
    }), { scrollIntoView: true, userEvent: 'input' }));
    return true;
};

export function parentState(text: string, app: App | undefined, hooks: EditorHooks & { onEnter?: () => void }): EditorState {
    return EditorState.create({
        doc: text,
        extensions: [
            singleLine,
            Prec.high(keymap.of([{ key: 'Enter', run: () => { hooks.onEnter?.(); return true; } }])),
            common(app, hooks),
        ],
    });
}

export function childrenState(lines: readonly string[], unit: string, app: App | undefined, hooks: EditorHooks): EditorState {
    return EditorState.create({
        doc: lines.join('\n'),
        extensions: [
            trackLines(lines.length === 0 ? 0 : undefined),
            indentUnit.of(unit),
            Prec.high(keymap.of([
                { key: 'Tab', run: acceptCompletion },
                { key: 'Tab', run: indentMore, shift: indentLess },
                { key: 'Enter', run: newlineKeepingIndent },
            ])),
            common(app, hooks),
        ],
    });
}

/**
 * The draft the two editors hold: the parent's line, and each child line
 * with the line it continues (`LineMap`). An empty children's editor holds
 * no lines.
 */
export function draftOf(parent: EditorState, children: EditorState): SourceDraft {
    const map = lineMapOf(children);
    const lines: SourceDraftLine[] = [];
    if (children.doc.length > 0) {
        for (let n = 1; n <= children.doc.lines; n++) {
            lines.push({ text: children.doc.line(n).text, was: map.was(n) });
        }
    }
    return { parent: parent.doc.toString(), children: lines };
}

export class SourceEditor {
    readonly dom: HTMLElement;
    private readonly parentView: EditorView;
    private readonly childrenView: EditorView;

    constructor(container: HTMLElement, private readonly options: SourceEditorOptions) {
        this.dom = container.createDiv({ cls: 'tv-source-editor' });
        const hooks: EditorHooks = { onSubmit: options.onSubmit, onChange: options.onChange };
        this.parentView = new EditorView({
            state: parentState(options.parent, options.app, { ...hooks, onEnter: () => this.focusChildren() }),
            parent: this.dom.createDiv({ cls: 'tv-source-editor__parent' }),
        });
        this.childrenView = new EditorView({
            state: childrenState(options.children, options.indentUnit, options.app, hooks),
            parent: this.dom.createDiv({ cls: 'tv-source-editor__children' }),
        });
    }

    draft(): SourceDraft {
        return draftOf(this.parentView.state, this.childrenView.state);
    }

    /** Whether the text differs from what it was opened with. */
    isDirty(): boolean {
        return this.parentView.state.doc.toString() !== this.options.parent
            || this.childrenView.state.doc.toString() !== this.options.children.join('\n');
    }

    /** Whether either editor shows a completion list (an Escape there closes the list). */
    isCompleting(): boolean {
        return completionStatus(this.parentView.state) !== null || completionStatus(this.childrenView.state) !== null;
    }

    /** Whether `node` is in either editor, or in a list one of them shows. */
    contains(node: Node | null): boolean {
        return node !== null && this.dom.contains(node);
    }

    /** Focus the parent's line, at its end. */
    focus(): void {
        this.parentView.focus();
        this.parentView.dispatch({ selection: { anchor: this.parentView.state.doc.length } });
    }

    destroy(): void {
        this.parentView.destroy();
        this.childrenView.destroy();
        this.dom.remove();
    }

    private focusChildren(): void {
        this.childrenView.focus();
        this.childrenView.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
    }
}
