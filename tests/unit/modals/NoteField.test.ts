import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { NoteField } from '../../../src/modals/noteops/NoteField';
import type { NoteCandidate } from '../../../src/suggest/NoteCandidates';
import { FakeEl, asEl } from '../helpers/fakeDom';

/**
 * The send dialog's note field (`NoteField`): what it holds as the user
 * picks and types. A pick is
 * made as Obsidian's list makes one, by its `selectSuggestion`.
 */

const file = (path: string) => Object.assign(new TFile(), { path, basename: path.split('/').pop()!.replace(/\.md$/, '') });

function fieldOf(initial = { text: '', picked: null as string | null }) {
    const container = new FakeEl();
    let changes = 0;
    const field = new NoteField({ scope: {}, keymap: { pushScope() { }, popScope() { } } } as never, asEl(container), { initial, offersUnresolved: true, onChange: () => { changes++; }, onEnter: () => { } });
    const input = field.input as unknown as FakeEl;
    const clear = container.find('tv-form__clear-button')!;
    const pick = (candidate: NoteCandidate) => (field as unknown as { suggest: { selectSuggestion(c: NoteCandidate, e: Event): void } }).suggest
        .selectSuggestion(candidate, { type: 'click' } as Event);
    return { field, input, clear, pick, changes: () => changes };
}

const base = { score: 0, matches: null, downranked: false };

describe('NoteField', () => {
    it('a note picked: its name in the field, held as picked', () => {
        const f = fieldOf();
        f.pick({ kind: 'file', file: file('b/同名.md'), linkpath: 'b/同名', ...base });
        expect(f.input.value).toBe('同名');
        expect(f.field.ask()).toEqual({ text: '同名', picked: 'b/同名.md' });
        expect(f.changes()).toBe(1);
    });

    it('an alias picked: its note\'s name, the note held as picked', () => {
        const f = fieldOf();
        f.pick({ kind: 'alias', file: file('Books/本.md'), linkpath: 'Books/本', alias: '別名', ...base });
        expect(f.field.ask()).toEqual({ text: '本', picked: 'Books/本.md' });
    });

    it('an unresolved link picked: its text, nothing picked', () => {
        const f = fieldOf({ text: 'x', picked: 'x.md' });
        f.pick({ kind: 'unresolved', linkpath: 'Ideas/Later', ...base });
        expect(f.field.ask()).toEqual({ text: 'Ideas/Later', picked: null });
    });

    it('the text changed after a pick: nothing picked while it differs, the note picked again once it is typed back', () => {
        const f = fieldOf();
        f.pick({ kind: 'file', file: file('b/同名.md'), linkpath: 'b/同名', ...base });
        f.input.type('同名x');
        expect(f.field.ask()).toEqual({ text: '同名x', picked: null });
        f.input.type('同名');
        expect(f.field.ask()).toEqual({ text: '同名', picked: 'b/同名.md' });
    });

    it('another note picked: that note held, the first no more though its text is typed', () => {
        const f = fieldOf();
        f.pick({ kind: 'file', file: file('a/同名.md'), linkpath: 'a/同名', ...base });
        f.pick({ kind: 'file', file: file('Plan.md'), linkpath: 'Plan', ...base });
        expect(f.field.ask()).toEqual({ text: 'Plan', picked: 'Plan.md' });
        f.input.type('同名');
        expect(f.field.ask()).toEqual({ text: '同名', picked: null });
    });

    it('an unresolved link picked after a note: nothing picked, the note no more though its text is typed', () => {
        const f = fieldOf();
        f.pick({ kind: 'file', file: file('b/同名.md'), linkpath: 'b/同名', ...base });
        f.pick({ kind: 'unresolved', linkpath: 'Later', ...base });
        f.input.type('同名');
        expect(f.field.ask()).toEqual({ text: '同名', picked: null });
    });

    it('its × names no note picked and tells of it, as deleting the text does', () => {
        const cleared = fieldOf({ text: 'Plan', picked: 'Projects/Plan.md' });
        const deleted = fieldOf({ text: 'Plan', picked: 'Projects/Plan.md' });
        cleared.clear.press();
        deleted.input.type('');

        expect(cleared.field.ask()).toEqual({ text: '', picked: null });
        expect(cleared.field.ask()).toEqual(deleted.field.ask());
        expect(cleared.changes()).toBe(deleted.changes());
        expect(cleared.clear.style.display).toBe('none');
    });

    it('its × then the same text typed: the note picked again', () => {
        const f = fieldOf({ text: 'Plan', picked: 'Projects/Plan.md' });
        f.clear.press();
        expect(f.field.ask().picked).toBeNull();
        f.input.type('Plan');
        expect(f.field.ask()).toEqual({ text: 'Plan', picked: 'Projects/Plan.md' });
    });

    it('shows its × while it holds a name, a name picked among it', () => {
        const f = fieldOf();
        expect(f.clear.style.display).toBe('none');
        f.pick({ kind: 'file', file: file('b/同名.md'), linkpath: 'b/同名', ...base });
        expect(f.clear.style.display).toBe('');
    });

    it('is focused with the caret after its text', () => {
        const f = fieldOf({ text: 'Plan', picked: null });
        expect(f.field.focus()).toEqual({ to: f.field.input, selection: 'end' });
    });

    it('opens as it is told, the note it opens on held while the text is the text it opens with', () => {
        const f = fieldOf({ text: 'Plan', picked: 'Projects/Plan.md' });
        expect(f.field.ask()).toEqual({ text: 'Plan', picked: 'Projects/Plan.md' });
        f.input.type('Pla');
        expect(f.field.ask().picked).toBeNull();
        f.input.type('Plan');
        expect(f.field.ask().picked).toBe('Projects/Plan.md');
    });
});
