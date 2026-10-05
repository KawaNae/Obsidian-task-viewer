import { describe, it, expect } from 'vitest';
import { BoolInput, ChoiceInput } from '../../../../src/utils/values/ChoiceValues';

describe('BoolInput', () => {
    it('reads true and false as written', () => {
        expect(BoolInput.read('true')).toEqual({ ok: true, value: true });
        expect(BoolInput.read(' false ')).toEqual({ ok: true, value: false });
    });

    it.each(['TRUE', 'yes', '1'])('refuses %j', (text) => {
        expect(BoolInput.read(text)).toEqual({ ok: false, issue: { code: 'shape', kind: 'bool' } });
    });
});

describe('ChoiceInput', () => {
    const view = ChoiceInput.of(['timeline', 'calendar'] as const);

    it('reads a word of the set', () => {
        expect(view.read(' timeline ')).toEqual({ ok: true, value: 'timeline' });
    });

    it('refuses any other, naming the set', () => {
        expect(view.read('Timeline')).toEqual({ ok: false, issue: { code: 'oneOf', allowed: ['timeline', 'calendar'] } });
        expect(view.read('')).toEqual({ ok: false, issue: { code: 'empty' } });
    });
});
