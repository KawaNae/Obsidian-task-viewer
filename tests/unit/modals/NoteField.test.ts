import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { NoteField } from '../../../src/modals/noteops/NoteField';
import type { NoteCandidate } from '../../../src/suggest/NoteCandidates';
import { FakeEl, asEl } from '../helpers/fakeDom';

/**
 * The send dialog's note field (`NoteField`): what it holds as the user
 * picks and types (`note-suggest/send-field.md`, 欄の値と行き先). A pick is
 * made as Obsidian's list makes one, by its `selectSuggestion`.
 */

const file = (path: string) => Object.assign(new TFile(), { path, basename: path.split('/').pop()!.replace(/\.md$/, '') });

function fieldOf(initial = { text: '', picked: null as string | null }) {
    const container = new FakeEl();
    let changes = 0;
    const field = new NoteField({ scope: {}, keymap: { pushScope() { }, popScope() { } } } as never, asEl(container), { initial, onChange: () => { changes++; }, onEnter: () => { } });
    const input = field.input as unknown as FakeEl;
    const pick = (candidate: NoteCandidate) => (field as unknown as { suggest: { selectSuggestion(c: NoteCandidate, e: Event): void } }).suggest
        .selectSuggestion(candidate, { type: 'click' } as Event);
    return { field, input, pick, changes: () => changes };
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

    it('the text changed after a pick: what was picked let go, and kept no more though typed back', () => {
        const f = fieldOf();
        f.pick({ kind: 'file', file: file('b/同名.md'), linkpath: 'b/同名', ...base });
        f.input.type('同名');
        expect(f.field.ask().picked).toBe('b/同名.md');
        f.input.type('同名x');
        expect(f.field.ask()).toEqual({ text: '同名x', picked: null });
        f.input.type('同名');
        expect(f.field.ask()).toEqual({ text: '同名', picked: null });
    });

    it('opens as it is told, a note picked held until the text changes', () => {
        const f = fieldOf({ text: 'Plan', picked: 'Projects/Plan.md' });
        expect(f.field.ask()).toEqual({ text: 'Plan', picked: 'Projects/Plan.md' });
        f.input.type('Pla');
        expect(f.field.ask().picked).toBeNull();
    });
});
