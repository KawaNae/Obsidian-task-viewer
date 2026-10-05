import { describe, it, expect } from 'vitest';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';

const items = (text: string) => {
    const value = PropertyValues.fromText(text);
    return value.type === 'array' ? value.items : null;
};

describe('PropertyValues.fromText', () => {
    it('reads numbers', () => {
        expect(PropertyValues.fromText('2000')).toEqual({ type: 'number', value: '2000', number: 2000 });
        expect(PropertyValues.fromText('3.14')).toEqual({ type: 'number', value: '3.14', number: 3.14 });
    });

    it('reads YAML\'s six boolean spellings, keeping the spelling (論点14a)', () => {
        for (const [text, boolean] of [
            ['true', true], ['True', true], ['TRUE', true],
            ['false', false], ['False', false], ['FALSE', false],
        ] as const) {
            expect(PropertyValues.fromText(text)).toEqual({ type: 'boolean', value: text, boolean });
        }
    });

    it('reads other spellings of truth as text', () => {
        for (const text of ['tRue', 'yes', 'on', 'no', 'off']) {
            expect(PropertyValues.fromText(text).type).toBe('string');
        }
        expect(PropertyValues.fromText('1').type).toBe('number');
    });

    it('reads arrays, in brackets or separated by commas', () => {
        expect(PropertyValues.fromText('[a, b]')).toEqual({ type: 'array', value: '[a, b]', items: ['a', 'b'] });
        expect(items('[single]')).toEqual(['single']);
        expect(items('apple, banana')).toEqual(['apple', 'banana']);
        expect(items('a,b')).toEqual(['a', 'b']);
        expect(items('[]')).toEqual([]);
    });

    it('reads a wikilink as one item, its brackets and commas its own', () => {
        expect(items('[[x]]')).toEqual(['[[x]]']);
        expect(items('[[a]], [[b]]')).toEqual(['[[a]]', '[[b]]']);
        expect(items('[[a|b, c]]')).toEqual(['[[a|b, c]]']);
        expect(items('[[[a]], b]')).toEqual(['[[a]]', 'b']);
        expect(items('![[p.png]], x')).toEqual(['![[p.png]]', 'x']);
    });

    it('drops empty items', () => {
        expect(items('a, , b,')).toEqual(['a', 'b']);
        expect(items(',')).toEqual([]);
    });

    it('reads anything else as a string', () => {
        expect(PropertyValues.fromText('高')).toEqual({ type: 'string', value: '高' });
    });
});

describe('PropertyValues.fromYaml', () => {
    it('keeps the type YAML read', () => {
        expect(PropertyValues.fromYaml(true)).toEqual({ type: 'boolean', value: 'true', boolean: true });
        expect(PropertyValues.fromYaml(false)).toEqual({ type: 'boolean', value: 'false', boolean: false });
        expect(PropertyValues.fromYaml(7)).toEqual({ type: 'number', value: '7', number: 7 });
        expect(PropertyValues.fromYaml('true')).toEqual({ type: 'string', value: 'true' });
        expect(PropertyValues.fromYaml(['a', 'b, c', 3])).toEqual({ type: 'array', value: 'a, b, c, 3', items: ['a', 'b, c', '3'] });
    });

    it('reads a Date as its date text, and no value as none', () => {
        expect(PropertyValues.fromYaml(new Date(2026, 8, 21))).toEqual({ type: 'string', value: '2026-09-21' });
        expect(PropertyValues.fromYaml(null)).toBeNull();
        expect(PropertyValues.fromYaml(undefined)).toBeNull();
    });
});

describe('PropertyValues.isTrue', () => {
    it('is true for a boolean true only', () => {
        expect(PropertyValues.isTrue(PropertyValues.fromText('TRUE'))).toBe(true);
        expect(PropertyValues.isTrue(PropertyValues.fromText('False'))).toBe(false);
        expect(PropertyValues.isTrue(PropertyValues.fromText('yes'))).toBe(false);
        expect(PropertyValues.isTrue(PropertyValues.fromYaml(1))).toBe(false);
        expect(PropertyValues.isTrue(null)).toBe(false);
    });
});
