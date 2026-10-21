import { describe, it, expect } from 'vitest';
import { stringifyYaml } from 'obsidian';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { BuiltinPropertyExtractor } from '../../../src/services/parsing/tree/BuiltinPropertyExtractor';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';
import { DEFAULT_SCOPE_KEYS, DEFAULT_SETTINGS } from '../../../src/types';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';

/**
 * The frontmatter as Obsidian's YAML reads it: YAML 1.2's core schema, with a
 * key written twice refused. The values are the ones Obsidian 1.14 gives in
 * metadataCache and from `parseYaml` for the same lines.
 */
const frontmatterOf = (yaml: string[]) =>
    FileParsePipeline.resolveSections(['---', ...yaml, '---', '- [ ] task'], DEFAULT_SETTINGS)?.frontmatter;

const valueOf = (spelling: string) => frontmatterOf([`k: ${spelling}`])?.k;

describe('the frontmatter as Obsidian reads its YAML', () => {
    it('keeps a date, and a date and time, as the text written', () => {
        expect(valueOf('2026-10-12')).toBe('2026-10-12');
        expect(valueOf('2026-10-12T10:00')).toBe('2026-10-12T10:00');
        expect(valueOf('2026-02-30')).toBe('2026-02-30');
    });

    it('reads the numbers of the core schema, and leaves YAML 1.1\'s other spellings text', () => {
        expect(valueOf('-5')).toBe(-5);
        expect(valueOf('+5')).toBe(5);
        expect(valueOf('.5')).toBe(0.5);
        expect(valueOf('5.')).toBe(5);
        expect(valueOf('1e3')).toBe(1000);
        expect(valueOf('0x1F')).toBe(31);
        expect(valueOf('0o17')).toBe(15);
        expect(valueOf('017')).toBe(17);
        expect(valueOf('.inf')).toBe(Infinity);
        expect(valueOf('-.inf')).toBe(-Infinity);
        expect(valueOf('.nan')).toBeNaN();
        expect(valueOf('1_000')).toBe('1_000');
        expect(valueOf('1,000')).toBe('1,000');
        expect(valueOf('10:30')).toBe('10:30');
        expect(valueOf('12:30:45')).toBe('12:30:45');
    });

    it('reads true and false in three spellings each, and leaves yes and on text', () => {
        for (const spelling of ['true', 'True', 'TRUE']) expect(valueOf(spelling)).toBe(true);
        for (const spelling of ['false', 'False', 'FALSE']) expect(valueOf(spelling)).toBe(false);
        for (const spelling of ['tRue', 'yes', 'Yes', 'on', 'y', 'off', 'no']) expect(valueOf(spelling)).toBe(spelling);
    });

    it('tells null, an empty string and an empty list apart', () => {
        for (const spelling of ['null', 'Null', 'NULL', '~', '']) expect(valueOf(spelling)).toBeNull();
        expect(valueOf('""')).toBe('');
        expect(valueOf('[]')).toEqual([]);
    });

    it('reads a quoted value as text, and an unquoted wikilink as nested lists', () => {
        expect(valueOf('"123"')).toBe('123');
        expect(valueOf('\'true\'')).toBe('true');
        expect(valueOf('"[[x]]"')).toBe('[[x]]');
        expect(valueOf('[[x]]')).toEqual([['x']]);
    });

    it('reads no frontmatter at all when a key is written twice', () => {
        expect(frontmatterOf(['before: 1', 'bkey: lab', 'bkey: desk', 'after: 2'])).toBeUndefined();
    });

    it('reads no frontmatter from a block that reads as a list or a text, as Obsidian\'s worker keeps a mapping alone', () => {
        expect(frontmatterOf(['- a', '- b'])).toBeUndefined();
        expect(frontmatterOf(['just text'])).toBeUndefined();
        const task = FileParsePipeline.parse('n.md', ['---', '- tv-color: red', '---', '- [ ] t'], DEFAULT_SETTINGS, namesOutsideIndex('n.md')).tasks[0];
        expect(task.cascadeContext).toBeUndefined();
    });

    it('keeps keys that differ only in case apart', () => {
        expect(frontmatterOf(['Area: lab', 'area: desk'])).toEqual({ Area: 'lab', area: 'desk' });
    });
});

describe('the frontmatter\'s values', () => {
    /** The frontmatter's built-ins, as the sections' base reads them. */
    const layer = (yaml: string[]) => BuiltinPropertyExtractor.fromFrontmatter(frontmatterOf(yaml), DEFAULT_SCOPE_KEYS);

    it('reads `1_000` and `10:30` under an ordinary key as text', () => {
        const properties = PropertyValues.fromFrontmatter(frontmatterOf(['n: 1_000', 't: 10:30', 'm: 1000']));
        expect(properties.n.value).toMatchObject({ type: 'text', text: '1_000', spelling: '1_000' });
        expect(properties.t.value).toMatchObject({ type: 'text', text: '10:30', spelling: '10:30' });
        expect(properties.m.value).toMatchObject({ type: 'number', number: 1000 });
    });

    it('reads a date key from the text the YAML keeps', () => {
        const result = layer(['tv-start: 2026-10-12T09:30', 'tv-end: 10:30', 'tv-due: 2026-10-31']);
        expect(result.startDate).toBe('2026-10-12');
        expect(result.startTime).toBe('09:30');
        expect(result.endTime).toBe('10:30');
        expect(result.due).toBe('2026-10-31');
    });
});

describe('stringifyYaml as Obsidian writes a frontmatter', () => {
    it('writes null bare, and quotes a string YAML would read as another type', () => {
        expect(stringifyYaml({
            none: null, empty: '', list: [], digits: '123', word: 'true', link: '[[x]]', pair: 'a: b',
        })).toBe([
            'none:', 'empty: ""', 'list: []', 'digits: "123"', 'word: "true"', 'link: "[[x]]"', 'pair: "a: b"', '',
        ].join('\n'));
    });

    it('leaves a date and the spellings YAML 1.2 reads as text unquoted', () => {
        expect(stringifyYaml({ day: '2026-10-12', n: '1_000', t: '10:30', nan: NaN })).toBe(
            ['day: 2026-10-12', 'n: 1_000', 't: 10:30', 'nan: .nan', ''].join('\n'),
        );
    });
});
