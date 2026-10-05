import { describe, it, expect } from 'vitest';
import { readExportOptions } from '../../../src/cli/handlers/ExportImageHandler';

/**
 * export-image's own number flags, `width` and `wait`, are read as the view's
 * are (`IntInput`): a whole decimal number in range, or the command fails. A
 * value that is not one used to reach the export as NaN (the input decision
 * F, 2026-10-01).
 */

function errorOf(result: ReturnType<typeof readExportOptions>): string {
    expect(typeof result).toBe('string');
    return (JSON.parse(result as string) as { error: string }).error;
}

describe('readExportOptions', () => {
    it('reads width and wait as whole numbers', () => {
        expect(readExportOptions({ width: '800', wait: '0' })).toMatchObject({ width: 800, waitMs: 0 });
    });

    it('leaves either absent when its flag is', () => {
        const opts = readExportOptions({});
        expect(opts).toMatchObject({ width: undefined, waitMs: undefined });
    });

    it('reads them as typed: space around them and full-width digits', () => {
        expect(readExportOptions({ width: ' 800 ', wait: '５００' })).toMatchObject({ width: 800, waitMs: 500 });
    });

    it.each(['abc', '1.5', '800px', '0x10', '1e3'])('refuses width=%j as not a whole number', (raw) => {
        expect(errorOf(readExportOptions({ width: raw }))).toBe(`width must be a whole number, got: ${JSON.stringify(raw)}`);
    });

    it.each(['0', '-5'])('refuses width=%j as out of range', (raw) => {
        expect(errorOf(readExportOptions({ width: raw }))).toBe(`width must be at least 1, got: ${JSON.stringify(raw)}`);
    });

    it('refuses an empty width', () => {
        expect(errorOf(readExportOptions({ width: '' }))).toBe('width must not be empty, got: ""');
    });

    it.each(['abc', '1.5', '3s'])('refuses wait=%j as not a whole number', (raw) => {
        expect(errorOf(readExportOptions({ wait: raw }))).toBe(`wait must be a whole number, got: ${JSON.stringify(raw)}`);
    });

    it('refuses a negative wait', () => {
        expect(errorOf(readExportOptions({ wait: '-1' }))).toBe('wait must be at least 0, got: "-1"');
    });

    it('carries the other flags as they were', () => {
        expect(readExportOptions({
            'output-folder': 'out', filename: 'a.png', template: 'T', 'keep-open': 'true',
        })).toMatchObject({ folder: 'out', filename: 'a.png', name: 'T', keepOpen: true });
    });
});
