import { describe, it, expect } from 'vitest';
import { readBuiltin } from '../../../src/services/parsing/utils/BuiltinValues';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';

const line = (spelling: string) => PropertyValues.fromText(spelling);
const list = (...items: string[]) => ({ type: 'list' as const, items: items.map(item => PropertyValues.fromText(item) as never) });

describe('readBuiltin', () => {
    it('reads no value as null, for every built-in but the tags', () => {
        for (const builtin of ['color', 'linestyle', 'mask', 'start', 'end', 'due'] as const) {
            for (const spelling of ['', 'null', '~']) expect(readBuiltin(builtin, line(spelling)), `${builtin} ${spelling}`).toBeNull();
        }
    });

    it('reads no value of the tags as no tags: nothing hides tags', () => {
        expect(readBuiltin('tags', line(''))).toEqual({ builtin: 'tags', tags: [] });
    });

    it('reads a list as a value it cannot read, but for the tags', () => {
        expect(readBuiltin('color', list('red'))).toBeUndefined();
        expect(readBuiltin('start', list('2026-01-01'))).toBeUndefined();
        expect(readBuiltin('tags', list('#a', 'b'))).toEqual({ builtin: 'tags', tags: ['a'] });
    });

    it('reads a value it cannot read as undefined', () => {
        expect(readBuiltin('linestyle', line('wavy'))).toBeUndefined();
        expect(readBuiltin('color', line('""'))).toBeUndefined();
        expect(readBuiltin('start', line('2026-02-30'))).toBeUndefined();
        expect(readBuiltin('start', line('someday'))).toBeUndefined();
        expect(readBuiltin('end', line('25:00'))).toBeUndefined();
        expect(readBuiltin('due', line('10:00'))).toBeUndefined();
    });

    it('reads a date and a time on their own', () => {
        expect(readBuiltin('start', line('11:00'))).toEqual({ builtin: 'start', date: undefined, time: '11:00' });
        expect(readBuiltin('end', line('2026-01-01T10:00'))).toEqual({ builtin: 'end', date: '2026-01-01', time: '10:00' });
        expect(readBuiltin('due', line('2026-01-01T10:00'))).toEqual({ builtin: 'due', due: '2026-01-01T10:00' });
    });

    it('reads a value as its text shown, whatever its type', () => {
        expect(readBuiltin('color', line('"#ff0000"'))).toEqual({ builtin: 'color', text: 'ff0000' });
        expect(readBuiltin('color', line('336699'))).toEqual({ builtin: 'color', text: '336699' });
        expect(readBuiltin('linestyle', line('Dashed'))).toEqual({ builtin: 'linestyle', text: 'dashed' });
    });
});
