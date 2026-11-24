import { describe, it, expect } from 'vitest';
import { emptySectionAsk, sectionChoices, type SectionChoice } from '../../../src/modals/section/SectionDialog';
import { SectionField } from '../../../src/modals/section/SectionField';
import { frameHeadings } from '../../../src/services/data/MarkdownFrames';
import { FakeEl, asEl } from '../helpers/fakeDom';

/**
 * The section dialog's heading field (`SectionField`): what it holds as a
 * heading is picked from its list. The list is asked for its candidates and
 * a pick is made as Obsidian's list asks and makes them, by its
 * `getSuggestions` and `selectSuggestion`.
 */

interface Candidate { choice: SectionChoice; path: string }

function fieldOf() {
    const container = new FakeEl();
    let changes = 0;
    const field = new SectionField({ scope: {}, keymap: { pushScope() { }, popScope() { } } } as never, asEl(container), {
        initial: emptySectionAsk(),
        noteChanged: () => { },
        headingChanged: () => { changes++; },
        onEnter: () => { },
    });
    const suggest = (field as unknown as { suggest: {
        getSuggestions(query: string): Candidate[];
        selectSuggestion(candidate: Candidate, e: Event): void;
    } }).suggest;
    const [, headingClear] = container.findAll('tv-form__clear-button');
    const headingInput = field.focus('heading').to as unknown as FakeEl;
    return {
        field,
        headingClear,
        headingInput,
        listed: (query = '') => suggest.getSuggestions(query),
        pick: (candidate: Candidate) => suggest.selectSuggestion(candidate, { type: 'click' } as Event),
        changes: () => changes,
    };
}

describe('SectionField', () => {
    it('lists nothing while the form offers no note, and each candidate with the path of the note it was offered for', () => {
        const f = fieldOf();
        expect(f.listed()).toEqual([]);
        f.field.offer('A.md', sectionChoices(frameHeadings(['# One'])));
        expect(f.listed().map(c => c.path)).toEqual(['A.md', 'A.md']);
    });

    it('picks the heading of the note a candidate was offered for, though another note was offered since', () => {
        const f = fieldOf();
        f.field.offer('A.md', sectionChoices(frameHeadings(['# One', '# Two'])));
        const listed = f.listed('Two');
        // The note field named another note before the list was picked from.
        f.field.offer('B.md', sectionChoices(frameHeadings(['intro', '# Two'])));
        f.pick(listed[0]);
        expect(f.field.heading()).toEqual({ text: 'Two', picked: { path: 'A.md', line: 1 } });
        expect(f.changes()).toBe(1);
    });

    it('empties the field for the whole note, and picks nothing for a heading no link names', () => {
        const f = fieldOf();
        f.field.offer('A.md', sectionChoices(frameHeadings(['# X', '# X'])));
        const [whole, , unnamed] = f.listed();
        f.pick(unnamed);
        expect([f.field.heading(), f.changes()]).toEqual([{ text: '', picked: null }, 0]);
        f.pick(f.listed('X')[0]);
        f.pick(whole);
        expect(f.field.heading()).toEqual({ text: '', picked: null });
        expect(f.changes()).toBe(2);
    });

    it('empties the heading field by its ×, the heading picked let go, as deleting the text does', () => {
        const cleared = fieldOf();
        const deleted = fieldOf();
        for (const f of [cleared, deleted]) {
            f.field.offer('A.md', sectionChoices(frameHeadings(['# One'])));
            f.pick(f.listed('One')[0]);
        }
        expect(cleared.headingClear.style.display).toBe('');
        cleared.headingClear.press();
        deleted.headingInput.type('');

        expect(cleared.field.heading()).toEqual({ text: '', picked: null });
        expect(cleared.field.heading()).toEqual(deleted.field.heading());
        expect(cleared.changes()).toBe(deleted.changes());
        expect(cleared.headingClear.style.display).toBe('none');
    });

    it('focuses either field with the caret after its text', () => {
        const f = fieldOf();

        expect(f.field.focus('heading')).toEqual({ to: f.headingInput, selection: 'end' });
        expect(f.field.focus('note').selection).toBe('end');
    });
});
