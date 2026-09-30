import { describe, it, expect } from 'vitest';
import { BuiltinPropertyExtractor } from '../../../src/services/parsing/tree/BuiltinPropertyExtractor';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';
import { DEFAULT_SCOPE_KEYS } from '../../../src/types';

const keys = DEFAULT_SCOPE_KEYS;

/** The frontmatter as the sections' base reads it: normalized, then its built-ins put apart. */
const frontmatterLayer = (fm: Record<string, unknown> | undefined, k: typeof keys) =>
    BuiltinPropertyExtractor.extract(PropertyValues.fromFrontmatter(fm, k), k);

describe('the frontmatter layer (PropertyValues.fromFrontmatter + BuiltinPropertyExtractor)', () => {
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
            expect(result.properties['custom1']).toEqual({ value: 'value1', type: 'string' });
            expect(result.properties['custom2']).toEqual({ value: '42', type: 'number', number: 42 });
            expect(result.properties['tv-color']).toBeUndefined();
        });

        it('boolean / number / array / string を type 推定', () => {
            const result = frontmatterLayer({
                'b': true,
                'n': 3.14,
                'a': ['x', 'y'],
                's': 'hello',
            }, keys);
            expect(result.properties['b']).toEqual({ value: 'true', type: 'boolean', boolean: true });
            expect(result.properties['n']).toEqual({ value: '3.14', type: 'number', number: 3.14 });
            expect(result.properties['a']).toEqual({ value: 'x, y', type: 'array', items: ['x', 'y'] });
            expect(result.properties['s']).toEqual({ value: 'hello', type: 'string' });
        });

        it('null / undefined 値は properties から除外', () => {
            const result = frontmatterLayer({
                'a': null,
                'b': undefined,
                'c': 'kept',
            }, keys);
            expect(result.properties['a']).toBeUndefined();
            expect(result.properties['b']).toBeUndefined();
            expect(result.properties['c']).toEqual({ value: 'kept', type: 'string' });
        });

        it('Obsidian 内部キー (position) を properties から除外', () => {
            const result = frontmatterLayer({
                'position': { start: { line: 0 }, end: { line: 5 } },
                'real-prop': 'kept',
            }, keys);
            expect(result.properties['position']).toBeUndefined();
            expect(result.properties['real-prop']).toEqual({ value: 'kept', type: 'string' });
        });

        it('tags キーは properties に含めない (専用フィールドへ)', () => {
            const result = frontmatterLayer({
                'tags': ['a', 'b'],
                'custom': 'kept',
            }, keys);
            expect(result.properties['tags']).toBeUndefined();
            expect(result.properties['custom']).toEqual({ value: 'kept', type: 'string' });
        });
    });

    describe('tags', () => {
        it('配列形式の tags を抽出', () => {
            const result = frontmatterLayer({ 'tags': ['x', 'y'] }, keys);
            expect(result.tags).toEqual(['x', 'y']);
        });

        it('カンマ区切り string の tags を抽出', () => {
            const result = frontmatterLayer({ 'tags': 'a, b, c' }, keys);
            expect(result.tags).toEqual(['a', 'b', 'c']);
        });

        it('tags が空なら undefined', () => {
            const result = frontmatterLayer({ 'tags': [] }, keys);
            expect(result.tags).toBeUndefined();
        });

        it('tags が無いなら undefined', () => {
            const result = frontmatterLayer({ 'tv-color': 'ff0000' }, keys);
            expect(result.tags).toBeUndefined();
        });
    });

    describe('dates', () => {
        it('reads a date key\'s Date and minutes of the day as the date text', () => {
            const result = frontmatterLayer({
                'tv-start': new Date(2026, 8, 21, 9, 30),
                'tv-end': 630,
                'tv-due': '2026-09-30',
            }, keys);
            expect(result.startDate).toBe('2026-09-21');
            expect(result.startTime).toBe('09:30');
            expect(result.endTime).toBe('10:30');
            expect(result.due).toBe('2026-09-30');
        });

        it('keeps a number under another key a number', () => {
            expect(frontmatterLayer({ n: 630 }, keys).properties.n).toEqual({ value: '630', type: 'number', number: 630 });
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
            expect(result.properties['fm-prop']).toEqual({ value: 'fm-value', type: 'string' });
        });
    });
});
