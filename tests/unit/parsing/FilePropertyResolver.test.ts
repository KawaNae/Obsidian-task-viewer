import { describe, it, expect } from 'vitest';
import { FilePropertyResolver } from '../../../src/services/parsing/FilePropertyResolver';
import { DEFAULT_TV_FILE_KEYS } from '../../../src/types';

const keys = DEFAULT_TV_FILE_KEYS;

describe('FilePropertyResolver', () => {
    describe('builtin keys', () => {
        it('色を normalizeColor で正規化', () => {
            const result = FilePropertyResolver.extract({ 'tv-color': '#ff0000' }, keys);
            expect(result.color).toBe('ff0000');
        });

        it('色が空文字なら undefined', () => {
            const result = FilePropertyResolver.extract({ 'tv-color': '   ' }, keys);
            expect(result.color).toBeUndefined();
        });

        it('linestyle が valid set 内なら小文字化して返す', () => {
            const result = FilePropertyResolver.extract({ 'tv-linestyle': 'Dashed' }, keys);
            expect(result.linestyle).toBe('dashed');
        });

        it('linestyle が invalid 値なら undefined (validation)', () => {
            const result = FilePropertyResolver.extract({ 'tv-linestyle': 'bogus-value' }, keys);
            expect(result.linestyle).toBeUndefined();
        });

        it('linestyle が string でないなら undefined', () => {
            const result = FilePropertyResolver.extract({ 'tv-linestyle': 123 }, keys);
            expect(result.linestyle).toBeUndefined();
        });

        it('mask は trim して返す', () => {
            const result = FilePropertyResolver.extract({ 'tv-mask': '  test  ' }, keys);
            expect(result.mask).toBe('test');
        });

        it('mask が空文字なら undefined', () => {
            const result = FilePropertyResolver.extract({ 'tv-mask': '   ' }, keys);
            expect(result.mask).toBeUndefined();
        });
    });

    describe('custom properties', () => {
        it('TvFileKeys に該当しないキーを properties に格納', () => {
            const result = FilePropertyResolver.extract({
                'tv-color': 'ff0000',
                'custom1': 'value1',
                'custom2': 42,
            }, keys);
            expect(result.properties['custom1']).toEqual({ value: 'value1', type: 'string' });
            expect(result.properties['custom2']).toEqual({ value: '42', type: 'number' });
            expect(result.properties['tv-color']).toBeUndefined();
        });

        it('boolean / number / array / string を type 推定', () => {
            const result = FilePropertyResolver.extract({
                'b': true,
                'n': 3.14,
                'a': ['x', 'y'],
                's': 'hello',
            }, keys);
            expect(result.properties['b']).toEqual({ value: 'true', type: 'boolean' });
            expect(result.properties['n']).toEqual({ value: '3.14', type: 'number' });
            expect(result.properties['a']).toEqual({ value: 'x, y', type: 'array' });
            expect(result.properties['s']).toEqual({ value: 'hello', type: 'string' });
        });

        it('null / undefined 値は properties から除外', () => {
            const result = FilePropertyResolver.extract({
                'a': null,
                'b': undefined,
                'c': 'kept',
            }, keys);
            expect(result.properties['a']).toBeUndefined();
            expect(result.properties['b']).toBeUndefined();
            expect(result.properties['c']).toEqual({ value: 'kept', type: 'string' });
        });

        it('Obsidian 内部キー (position) を properties から除外', () => {
            const result = FilePropertyResolver.extract({
                'position': { start: { line: 0 }, end: { line: 5 } },
                'real-prop': 'kept',
            }, keys);
            expect(result.properties['position']).toBeUndefined();
            expect(result.properties['real-prop']).toEqual({ value: 'kept', type: 'string' });
        });

        it('tags キーは properties に含めない (専用フィールドへ)', () => {
            const result = FilePropertyResolver.extract({
                'tags': ['a', 'b'],
                'custom': 'kept',
            }, keys);
            expect(result.properties['tags']).toBeUndefined();
            expect(result.properties['custom']).toEqual({ value: 'kept', type: 'string' });
        });
    });

    describe('tags', () => {
        it('配列形式の tags を抽出', () => {
            const result = FilePropertyResolver.extract({ 'tags': ['x', 'y'] }, keys);
            expect(result.tags).toEqual(['x', 'y']);
        });

        it('カンマ区切り string の tags を抽出', () => {
            const result = FilePropertyResolver.extract({ 'tags': 'a, b, c' }, keys);
            expect(result.tags).toEqual(['a', 'b', 'c']);
        });

        it('tags が空なら undefined', () => {
            const result = FilePropertyResolver.extract({ 'tags': [] }, keys);
            expect(result.tags).toBeUndefined();
        });

        it('tags が無いなら undefined', () => {
            const result = FilePropertyResolver.extract({ 'tv-color': 'ff0000' }, keys);
            expect(result.tags).toBeUndefined();
        });
    });

    describe('edge cases', () => {
        it('frontmatter が undefined なら empty result', () => {
            const result = FilePropertyResolver.extract(undefined, keys);
            expect(result).toEqual({ properties: {} });
        });

        it('frontmatter が空 object なら empty result', () => {
            const result = FilePropertyResolver.extract({}, keys);
            expect(result.color).toBeUndefined();
            expect(result.linestyle).toBeUndefined();
            expect(result.mask).toBeUndefined();
            expect(result.tags).toBeUndefined();
            expect(result.properties).toEqual({});
        });

        it('全フィールドを統合的に抽出', () => {
            const result = FilePropertyResolver.extract({
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
