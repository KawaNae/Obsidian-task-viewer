import { describe, it, expect } from 'vitest';
import { MarkdownView } from 'obsidian';
import { EditorObserver, HAND_WINDOW_MS } from '../../../../src/services/core/EditorObserver';
import { EditorSignal } from '../../../../src/services/core/EditorSignal';

/**
 * What raises the editor's signal (F6). Typing does, by its `beforeinput`.
 * Anything else that changes a note in an editor — a checkbox clicked in Live
 * Preview, Ctrl+Enter's toggle, a command — does when the editor's change
 * follows a key or a press. A press alone does not: a click that only places
 * the cursor used to leave the signal up for the next sync.
 */
function observe() {
    let now = 1_000_000;
    const workspace = new Map<string, (...args: unknown[]) => void>();
    const inputs = new Map<string, (e: Event) => void>();
    const content = new Map<string, (e: unknown) => void>();
    const view = Object.create(MarkdownView.prototype) as Record<string, unknown>;
    view.editor = {
        cm: {
            contentDOM: {
                addEventListener: (name: string, fn: (e: unknown) => void) => { content.set(name, fn); },
                removeEventListener: () => { },
            },
        },
    };
    view.file = { path: 'note.md' };
    const app = {
        workspace: {
            on: (name: string, fn: (...args: unknown[]) => void) => { workspace.set(name, fn); return {}; },
            offref: () => { },
            activeLeaf: { view },
        },
    };
    const signal = new EditorSignal(() => now);
    const source = {
        addEventListener: (name: string, fn: (e: Event) => void) => { inputs.set(name, fn); },
        removeEventListener: () => { },
    };
    new EditorObserver(app as never, signal, source, () => now).setupInteractionListeners();
    return {
        signal,
        advance: (ms: number) => { now += ms; },
        key: (key = 'Enter', ctrlKey = false) => inputs.get('keydown')!({ isTrusted: true, type: 'keydown', key, ctrlKey } as unknown as Event),
        press: (trusted = true) => inputs.get('pointerdown')!({ isTrusted: trusted } as Event),
        /** The note's editor changed; `focused` says whether it had the focus. */
        change: (focused = true) => workspace.get('editor-change')!({ hasFocus: () => focused }, { file: { path: 'note.md' } }),
        /** A key or a press inside the editor's own element (a popped-out window's). */
        keyInEditor: () => content.get('keydown')!({ isTrusted: true, type: 'keydown', key: 'Enter', ctrlKey: true } as unknown as Event),
        type: () => content.get('beforeinput')!({ data: 'x', inputType: 'insertText' }),
    };
}

describe('EditorObserver: what raises the signal', () => {
    it('a press that changes nothing raises nothing', () => {
        const editor = observe();
        editor.press();
        expect(editor.signal.take('note.md')).toBe(false);
    });

    it('a checkbox click, or a key that runs a command, raises it: a press or a key, then the editor\'s change', () => {
        const editor = observe();
        editor.press();
        editor.advance(30);
        editor.change();
        expect(editor.signal.take('note.md')).toBe(true);
        editor.key();
        editor.advance(5);
        editor.change();
        expect(editor.signal.take('note.md')).toBe(true);
    });

    it('a change long after the last key or press is not the hand\'s', () => {
        const editor = observe();
        editor.press();
        editor.advance(HAND_WINDOW_MS + 1);
        editor.change();
        expect(editor.signal.take('note.md')).toBe(false);
    });

    it('a change with no key or press at all, or after an untrusted one, is not the hand\'s', () => {
        const editor = observe();
        editor.change();
        expect(editor.signal.take('note.md')).toBe(false);
        editor.press(false);
        editor.change();
        expect(editor.signal.take('note.md')).toBe(false);
    });

    it("a change to an editor without the focus is not the hand's: a sync reloading the note after a key typed elsewhere, or after a press on a card", () => {
        // F6's counterexample run (P1, P2): Obsidian reports a change when it
        // reloads an open note something else wrote.
        const editor = observe();
        editor.key();
        editor.advance(200);
        editor.change(false);
        expect(editor.signal.take('note.md')).toBe(false);
        editor.press();
        editor.change(false);
        expect(editor.signal.take('note.md')).toBe(false);
    });

    it("a key in a popped-out window's editor counts, heard on the editor itself", () => {
        const editor = observe();
        editor.keyInEditor();
        editor.change();
        expect(editor.signal.take('note.md')).toBe(true);
    });

    it('a key that only moves, or undoes, does not count: an arrow before a sync’s reload, a Ctrl+Z that brings back a completion', () => {
        // F6's counterexample run (K1, U1). Undoing a flow's write in the editor
        // restores the completed row with its command; taken for the hand's, it
        // fired again and the flow wrote its instance a second time.
        const editor = observe();
        editor.key('ArrowDown');
        editor.change();
        expect(editor.signal.take('note.md')).toBe(false);
        editor.key('z', true);
        editor.change();
        expect(editor.signal.take('note.md')).toBe(false);
        editor.key('Enter', true);
        editor.change();
        expect(editor.signal.take('note.md')).toBe(true);
    });

    it('typing raises it', () => {
        const editor = observe();
        editor.type();
        expect(editor.signal.take('note.md')).toBe(true);
    });
});
