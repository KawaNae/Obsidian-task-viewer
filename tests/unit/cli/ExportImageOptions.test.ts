import { describe, it, expect } from 'vitest';
import { readExportOptions } from '../../../src/cli/handlers/ExportImageHandler';

/**
 * export-image's own number flags, `width` and `wait`, are read as the view's
 * are (`F.int`): a whole decimal number in range, or the command fails. A
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

    it.each(['', 'abc', '0', '-5', '1.5', '800px', '0x10', '1e3'])('refuses width=%j', (raw) => {
        expect(errorOf(readExportOptions({ width: raw }))).toBe(`Invalid width: '${raw}'. Must be an integer of at least 1`);
    });

    it.each(['', 'abc', '-1', '1.5', '3s'])('refuses wait=%j', (raw) => {
        expect(errorOf(readExportOptions({ wait: raw }))).toBe(`Invalid wait: '${raw}'. Must be an integer of at least 0`);
    });

    it('carries the other flags as they were', () => {
        expect(readExportOptions({
            'output-folder': 'out', filename: 'a.png', template: 'T', 'keep-open': 'true',
        })).toMatchObject({ folder: 'out', filename: 'a.png', name: 'T', keepOpen: true });
    });
});
