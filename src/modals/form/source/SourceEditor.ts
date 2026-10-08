import { acceptCompletion, closeBrackets, closeBracketsKeymap, closeCompletion, completionStatus } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder, tooltips, type Rect } from '@codemirror/view';
import type { App } from 'obsidian';
import type { SubtreeFrame } from '../../../services/persistence/utils/SubtreeFrame';
import { t } from '../../../i18n';
import { BRACKET_CLOSERS, BRACKET_PAIRS } from '../../../utils/BracketRules';
import { keyboardTop, trackKeyboard } from '../../../utils/KeyboardState';
import { lineMapOf, trackLines } from './LineMap';
import {
    breakParent, indentMoreRestartingLists, listNumbering, moveLineDownKeepingNumbers, moveLineUpKeepingNumbers,
    newlineContinuingList,
} from './ListMarkup';
import { linkTagCompletion, type LinkCompletion } from './SourceCompletion';

/**
 * The source editor: a row's line and the lines under it, as text to edit,
 * in two CodeMirror editors used as one. It knows no hub and no index: it is
 * opened with the lines to show and hands back the draft, with where each of
 * its child lines came from (`LineMap`). Where the text comes from, how its
 * indent maps to the file's, and when a draft is written are the caller's.
 *
 * - The parent editor holds one line: no change that would break it is
 *   taken. Enter sends the text after the caret to a new first child line,
 *   with the parent's list markup, and goes on to it (`breakParent`).
 * - The children's editor holds any number of lines, indented from 0. Tab
 *   indents by the unit it is given, Shift+Tab outdents, and Enter goes on
 *   with a list as Obsidian's editor does, keeping the indent of the line it
 *   breaks as it is spelled (`ListMarkup`). Numbered lists are numbered
 *   again after each change, and Alt+ArrowUp/Down move lines with the
 *   numbers left in place, as there.
 * - ArrowDown on the parent's last row goes to the children's first line;
 *   ArrowUp on the children's first row goes to the parent. A completion
 *   list open takes the keys first.
 * - Both pair brackets as the task name field does (`BracketRules`), and
 *   complete links and tags as its suggest does (`SourceCompletion`), a
 *   link spelt from the note the caller names.
 * - Obsidian's hotkeys are not the editors' to keep out: the surface they
 *   are in keeps them out while the focus is in it (`HotkeyShield`, which an
 *   overlay given the keymap holds). Let in, they would act on the note of
 *   the active tab behind (Mod+Enter opens the link under its cursor, Mod+B
 *   makes its text bold) where the keys are the editors' own.
 * - The editors look indented under the parent's line by the width of
 *   `indentUnit` (`--tv-source-indent`), as a child line stands under its
 *   parent in Obsidian's editor.
 * - Each editor is an input field of its own (`tv-ctrl__input-wrap`), with
 *   the fields' border and focus: the parent is always one line, the
 *   children may be none, and one box would show an empty children's editor
 *   as an empty child line. Empty, the children's editor shows a placeholder.
 * - A completion list stands in the window above the virtual keyboard
 *   (`keyboardTop`), and goes above the caret where there is no room under
 *   it: on Obsidian mobile the keyboard covers the page without shrinking
 *   it, and a list under a caret just above the keyboard would be hidden.
 */

export interface SourceEditorOptions {
    /** The row's line, without its indent. */
    parent: string;
    /** The lines under it, with their indent below the row's children's taken off. Empty for none. */
    children: readonly string[];
    /** What Tab indents a child line by: spaces, or tabs. */
    indentUnit: string;
    /** Where link and tag completions come from, and the note a link is written in; none without it. */
    links?: LinkCompletion;
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

/**
 * The editor as a draft's logic uses it (the hub's source mode, the send
 * dialog), apart from the DOM: `SourceEditor`, or a stand-in in a test.
 */
export interface DraftEditor {
    draft(): SourceDraft;
    isCompleting(): boolean;
    closeCompletion(): boolean;
    focus(): void;
    destroy(): void;
}

/** How wide a tab stands in the editors. */
const TAB_SIZE = 4;

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

/** The window above the virtual keyboard: where a tooltip (a completion list) has room to stand. */
function spaceAboveKeyboard(view: EditorView): Rect {
    const win = view.dom.ownerDocument.defaultView ?? window;
    return { left: 0, top: 0, right: win.innerWidth, bottom: Math.min(win.innerHeight, keyboardTop(win)) };
}

function common(links: LinkCompletion | undefined, hooks: EditorHooks): Extension[] {
    return [
        history(),
        tooltips({ tooltipSpace: spaceAboveKeyboard }),
        bracketPairing,
        links ? linkTagCompletion(links) : [],
        EditorState.tabSize.of(TAB_SIZE),
        EditorView.lineWrapping,
        hooks.onSubmit ? Prec.high(keymap.of([{ key: 'Mod-Enter', run: () => { hooks.onSubmit?.(); return true; } }])) : [],
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        hooks.onChange ? EditorView.updateListener.of((u) => { if (u.docChanged) hooks.onChange?.(); }) : [],
    ];
}

/** The parent editor holds one line: a change that would make it two is not taken. */
export const singleLine: Extension = EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr));

/** Keys an editor hands to the other: false leaves the key to the editor itself. */
type Handoff = (view: EditorView) => boolean;

export function parentState(
    text: string, links: LinkCompletion | undefined,
    hooks: EditorHooks & { onEnter?: Handoff; onDown?: Handoff },
): EditorState {
    return EditorState.create({
        doc: text,
        extensions: [
            singleLine,
            Prec.high(keymap.of([
                { key: 'Enter', run: (view) => hooks.onEnter?.(view) ?? true },
                { key: 'ArrowDown', run: (view) => hooks.onDown?.(view) ?? false },
            ])),
            common(links, hooks),
        ],
    });
}

export function childrenState(
    lines: readonly string[], unit: string, links: LinkCompletion | undefined,
    hooks: EditorHooks & { onUp?: Handoff } = {},
): EditorState {
    return EditorState.create({
        doc: lines.join('\n'),
        extensions: [
            trackLines(lines.length === 0 ? 0 : undefined),
            indentUnit.of(unit),
            listNumbering,
            // Empty, the editor says what goes in it: a row may have no children.
            placeholder(t('modal.sourceChildren')),
            Prec.high(keymap.of([
                { key: 'Tab', run: acceptCompletion },
                { key: 'Tab', run: indentMoreRestartingLists, shift: indentLess },
                { key: 'Enter', run: newlineContinuingList },
                { key: 'ArrowUp', run: (view) => hooks.onUp?.(view) ?? false },
                { key: 'Alt-ArrowUp', run: moveLineUpKeepingNumbers },
                { key: 'Alt-ArrowDown', run: moveLineDownKeepingNumbers },
            ])),
            common(links, hooks),
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

/** The columns one level of `unit` takes, a tab standing as wide as the editors' tab size. */
export function indentColumns(unit: string): number {
    let columns = 0;
    for (const ch of unit) columns += ch === '\t' ? TAB_SIZE : 1;
    return columns;
}

/** What an editor a draft is opened in tells its opener, and asks of it. */
export interface EditorOnHooks {
    /** Mod+Enter in either editor. */
    submit(): void;
    /** Either editor's text changed. */
    edited(): void;
    /** The path of the note a link typed in it is written in, asked at each completion. */
    linkSource(): string;
}

/** Each editor's box: an input field's, as the fields draw it (_controls.css),
 *  with a block's corners, since the text in it runs to many lines. */
const FIELD_BOX = 'tv-ctrl__input-wrap tv-ctrl__input-wrap--glow tv-ctrl__input-wrap--block';

/**
 * An editor in `container` on the text a subtree opened as (`SubtreeFrame`):
 * the one way a draft of a subtree is opened, for the hub's source mode and
 * each row of the send dialog. Mod+Enter in it is `submit`, a change of its
 * text is told to `edited`; a link typed in it is spelt from the note
 * `linkSource` names. Whether a draft would lose anything is not the
 * editor's to say: it is what the frame makes of it (`SubtreeFrame.check`).
 */
export function editorOn(container: HTMLElement, frame: SubtreeFrame, app: App, hooks: EditorOnHooks): SourceEditor {
    return new SourceEditor(container, {
        parent: frame.parent,
        children: frame.children,
        indentUnit: frame.unit,
        links: { app, source: hooks.linkSource },
        onSubmit: hooks.submit,
        onChange: hooks.edited,
    });
}

export class SourceEditor implements DraftEditor {
    readonly dom: HTMLElement;
    private readonly parentView: EditorView;
    private readonly childrenView: EditorView;

    constructor(container: HTMLElement, options: SourceEditorOptions) {
        this.dom = container.createDiv({ cls: 'tv-source-editor' });
        trackKeyboard(container.ownerDocument.defaultView ?? window);
        const hooks: EditorHooks = { onSubmit: options.onSubmit, onChange: options.onChange };
        this.parentView = new EditorView({
            state: parentState(options.parent, options.links, {
                ...hooks,
                onEnter: () => this.breakParent(),
                onDown: (view) => this.downToChildren(view),
            }),
            parent: this.dom.createDiv({ cls: `tv-source-editor__parent ${FIELD_BOX}` }),
        });
        this.childrenView = new EditorView({
            state: childrenState(options.children, options.indentUnit, options.links, {
                ...hooks,
                onUp: (view) => this.upToParent(view),
            }),
            parent: this.dom.createDiv({ cls: `tv-source-editor__children ${FIELD_BOX}` }),
        });
        this.dom.style.setProperty('--tv-source-indent', `${indentColumns(options.indentUnit)}ch`);
    }

    draft(): SourceDraft {
        return draftOf(this.parentView.state, this.childrenView.state);
    }

    /** Whether either editor shows a completion list (an Escape there closes the list). */
    isCompleting(): boolean {
        return completionStatus(this.parentView.state) !== null || completionStatus(this.childrenView.state) !== null;
    }

    /** Close a completion list either editor shows, as an Escape there would. Whether there was one. */
    closeCompletion(): boolean {
        const parent = closeCompletion(this.parentView);
        const children = closeCompletion(this.childrenView);
        return parent || children;
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

    /**
     * Enter in the parent's line: its text after the caret becomes the first
     * child line, and the caret goes there (`breakParent`). Each editor keeps
     * its own history of the change.
     */
    private breakParent(): boolean {
        const parent = this.parentView;
        const children = this.childrenView;
        const { from, to } = parent.state.selection.main;
        const split = breakParent(parent.state.doc.toString(), from, to);
        if (split.cut !== null) {
            parent.dispatch({ changes: { from: split.cut, to: parent.state.doc.length }, userEvent: 'input' });
        }
        // An empty children's editor holds no lines: the line is the only one.
        const rest = children.state.doc.length > 0 ? children.state.lineBreak : '';
        children.focus();
        children.dispatch({
            changes: { from: 0, insert: split.child + rest },
            selection: { anchor: split.caret },
            scrollIntoView: true,
            userEvent: 'input',
        });
        return true;
    }

    /** ArrowDown on the parent's last row: on to the children's first line, as near the caret's offset as it goes. */
    private downToChildren(view: EditorView): boolean {
        const range = view.state.selection.main;
        if (!range.empty || view.moveToLineBoundary(range, true, true).head < view.state.doc.length) return false;
        const children = this.childrenView;
        children.focus();
        children.dispatch({ selection: { anchor: Math.min(range.head, children.state.doc.line(1).length) }, scrollIntoView: true });
        return true;
    }

    /** ArrowUp on the children's first row: back to the parent's line, as near the caret's offset as it goes. */
    private upToParent(view: EditorView): boolean {
        const range = view.state.selection.main;
        if (!range.empty || view.state.doc.lineAt(range.head).number !== 1) return false;
        if (view.moveToLineBoundary(range, false, true).head > 0) return false;
        const parent = this.parentView;
        parent.focus();
        parent.dispatch({ selection: { anchor: Math.min(range.head, parent.state.doc.length) } });
        return true;
    }
}
