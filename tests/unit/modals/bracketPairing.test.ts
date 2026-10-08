import { describe, it, expect } from 'vitest';
import { attachBracketPairing } from '../../../src/modals/form/bracketPairing';
import { TaskNameSuggest } from '../../../src/suggest/TaskNameSuggest';
import { linkApp } from '../helpers/linkApp';

/**
 * The task name field pairs brackets and completes links as Obsidian's editor
 * does. Vitest runs in `node`, so the input is a shim that plays the event
 * order a browser plays: 'beforeinput' before the edit, 'input' after it, and
 * for IME 'compositionstart' .. 'input'(isComposing) .. 'compositionend'.
 */
class FakeInput {
    value = '';
    selectionStart = 0;
    selectionEnd = 0;
    private listeners = new Map<string, Array<(e: any) => void>>();

    addEventListener(type: string, fn: (e: any) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }
    setSelectionRange(start: number, end: number) {
        this.selectionStart = start;
        this.selectionEnd = end;
    }
    dispatchEvent(e: any): boolean {
        for (const fn of this.listeners.get(e.type) ?? []) fn(e);
        return true;
    }
    private fire(type: string, extra: Record<string, unknown> = {}) {
        this.dispatchEvent({ type, ...extra });
    }

    /** Text before the caret + '|' + text after it. */
    get shown(): string {
        return this.value.slice(0, this.selectionStart) + '|' + this.value.slice(this.selectionStart);
    }

    /** Places the caret at '|' in `text`. */
    set(text: string) {
        const at = text.indexOf('|');
        this.value = text.replace('|', '');
        this.setSelectionRange(at, at);
    }

    type(text: string) {
        for (const ch of text) {
            this.fire('beforeinput', { inputType: 'insertText', data: ch });
            this.insert(ch);
            this.fire('input', { inputType: 'insertText', isComposing: false });
        }
    }

    backspace() {
        this.fire('beforeinput', { inputType: 'deleteContentBackward' });
        const p = this.selectionStart;
        if (p === 0) return;
        this.value = this.value.slice(0, p - 1) + this.value.slice(p);
        this.setSelectionRange(p - 1, p - 1);
        this.fire('input', { inputType: 'deleteContentBackward', isComposing: false });
    }

    /** An IME composition that commits `text` (the preedit is not modeled). */
    compose(text: string) {
        this.fire('compositionstart');
        this.fire('beforeinput', { inputType: 'insertCompositionText', data: text });
        this.insert(text);
        this.fire('input', { inputType: 'insertCompositionText', isComposing: true });
        this.fire('compositionend');
    }

    private insert(text: string) {
        const p = this.selectionStart;
        this.value = this.value.slice(0, p) + text + this.value.slice(p);
        this.setSelectionRange(p + text.length, p + text.length);
    }
}

function field(initial = '|') {
    const input = new FakeInput();
    input.set(initial);
    attachBracketPairing(input as unknown as HTMLInputElement, () => {});
    return input;
}

/**
 * A TaskNameSuggest over the fake input, without the popup DOM, in a vault
 * (`linkApp`) of the note its links are written in (`src.md`) and a newer
 * note with one heading, listed first, and one tag.
 */
function suggestOn(input: FakeInput) {
    const app = linkApp({
        files: ['src.md', 'notes/ノート.md'],
        headings: { 'notes/ノート.md': [{ heading: '見出し', level: 2 }] },
        tags: ['tag'],
    });
    const s = Object.create(TaskNameSuggest.prototype) as any;
    Object.assign(s, {
        app,
        inputEl: input,
        linkSource: () => 'src.md',
        currentMode: null,
        setValue(v: string) { input.value = v; },
        close() {},
    });
    const pickFirst = () => {
        const items = s.getSuggestions(input.value);
        expect(items.length).toBeGreaterThan(0);
        s.selectSuggestion(items[0], {} as KeyboardEvent);
    };
    return { pickFirst };
}

describe('bracket pairing: whether to add the closer', () => {
    it('does not close a bracket typed before a word', () => {
        const f = field('|test #testTask');
        f.type('[[');
        expect(f.shown).toBe('[[|test #testTask');
    });

    it('closes a bracket typed in an empty field', () => {
        const f = field('|');
        f.type('[[');
        expect(f.shown).toBe('[[|]]');
    });

    it('closes a bracket typed before whitespace', () => {
        const f = field('a| b');
        f.type('[[');
        expect(f.shown).toBe('a[[|]] b');
    });

    it('closes a bracket typed before a closer (nesting in an empty pair)', () => {
        const f = field('(|)');
        f.type('[');
        expect(f.shown).toBe('([|])');
    });

    it('closes full-width brackets by the same rule', () => {
        const f = field('|');
        f.type('「');
        expect(f.shown).toBe('「|」');
        const g = field('|テスト');
        g.type('「');
        expect(g.shown).toBe('「|テスト');
    });
});

describe('bracket pairing: kept behaviors', () => {
    it('steps over a closer that is already there', () => {
        const f = field('|');
        f.type('[[a]]');
        expect(f.shown).toBe('[[a]]|');
    });

    it('removes both halves of an empty pair on Backspace', () => {
        const f = field('|');
        f.type('[[');
        f.backspace();
        expect(f.shown).toBe('[|]');
        f.backspace();
        expect(f.shown).toBe('|');
    });

    it('pairs a bracket committed by IME', () => {
        const f = field('|');
        f.compose('「');
        expect(f.shown).toBe('「|」');
        const g = field('|テスト');
        g.compose('「');
        expect(g.shown).toBe('「|テスト');
    });

    it('leaves a multi-character IME commit as it is', () => {
        const f = field('|');
        f.compose('「あ');
        expect(f.shown).toBe('「あ|');
    });
});

describe('link and tag completion: the closers already after the caret', () => {
    it('links a note typed before a word', () => {
        const f = field('|test #testTask');
        const { pickFirst } = suggestOn(f);
        f.type('[[');
        pickFirst();
        expect(f.shown).toBe('[[ノート]]|test #testTask');
    });

    it('links a note in an empty field, consuming the paired closer', () => {
        const f = field('|');
        const { pickFirst } = suggestOn(f);
        f.type('[[');
        pickFirst();
        expect(f.shown).toBe('[[ノート]]|');
    });

    it('links a heading without leaving an extra closer', () => {
        const f = field('|');
        const { pickFirst } = suggestOn(f);
        f.type('[[ノート#');
        expect(f.shown).toBe('[[ノート#|]]');
        pickFirst();
        expect(f.shown).toBe('[[ノート#見出し]]|');
    });

    it('links a heading typed before a word', () => {
        const f = field('|test');
        const { pickFirst } = suggestOn(f);
        f.type('[[ノート#');
        pickFirst();
        expect(f.shown).toBe('[[ノート#見出し]]|test');
    });

    it('consumes a single closer left after the caret', () => {
        const f = field('[[ノ|]');
        const { pickFirst } = suggestOn(f);
        pickFirst();
        expect(f.shown).toBe('[[ノート]]|');
    });

    it('does not consume closers of a tag completion', () => {
        const f = field('( #ta|)');
        const { pickFirst } = suggestOn(f);
        pickFirst();
        expect(f.shown).toBe('( #tag|)');
    });
});
