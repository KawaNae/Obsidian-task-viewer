import { describe, it, expect } from 'vitest';
import { issueText } from '../../../../src/utils/values/IssueText';

describe('issueText', () => {
    it.each([
        [{ code: 'empty' }, 'start must not be empty'],
        [{ code: 'shape', kind: 'int' }, 'start must be a whole number'],
        [{ code: 'shape', kind: 'dateTime' }, 'start must be a date (YYYY-MM-DD) or a date and a time (YYYY-MM-DD HH:mm)'],
        [{ code: 'shape', kind: 'dateTimeOrTime' }, 'start must be a date (YYYY-MM-DD), a date and a time (YYYY-MM-DD HH:mm), or a time (HH:mm)'],
        [{ code: 'noSuchDay' }, 'start must be a day that exists'],
        [{ code: 'range', min: 1 }, 'start must be at least 1'],
        [{ code: 'range', max: 9 }, 'start must be at most 9'],
        [{ code: 'range', min: 1, max: 9 }, 'start must be from 1 to 9'],
        [{ code: 'oneOf', allowed: ['a', 'b'] }, 'start must be one of: a, b'],
        [{ code: 'dateRequired' }, 'start must include a date'],
        [{ code: 'shape', kind: 'color' }, 'start must be a hex color (ff0000) or a color name (red)'],
        [{ code: 'notation', kind: 'dateBlock' }, 'start must not hold a date block (@…); dates go in their own fields'],
        [{ code: 'notation', kind: 'command' }, 'start must not hold a command (==>)'],
        [{ code: 'notation', kind: 'blockId' }, 'start must not hold a block ID (^id) at its end'],
        [{ code: 'chars', chars: ': [' }, 'start must not hold: : ['],
        [{ code: 'reserved' }, 'start is reserved'],
    ] as const)('tells %j', (issue, text) => {
        expect(issueText(issue, 'start')).toBe(text);
    });

    it('quotes what was given', () => {
        expect(issueText({ code: 'noSuchDay' }, 'due', '2026-02-30')).toBe('due must be a day that exists, got: "2026-02-30"');
    });
});
