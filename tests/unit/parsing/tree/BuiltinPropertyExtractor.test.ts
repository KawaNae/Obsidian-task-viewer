import { describe, it, expect } from 'vitest';
import { BuiltinPropertyExtractor } from '../../../../src/services/parsing/tree/BuiltinPropertyExtractor';
import { DEFAULT_FRONTMATTER_TASK_KEYS } from '../../../../src/types';
import type { PropertyValue } from '../../../../src/types';

const keys = DEFAULT_FRONTMATTER_TASK_KEYS;

function pv(value: string, type: 'string' | 'number' | 'boolean' | 'array' = 'string'): PropertyValue {
    return { value, type };
}

describe('BuiltinPropertyExtractor', () => {
    it('extracts tv-color to color field', () => {
        const raw = { 'tv-color': pv('ff0000') };
        const result = BuiltinPropertyExtractor.extract(raw, keys);
        expect(result.color).toBe('ff0000');
        expect(result.properties).toEqual({});
    });

    it('extracts tv-linestyle to linestyle field (valid value)', () => {
        const raw = { 'tv-linestyle': pv('dashed') };
        const result = BuiltinPropertyExtractor.extract(raw, keys);
        expect(result.linestyle).toBe('dashed');
        expect(result.properties).toEqual({});
    });

    it('discards invalid tv-linestyle', () => {
        const raw = { 'tv-linestyle': pv('wavy') };
        const result = BuiltinPropertyExtractor.extract(raw, keys);
        expect(result.linestyle).toBeUndefined();
        expect(result.properties).toEqual({});
    });

    it('extracts tv-mask to mask field', () => {
        const raw = { 'tv-mask': pv('***') };
        const result = BuiltinPropertyExtractor.extract(raw, keys);
        expect(result.mask).toBe('***');
        expect(result.properties).toEqual({});
    });

    it('keeps non-builtin properties in properties', () => {
        const raw = {
            'custom-prop': pv('hello'),
            '金額': pv('2000', 'number'),
        };
        const result = BuiltinPropertyExtractor.extract(raw, keys);
        expect(result.color).toBeUndefined();
        expect(result.linestyle).toBeUndefined();
        expect(result.mask).toBeUndefined();
        expect(result.properties).toEqual({
            'custom-prop': pv('hello'),
            '金額': pv('2000', 'number'),
        });
    });

    it('separates builtin and custom properties together', () => {
        const raw = {
            'tv-color': pv('333333'),
            'tv-linestyle': pv('dotted'),
            'note': pv('something'),
            'priority': pv('1', 'number'),
        };
        const result = BuiltinPropertyExtractor.extract(raw, keys);
        expect(result.color).toBe('333333');
        expect(result.linestyle).toBe('dotted');
        expect(result.mask).toBeUndefined();
        expect(result.properties).toEqual({
            'note': pv('something'),
            'priority': pv('1', 'number'),
        });
    });

    it('trims whitespace from color value', () => {
        const raw = { 'tv-color': pv('  red  ') };
        const result = BuiltinPropertyExtractor.extract(raw, keys);
        expect(result.color).toBe('red');
    });

    it('normalizes linestyle to lowercase', () => {
        const raw = { 'tv-linestyle': pv('Dashed') };
        const result = BuiltinPropertyExtractor.extract(raw, keys);
        expect(result.linestyle).toBe('dashed');
    });

    it('ignores empty/whitespace-only color', () => {
        const raw = { 'tv-color': pv('   ') };
        const result = BuiltinPropertyExtractor.extract(raw, keys);
        expect(result.color).toBeUndefined();
    });

    it('strips # prefix from hex color', () => {
        const raw = { 'tv-color': pv('#ff0000') };
        const result = BuiltinPropertyExtractor.extract(raw, keys);
        expect(result.color).toBe('ff0000');
    });

    it('works with custom key names', () => {
        const customKeys = {
            ...keys,
            color: 'my-color',
            linestyle: 'my-style',
            mask: 'my-mask',
        };
        const raw = {
            'my-color': pv('blue'),
            'my-style': pv('solid'),
            'tv-color': pv('red'),  // should NOT be extracted with custom keys
        };
        const result = BuiltinPropertyExtractor.extract(raw, customKeys);
        expect(result.color).toBe('blue');
        expect(result.linestyle).toBe('solid');
        expect(result.properties).toEqual({ 'tv-color': pv('red') });
    });

    it('returns empty result for empty input', () => {
        const result = BuiltinPropertyExtractor.extract({}, keys);
        expect(result.color).toBeUndefined();
        expect(result.linestyle).toBeUndefined();
        expect(result.mask).toBeUndefined();
        expect(result.properties).toEqual({});
    });
});
