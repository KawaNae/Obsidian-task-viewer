import { describe, it, expect } from 'vitest';
import { issueWords } from '../../../src/modals/form/issueWords';
import { IntInput } from '../../../src/utils/values/NumberValues';
import type { Issue } from '../../../src/utils/values/Read';

/** Every issue a reading can give is said in words, never as the bare i18n key. */
describe('issueWords', () => {
    const issues: Issue[] = [
        { code: 'empty' },
        ...(['date', 'time', 'dateTime', 'dateTimeOrTime', 'int', 'number', 'bool', 'color', 'statusChar', 'text'] as const).map(kind => ({ code: 'shape', kind }) as const),
        { code: 'noSuchDay' },
        { code: 'range', min: 1, max: 120 },
        { code: 'range', min: 1 },
        { code: 'range', max: 60 },
        { code: 'oneOf', allowed: ['solid', 'dashed'] },
        { code: 'dateRequired' },
        ...(['dateBlock', 'command', 'blockId', 'headingMark', 'listItem'] as const).map(kind => ({ code: 'notation', kind }) as const),
        { code: 'chars', chars: ': [' },
        { code: 'digitsOnly' },
        { code: 'reserved' },
        ...(['color', 'linestyle', 'mask', 'tags', 'start', 'end', 'due'] as const).map(builtin => ({ code: 'reserved', field: { key: 'K', builtin } }) as const),
        { code: 'listMark' },
        { code: 'hasRow', key: 'area' },
        { code: 'duplicate' },
    ];

    for (const issue of issues) {
        it(`says ${JSON.stringify(issue)}`, () => {
            const words = issueWords(issue);
            expect(words).not.toMatch(/^issue\./);
            expect(words).not.toMatch(/\{\{/);
        });
    }

    it('says the bounds of a number out of range, and a text that is no number', () => {
        const range = IntInput.read('0', { min: 1, max: 120 });
        const shape = IntInput.read('abc', { min: 1, max: 120 });
        if (range.ok || shape.ok) throw new Error('read');
        expect(issueWords(range.issue)).toBe('Enter a number from 1 to 120.');
        expect(issueWords(shape.issue)).toBe('Enter a whole number.');
    });

    it('says which field edits a reserved key that a field of its own edits, and the row a key has', () => {
        expect(issueWords({ code: 'reserved', field: { key: 'TV-COLOR', builtin: 'color' } })).toBe('Enter TV-COLOR in the Color field.');
        expect(issueWords({ code: 'reserved', field: { key: 'tv-due', builtin: 'due' } })).toBe('Enter tv-due in the Due field.');
        expect(issueWords({ code: 'reserved' })).toBe('This key is reserved.');
        expect(issueWords({ code: 'hasRow', key: 'Area' })).toBe('The key Area already exists, so it cannot be added.');
    });
});
