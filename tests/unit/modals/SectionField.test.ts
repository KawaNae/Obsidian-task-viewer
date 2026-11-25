import { describe, it, expect } from 'vitest';
import { emptySectionAsk, sectionChoices, type SectionAsk, type SectionChoice } from '../../../src/modals/section/SectionDialog';
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

function fieldOf(initial: SectionAsk = emptySectionAsk()) {
    const container = new FakeEl();
    let changes = 0;
    const field = new SectionField({ scope: {}, keymap: { pushScope() { }, popScope() { } } } as never, asEl(container), {
        initial,
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

    it('empties the heading field by its ×, naming no heading picked, as deleting the text does', () => {
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

    it('the text changed after a pick: no heading picked while it differs, the heading picked again once it is typed back', () => {
        const f = fieldOf();
        f.field.offer('A.md', sectionChoices(frameHeadings(['# One'])));
        f.pick(f.listed('One')[0]);
        f.headingInput.type('One 2');
        expect(f.field.heading()).toEqual({ text: 'One 2', picked: null });
        f.headingInput.type('One');
        expect(f.field.heading()).toEqual({ text: 'One', picked: { path: 'A.md', line: 0 } });
    });

    it('its × then the same text typed: the heading picked again', () => {
        const f = fieldOf();
        f.field.offer('A.md', sectionChoices(frameHeadings(['# One'])));
        f.pick(f.listed('One')[0]);
        f.headingClear.press();
        f.headingInput.type('One');
        expect(f.field.heading()).toEqual({ text: 'One', picked: { path: 'A.md', line: 0 } });
    });

    it('another choice picked replaces the heading picked, the whole note picking none', () => {
        const f = fieldOf();
        f.field.offer('A.md', sectionChoices(frameHeadings(['# One', '# Two'])));
        f.pick(f.listed('One')[0]);
        f.pick(f.listed('Two')[0]);
        f.headingInput.type('One');
        expect(f.field.heading()).toEqual({ text: 'One', picked: null });
        f.pick(f.listed('Two')[0]);
        f.pick(f.listed()[0]);
        f.headingInput.type('Two');
        expect(f.field.heading()).toEqual({ text: 'Two', picked: null });
    });

    it('opens on the heading it is told, held while the text is the text it opens with', () => {
        const f = fieldOf({ note: { text: 'A', picked: 'A.md' }, heading: { text: 'One', picked: { path: 'A.md', line: 3 } } });
        expect(f.field.heading()).toEqual({ text: 'One', picked: { path: 'A.md', line: 3 } });
        f.headingInput.type('On');
        expect(f.field.heading().picked).toBeNull();
        f.headingInput.type('One');
        expect(f.field.heading().picked).toEqual({ path: 'A.md', line: 3 });
    });

    it('focuses either field with the caret after its text', () => {
        const f = fieldOf();

        expect(f.field.focus('heading')).toEqual({ to: f.headingInput, selection: 'end' });
        expect(f.field.focus('note').selection).toBe('end');
    });
});
