import { describe, it, expect } from 'vitest';
import { parse as yamlParse } from 'yaml';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';
import type { PropertyValue } from '../../../src/types';

/**
 * A line's value is typed by its spelling, as YAML 1.2's core schema types the
 * same spelling unquoted. The YAML is the one Obsidian reads the frontmatter
 * with (eemeli/yaml, called as Obsidian calls it).
 */
const yamlOf = (spelling: string): unknown => (yamlParse(`k: ${spelling}`, null, {}) as { k: unknown }).k;

/** What a value means, as YAML gives it: null, a number, a boolean or a string. */
function meaning(value: PropertyValue): unknown {
    switch (value.type) {
        case 'null': return null;
        case 'number': return value.number;
        case 'boolean': return value.boolean;
        case 'text': return value.text;
        case 'list': return value.items.map(meaning);
    }
}

const NUMBERS: ReadonlyArray<[string, number]> = [
    ['0', 0], ['2000', 2000], ['-5', -5], ['+5', 5], ['017', 17], ['3.14', 3.14], ['.5', 0.5], ['-.5', -0.5],
    ['5.', 5], ['1e3', 1000], ['1E3', 1000], ['2.5e-2', 0.025], ['.5e1', 5], ['0x1F', 31], ['0xff', 255], ['0o17', 15],
    ['.inf', Infinity], ['.Inf', Infinity], ['+.INF', Infinity], ['-.inf', -Infinity], ['.nan', NaN], ['.NaN', NaN], ['.NAN', NaN],
];
const BOOLEANS: ReadonlyArray<[string, boolean]> = [
    ['true', true], ['True', true], ['TRUE', true], ['false', false], ['False', false], ['FALSE', false],
];
const NULLS = ['', 'null', 'Null', 'NULL', '~'];
/** YAML 1.1's numbers, booleans and nulls, and near misses: text in YAML 1.2. */
const TEXTS = [
    '1_000', '1,000', '10:30', '12:30:45', '0X1F', '0b101', '+0x1F', '-0o17', '0o8', '1e', 'e3', '.', '+', '-.nan', '.infinity',
    'tRue', 'yes', 'Yes', 'on', 'off', 'no', 'y', 'nULL', 'none', '高', '2026-10-12', '2026-10-12T10:00', 'a b',
];
const QUOTED: ReadonlyArray<[string, string]> = [
    ['"123"', '123'], ['\'true\'', 'true'], ['"null"', 'null'], ['""', ''], ['\'\'', ''], ['"a b"', 'a b'], ['"0x1F"', '0x1F'],
];

describe('PropertyValues.fromText reads a spelling as YAML reads it unquoted', () => {
    it('reads the core schema\'s numbers, keeping the spelling', () => {
        for (const [spelling, number] of NUMBERS) {
            const value = PropertyValues.fromText(spelling);
            expect(value, spelling).toEqual({ type: 'number', number, spelling });
            expect(yamlOf(spelling), spelling).toEqual(number);
        }
    });

    it('reads true and false in three spellings each, keeping the spelling', () => {
        for (const [spelling, boolean] of BOOLEANS) {
            expect(PropertyValues.fromText(spelling), spelling).toEqual({ type: 'boolean', boolean, spelling });
            expect(yamlOf(spelling), spelling).toBe(boolean);
        }
    });

    it('reads nothing, null and ~ as no value, keeping the spelling', () => {
        for (const spelling of NULLS) {
            expect(PropertyValues.fromText(spelling), spelling).toEqual({ type: 'null', spelling });
            expect(yamlOf(spelling), spelling).toBeNull();
        }
    });

    it('reads anything else as text', () => {
        for (const spelling of TEXTS) {
            expect(PropertyValues.fromText(spelling), spelling).toEqual({ type: 'text', text: spelling, spelling });
            expect(yamlOf(spelling), spelling).toBe(spelling);
        }
    });

    it('reads a value all in " or \' as the text inside, keeping the spelling', () => {
        for (const [spelling, text] of QUOTED) {
            expect(PropertyValues.fromText(spelling), spelling).toEqual({ type: 'text', text, spelling });
            expect(yamlOf(spelling), spelling).toBe(text);
        }
    });

    it('reads quotes as quotes when they do not hold the whole value, and reads no escape', () => {
        for (const spelling of ['"Hello" he said', '"a\'', '"', '\'', 'say "hi"', '“123”', '「x」']) {
            expect(PropertyValues.fromText(spelling), spelling).toEqual({ type: 'text', text: spelling, spelling });
        }
        expect(PropertyValues.fromText('"a\\"b"')).toEqual({ type: 'text', text: 'a\\"b', spelling: '"a\\"b"' });
        expect(PropertyValues.fromText('"a"b"')).toEqual({ type: 'text', text: 'a"b', spelling: '"a"b"' });
    });

    // Where a line and YAML part: a line writes no list in brackets nor
    // anything YAML reads past a plain scalar, so these are text as written.
    it('reads brackets, a comma, a tag and a colon as text', () => {
        for (const spelling of ['[a, b]', '[]', '[[x]]', '[[a]], [[b]]', 'apple, banana', '#tag', 'a: b', '{a: 1}', '- x', 'x # y']) {
            expect(PropertyValues.fromText(spelling), spelling).toEqual({ type: 'text', text: spelling, spelling });
        }
    });

    it('reads a full-width digit as text, as YAML does', () => {
        expect(PropertyValues.fromText('１２３')).toEqual({ type: 'text', text: '１２３', spelling: '１２３' });
        expect(yamlOf('１２３')).toBe('１２３');
    });
});

describe('PropertyValues.fromYaml', () => {
    it('keeps the type YAML read, spelled as a line reads it back', () => {
        expect(PropertyValues.fromYaml(true)).toEqual({ type: 'boolean', boolean: true, spelling: 'true' });
        expect(PropertyValues.fromYaml(false)).toEqual({ type: 'boolean', boolean: false, spelling: 'false' });
        expect(PropertyValues.fromYaml(7)).toEqual({ type: 'number', number: 7, spelling: '7' });
        expect(PropertyValues.fromYaml(Infinity)).toEqual({ type: 'number', number: Infinity, spelling: '.inf' });
        expect(PropertyValues.fromYaml('true')).toEqual({ type: 'text', text: 'true', spelling: '"true"' });
        expect(PropertyValues.fromYaml('"q"')).toEqual({ type: 'text', text: '"q"', spelling: '""q""' });
        expect(PropertyValues.fromYaml('')).toEqual({ type: 'text', text: '', spelling: '""' });
        expect(PropertyValues.fromYaml(null)).toEqual({ type: 'null', spelling: '' });
    });

    it('reads every value of the spelling table back from its spelling', () => {
        const values = [...NUMBERS.map(([s]) => s), ...BOOLEANS.map(([s]) => s), ...TEXTS, ...QUOTED.map(([s]) => s)].map(yamlOf);
        for (const yaml of values) {
            const value = PropertyValues.fromYaml(yaml)!;
            expect(meaning(PropertyValues.fromText(PropertyValues.spelling(value))), String(yaml)).toEqual(meaning(value));
        }
    });

    it('reads a list\'s scalar items, and none that is no value, a list or a mapping', () => {
        expect(PropertyValues.fromYaml(['a', ' b ', '', 3, true, null, ['x'], { y: 1 }])).toEqual({
            type: 'list',
            items: [
                { type: 'text', text: 'a', spelling: 'a' },
                { type: 'text', text: 'b', spelling: 'b' },
                { type: 'number', number: 3, spelling: '3' },
                { type: 'boolean', boolean: true, spelling: 'true' },
            ],
        });
        expect(PropertyValues.fromYaml([])).toEqual({ type: 'list', items: [] });
    });

    it('reads no property from a mapping', () => {
        expect(PropertyValues.fromYaml({ p: 1 })).toBeNull();
    });
});

describe('PropertyValues.display and spelling', () => {
    it('shows a text without its quotes and anything else as spelled', () => {
        const shown = (spelling: string) => PropertyValues.display(PropertyValues.fromText(spelling));
        expect(shown('"123"')).toBe('123');
        expect(shown('0x1F')).toBe('0x1F');
        expect(shown('True')).toBe('True');
        expect(shown('007')).toBe('007');
        expect(shown('')).toBe('');
        expect(shown('~')).toBe('~');
    });

    it('writes a line\'s value as it was spelled', () => {
        for (const spelling of ['"123"', '0x1F', 'True', '007', '', '~', 'a b']) {
            expect(PropertyValues.spelling(PropertyValues.fromText(spelling))).toBe(spelling);
        }
    });

    it('shows a list as its items shown, joined by ", "', () => {
        expect(PropertyValues.display(PropertyValues.fromYaml(['a', 1, '123'])!)).toBe('a, 1, 123');
    });
});

describe('PropertyValues.isTrue', () => {
    it('is true for a boolean true only', () => {
        expect(PropertyValues.isTrue(PropertyValues.fromText('TRUE'))).toBe(true);
        expect(PropertyValues.isTrue(PropertyValues.fromText('False'))).toBe(false);
        expect(PropertyValues.isTrue(PropertyValues.fromText('yes'))).toBe(false);
        expect(PropertyValues.isTrue(PropertyValues.fromText('"true"'))).toBe(false);
        expect(PropertyValues.isTrue(PropertyValues.fromYaml(1))).toBe(false);
        expect(PropertyValues.isTrue(null)).toBe(false);
    });
});
