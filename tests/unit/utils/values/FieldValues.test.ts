import { describe, it, expect } from 'vitest';
import { ChoiceInput } from '../../../../src/utils/values/ChoiceValues';
import { ColorInput } from '../../../../src/utils/values/ColorValues';
import { DateInput, TimeInput } from '../../../../src/utils/values/DateValues';
import { IntInput } from '../../../../src/utils/values/NumberValues';
import { optional, type FieldCodec } from '../../../../src/utils/values/Read';
import { FreeText, TextInput } from '../../../../src/utils/values/TextValues';

/** What a field's text reads as, and the text a value read is shown back as. */
function shown<T>(codec: FieldCodec<T>, text: string): string | { issue: unknown } {
    const read = codec.read(text);
    return read.ok ? codec.show(read.value) : { issue: read.issue };
}

describe('the field codecs', () => {
    it('show a date and a time typed in full width or with one digit in the form the notation writes', () => {
        expect(shown(DateInput, '２０２６ー１０ー０５')).toBe('2026-10-05');
        expect(shown(TimeInput, '9:40')).toBe('09:40');
        expect(shown(TimeInput, '９：４０')).toBe('09:40');
        expect(shown(DateInput, '2026-02-30')).toEqual({ issue: { code: 'noSuchDay' } });
    });

    it('read an empty field as no value when optional, and show no value as empty', () => {
        const date = optional(DateInput);
        expect(date.read('  ')).toEqual({ ok: true, value: undefined });
        expect(date.show(undefined)).toBe('');
        expect(shown(date, '2026-10-05')).toBe('2026-10-05');
        expect(DateInput.read('')).toEqual({ ok: false, issue: { code: 'empty' } });
    });

    it('read a whole number in range, shown as its digits', () => {
        const minutes = IntInput.codec({ min: 1 });
        expect(shown(minutes, '３０')).toBe('30');
        expect(shown(minutes, '0')).toEqual({ issue: { code: 'range', min: 1 } });
        expect(shown(minutes, 'abc')).toEqual({ issue: { code: 'shape', kind: 'int' } });
    });

    it('match a choice in any case when caseless, given back as the set spells it', () => {
        const styles = ChoiceInput.of(['solid', 'dashed'], { caseless: true });
        expect(shown(styles, 'Dashed')).toBe('dashed');
        expect(shown(styles, 'zigzag')).toEqual({ issue: { code: 'oneOf', allowed: ['solid', 'dashed'] } });
        expect(shown(ChoiceInput.of(['solid']), 'Solid')).toEqual({ issue: { code: 'oneOf', allowed: ['solid'] } });
    });

    it('read a color as hex of 3 or 6 digits without its #, or a CSS name in lower case', () => {
        expect(shown(ColorInput, '#FF8800')).toBe('FF8800');
        expect(shown(ColorInput, 'f80')).toBe('f80');
        expect(shown(ColorInput, 'Red')).toBe('red');
        expect(shown(ColorInput, '＃ｆｆ８８００')).toBe('ff8800');
        expect(shown(ColorInput, 'ff88')).toEqual({ issue: { code: 'shape', kind: 'color' } });
        expect(shown(ColorInput, 'reddish')).toEqual({ issue: { code: 'shape', kind: 'color' } });
    });

    it('read a name with the space around it taken off, an empty one refused; free text as typed', () => {
        expect(shown(TextInput, '  週次  ')).toBe('週次');
        expect(shown(TextInput, ' 　')).toEqual({ issue: { code: 'empty' } });
        expect(shown(FreeText, ' a ')).toBe(' a ');
        expect(shown(FreeText, '')).toBe('');
    });
});
