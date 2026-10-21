import { describe, it, expect } from 'vitest';
import { BuiltinPropertyExtractor } from '../../../src/services/parsing/tree/BuiltinPropertyExtractor';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';
import { DEFAULT_SCOPE_KEYS } from '../../../src/types';
import { valuesOf } from '../helpers/properties';

const keys = DEFAULT_SCOPE_KEYS;

/** The frontmatter as the sections' base reads it: its built-ins alone. */
const frontmatterLayer = (fm: Record<string, unknown> | undefined, k: typeof keys) =>
    BuiltinPropertyExtractor.fromFrontmatter(fm, k);

/** The frontmatter's values as the YAML gave them, under their keys as written. */
const frontmatterValues = (fm: Record<string, unknown> | undefined) => valuesOf(PropertyValues.fromFrontmatter(fm));

describe('the frontmatter layer (BuiltinPropertyExtractor.fromFrontmatter)', () => {
    describe('builtin keys', () => {
        it('色を normalizeColor で正規化', () => {
            const result = frontmatterLayer({ 'tv-color': '#ff0000' }, keys);
            expect(result.color).toBe('ff0000');
        });

        it('色が空文字なら undefined', () => {
            const result = frontmatterLayer({ 'tv-color': '   ' }, keys);
            expect(result.color).toBeUndefined();
        });

        it('linestyle が valid set 内なら小文字化して返す', () => {
            const result = frontmatterLayer({ 'tv-linestyle': 'Dashed' }, keys);
            expect(result.linestyle).toBe('dashed');
        });

        it('linestyle が invalid 値なら undefined (validation)', () => {
            const result = frontmatterLayer({ 'tv-linestyle': 'bogus-value' }, keys);
            expect(result.linestyle).toBeUndefined();
        });

        it('linestyle が string でないなら undefined', () => {
            const result = frontmatterLayer({ 'tv-linestyle': 123 }, keys);
            expect(result.linestyle).toBeUndefined();
        });

        it('mask は trim して返す', () => {
            const result = frontmatterLayer({ 'tv-mask': '  test  ' }, keys);
            expect(result.mask).toBe('test');
        });

        it('mask が空文字なら undefined', () => {
            const result = frontmatterLayer({ 'tv-mask': '   ' }, keys);
            expect(result.mask).toBeUndefined();
        });
    });

    describe('custom keys', () => {
        it('ScopeKeys に該当しないキーは読まない: タスクに受け継がせるのは組み込みのキーだけ', () => {
            const result = frontmatterLayer({
                'tv-color': 'ff0000',
                'custom1': 'value1',
                'custom2': 42,
                '体重[kg]': null,
            }, keys);
            expect(result).toEqual({ color: 'ff0000' });
        });
    });

    describe('the values the YAML gave (PropertyValues.fromFrontmatter)', () => {

        it('boolean / number / array / string を type 推定', () => {
            const result = { properties: frontmatterValues({
                'b': true,
                'n': 3.14,
                'a': ['x', 'y'],
                's': 'hello',
            }) };
            expect(result.properties['b']).toEqual({ type: 'boolean', boolean: true, spelling: 'true' });
            expect(result.properties['n']).toEqual({ type: 'number', number: 3.14, spelling: '3.14' });
            expect(result.properties['a']).toEqual({ type: 'list', items: [
                { type: 'text', text: 'x', spelling: 'x' },
                { type: 'text', text: 'y', spelling: 'y' },
            ] });
            expect(result.properties['s']).toEqual({ type: 'text', text: 'hello', spelling: 'hello' });
        });

        it('null / undefined 値は値のないプロパティ', () => {
            const result = { properties: frontmatterValues({
                'a': null,
                'b': undefined,
                'c': 'kept',
            }) };
            expect(result.properties['a']).toEqual({ type: 'null', spelling: '' });
            expect(result.properties['b']).toEqual({ type: 'null', spelling: '' });
            expect(result.properties['c']).toEqual({ type: 'text', text: 'kept', spelling: 'kept' });
        });

        it('reads no property from a mapping, nor an item from a list or a mapping in a list', () => {
            const fm = {
                'map': { p: 1 },
                'mixed': ['a', ['b'], { c: 1 }, null, 2],
                'tv-color': { red: true },
            };
            const values = frontmatterValues(fm);
            expect(values['map']).toBeUndefined();
            expect(values['mixed']).toEqual({ type: 'list', items: [
                { type: 'text', text: 'a', spelling: 'a' },
                { type: 'number', number: 2, spelling: '2' },
            ] });
            expect(frontmatterLayer(fm, keys).color).toBeUndefined();
        });

        it('spells a text a line would read as something else in quotes, and a number as YAML does', () => {
            const result = { properties: frontmatterValues({ id: '123', flag: 'true', plain: 'a b', inf: -Infinity, nan: NaN }) };
            expect(result.properties['id']).toEqual({ type: 'text', text: '123', spelling: '"123"' });
            expect(result.properties['flag']).toEqual({ type: 'text', text: 'true', spelling: '"true"' });
            expect(result.properties['plain']).toEqual({ type: 'text', text: 'a b', spelling: 'a b' });
            expect(result.properties['inf']).toEqual({ type: 'number', number: -Infinity, spelling: '-.inf' });
            expect(result.properties['nan']).toMatchObject({ type: 'number', spelling: '.nan' });
        });

        it('Obsidian 内部キー (position) は対応表なので値にしない', () => {
            const values = frontmatterValues({
                'position': { start: { line: 0 }, end: { line: 5 } },
                'real-prop': 'kept',
            });
            expect(values['position']).toBeUndefined();
            expect(values['real-prop']).toEqual({ type: 'text', text: 'kept', spelling: 'kept' });
        });

        it('keeps a number a number', () => {
            expect(frontmatterValues({ n: 630 }).n).toEqual({ type: 'number', number: 630, spelling: '630' });
        });

        it('大小違いの重複は、値のないキーでも読まない', () => {
            expect(frontmatterValues({ Area: 'lab', area: null, other: 1 })).toEqual({ other: { type: 'number', number: 1, spelling: '1' } });
            expect(frontmatterLayer({ 'TV-COLOR': 'red', 'tv-color': null }, keys).color).toBeUndefined();
        });
    });

    describe('tags', () => {
        it('配列形式の tags を抽出', () => {
            const result = frontmatterLayer({ 'tags': ['x', 'y'] }, keys);
            expect(result.tags).toEqual(['x', 'y']);
        });

        it('文字列の tags は1項目のリスト: カンマ区切りや空白区切りはタグにならない', () => {
            expect(frontmatterLayer({ 'tags': 'a, b, c' }, keys).tags).toBeUndefined();
            expect(frontmatterLayer({ 'tags': 'a b' }, keys).tags).toBeUndefined();
            expect(frontmatterLayer({ 'tags': 'work' }, keys).tags).toEqual(['work']);
        });

        it('タグとして読めない項目は落とす', () => {
            const result = frontmatterLayer({ 'tags': ['ok', 'a.b', '123', '#lead', '##dbl', 'x,y'] }, keys);
            expect(result.tags).toEqual(['lead', 'ok']);
        });

        it('tags が空なら undefined', () => {
            const result = frontmatterLayer({ 'tags': [] }, keys);
            expect(result.tags).toBeUndefined();
        });

        it('tags が無いなら undefined', () => {
            const result = frontmatterLayer({ 'tv-color': 'ff0000' }, keys);
            expect(result.tags).toBeUndefined();
        });

        // Obsidian の parseFrontMatterTags と同じく、キーは大文字と小文字を区別しない
        it('Tags / TAGS も tags のキーとして読み、カスタムプロパティにしない', () => {
            const result = frontmatterLayer({ 'Tags': ['x'], 'custom': 'kept' }, keys);
            expect(result).toEqual({ tags: ['x'] });
            expect(frontmatterLayer({ 'TAGS': 'y' }, keys).tags).toEqual(['y']);
        });

        it('YAML が真偽値、null、数値と読んだ項目はタグにしない', () => {
            const result = frontmatterLayer({ 'tags': [true, null, 123, 'false', 'ok'] }, keys);
            expect(result.tags).toEqual(['false', 'ok']);
            expect(frontmatterLayer({ 'tags': true }, keys).tags).toBeUndefined();
        });
    });

    describe('dates', () => {
        it('reads a date key from its text, and a number as no date', () => {
            const result = frontmatterLayer({
                'tv-start': '2026-09-21T09:30',
                'tv-end': 630,
                'tv-due': '2026-09-30',
            }, keys);
            expect(result.startDate).toBe('2026-09-21');
            expect(result.startTime).toBe('09:30');
            expect(result.endDate).toBeUndefined();
            expect(result.endTime).toBeUndefined();
            expect(result.due).toBe('2026-09-30');
        });
    });

    describe('edge cases', () => {
        it('frontmatter が undefined なら empty result', () => {
            const result = frontmatterLayer(undefined, keys);
            expect(result).toEqual({});
        });

        it('frontmatter が空 object なら empty result', () => {
            const result = frontmatterLayer({}, keys);
            expect(result.color).toBeUndefined();
            expect(result.linestyle).toBeUndefined();
            expect(result.mask).toBeUndefined();
            expect(result.tags).toBeUndefined();
            expect(result).toEqual({});
        });

        it('全フィールドを統合的に抽出', () => {
            const result = frontmatterLayer({
                'tv-color': '#abcdef',
                'tv-linestyle': 'dotted',
                'tv-mask': 'mask-val',
                'tags': ['t1', 't2'],
                'position': { internal: true },
                'fm-prop': 'fm-value',
                'tv-start': '2026-05-02',
            }, keys);
            expect(result.color).toBe('abcdef');
            expect(result.linestyle).toBe('dotted');
            expect(result.mask).toBe('mask-val');
            expect(result.tags).toEqual(['t1', 't2']);
            expect(result.startDate).toBe('2026-05-02');
            expect(result).not.toHaveProperty('properties');
            expect(Object.keys(result).sort()).toEqual(['color', 'linestyle', 'mask', 'startDate', 'tags']);
        });
    });
});
