import { describe, it, expect } from 'vitest';
import { BuiltinPropertyExtractor } from '../../../src/services/parsing/tree/BuiltinPropertyExtractor';
import { DEFAULT_SCOPE_KEYS } from '../../../src/types';
import { valuesOf } from '../helpers/properties';

const keys = DEFAULT_SCOPE_KEYS;

/**
 * The frontmatter as the sections' base reads it: normalized, then its
 * built-ins put apart; its custom properties under their keys as written.
 */
const frontmatterLayer = (fm: Record<string, unknown> | undefined, k: typeof keys) => {
    const result = BuiltinPropertyExtractor.fromFrontmatter(fm, k);
    return { ...result, properties: valuesOf(result.properties) };
};

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

    describe('custom properties', () => {
        it('ScopeKeys に該当しないキーを properties に格納', () => {
            const result = frontmatterLayer({
                'tv-color': 'ff0000',
                'custom1': 'value1',
                'custom2': 42,
            }, keys);
            expect(result.properties['custom1']).toEqual({ type: 'text', text: 'value1', spelling: 'value1' });
            expect(result.properties['custom2']).toEqual({ type: 'number', number: 42, spelling: '42' });
            expect(result.properties['tv-color']).toBeUndefined();
        });

        it('boolean / number / array / string を type 推定', () => {
            const result = frontmatterLayer({
                'b': true,
                'n': 3.14,
                'a': ['x', 'y'],
                's': 'hello',
            }, keys);
            expect(result.properties['b']).toEqual({ type: 'boolean', boolean: true, spelling: 'true' });
            expect(result.properties['n']).toEqual({ type: 'number', number: 3.14, spelling: '3.14' });
            expect(result.properties['a']).toEqual({ type: 'list', items: [
                { type: 'text', text: 'x', spelling: 'x' },
                { type: 'text', text: 'y', spelling: 'y' },
            ] });
            expect(result.properties['s']).toEqual({ type: 'text', text: 'hello', spelling: 'hello' });
        });

        it('null / undefined 値は properties から除外', () => {
            const result = frontmatterLayer({
                'a': null,
                'b': undefined,
                'c': 'kept',
            }, keys);
            expect(result.properties['a']).toBeUndefined();
            expect(result.properties['b']).toBeUndefined();
            expect(result.properties['c']).toEqual({ type: 'text', text: 'kept', spelling: 'kept' });
        });

        it('reads no property from a mapping, nor an item from a list or a mapping in a list', () => {
            const result = frontmatterLayer({
                'map': { p: 1 },
                'mixed': ['a', ['b'], { c: 1 }, null, 2],
                'tv-color': { red: true },
            }, keys);
            expect(result.properties['map']).toBeUndefined();
            expect(result.properties['mixed']).toEqual({ type: 'list', items: [
                { type: 'text', text: 'a', spelling: 'a' },
                { type: 'number', number: 2, spelling: '2' },
            ] });
            expect(result.color).toBeUndefined();
        });

        it('spells a text a line would read as something else in quotes, and a number as YAML does', () => {
            const result = frontmatterLayer({ id: '123', flag: 'true', plain: 'a b', inf: -Infinity, nan: NaN }, keys);
            expect(result.properties['id']).toEqual({ type: 'text', text: '123', spelling: '"123"' });
            expect(result.properties['flag']).toEqual({ type: 'text', text: 'true', spelling: '"true"' });
            expect(result.properties['plain']).toEqual({ type: 'text', text: 'a b', spelling: 'a b' });
            expect(result.properties['inf']).toEqual({ type: 'number', number: -Infinity, spelling: '-.inf' });
            expect(result.properties['nan']).toMatchObject({ type: 'number', spelling: '.nan' });
        });

        it('Obsidian 内部キー (position) を properties から除外', () => {
            const result = frontmatterLayer({
                'position': { start: { line: 0 }, end: { line: 5 } },
                'real-prop': 'kept',
            }, keys);
            expect(result.properties['position']).toBeUndefined();
            expect(result.properties['real-prop']).toEqual({ type: 'text', text: 'kept', spelling: 'kept' });
        });

        it('tags キーは properties に含めない (専用フィールドへ)', () => {
            const result = frontmatterLayer({
                'tags': ['a', 'b'],
                'custom': 'kept',
            }, keys);
            expect(result.properties['tags']).toBeUndefined();
            expect(result.properties['custom']).toEqual({ type: 'text', text: 'kept', spelling: 'kept' });
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
            expect(result.tags).toEqual(['x']);
            expect(result.properties['Tags']).toBeUndefined();
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

        it('keeps a number under another key a number', () => {
            expect(frontmatterLayer({ n: 630 }, keys).properties.n).toEqual({ type: 'number', number: 630, spelling: '630' });
        });
    });

    describe('edge cases', () => {
        it('frontmatter が undefined なら empty result', () => {
            const result = frontmatterLayer(undefined, keys);
            expect(result).toEqual({ properties: {} });
        });

        it('frontmatter が空 object なら empty result', () => {
            const result = frontmatterLayer({}, keys);
            expect(result.color).toBeUndefined();
            expect(result.linestyle).toBeUndefined();
            expect(result.mask).toBeUndefined();
            expect(result.tags).toBeUndefined();
            expect(result.properties).toEqual({});
        });

        it('全フィールドを統合的に抽出', () => {
            const result = frontmatterLayer({
                'tv-color': '#abcdef',
                'tv-linestyle': 'dotted',
                'tv-mask': 'mask-val',
                'tags': ['t1', 't2'],
                'position': { internal: true },
                'fm-prop': 'fm-value',
                'tv-start': '2026-05-02', // builtin key (excluded)
            }, keys);
            expect(result.color).toBe('abcdef');
            expect(result.linestyle).toBe('dotted');
            expect(result.mask).toBe('mask-val');
            expect(result.tags).toEqual(['t1', 't2']);
            expect(result.properties['position']).toBeUndefined();
            expect(result.properties['tv-start']).toBeUndefined();
            expect(result.properties['fm-prop']).toEqual({ type: 'text', text: 'fm-value', spelling: 'fm-value' });
        });
    });
});
