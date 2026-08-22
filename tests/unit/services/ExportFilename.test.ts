import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildExportFilename, sanitizeExportLabel } from '../../../src/services/export/ExportFilename';

const LOCAL_DAY = '2026-08-22';

/**
 * An instant on local 2026-08-22 whose UTC day is a different date, or null
 * when the runner sits at UTC and no such instant exists. Written this way
 * so the divergence is real wherever the suite runs instead of depending on
 * the machine's zone: east of UTC the small hours fall on the previous UTC
 * day, west of it the late evening falls on the next one.
 */
function instantWhereUtcDayDiffers(): Date | null {
    for (const at of [new Date(2026, 7, 22, 0, 30), new Date(2026, 7, 22, 23, 30)]) {
        if (at.toISOString().slice(0, 10) !== LOCAL_DAY) return at;
    }
    return null;
}

describe('buildExportFilename', () => {
    afterEach(() => vi.useRealTimers());

    const diverging = instantWhereUtcDayDiffers();

    // The two call sites stamped the name with `toISOString().slice(0, 10)`,
    // so an export made at 02:00 JST was named with yesterday's date.
    it.skipIf(diverging === null)('stamps the local calendar day, not the UTC one', () => {
        vi.useFakeTimers();
        vi.setSystemTime(diverging!);
        expect(diverging!.toISOString().slice(0, 10)).not.toBe(LOCAL_DAY); // the old behaviour
        expect(buildExportFilename('timeline')).toBe(`timeline_${LOCAL_DAY}.png`);
    });

    it('stamps the day when local and UTC agree', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 7, 22, 12, 0));
        expect(buildExportFilename('timeline')).toBe(`timeline_${LOCAL_DAY}.png`);
    });

    it.each([...String.raw`\/:*?"<>|`])('replaces %s, which a vault path cannot carry', (ch) => {
        expect(sanitizeExportLabel(`a${ch}b`)).toBe('a_b');
    });

    it('leaves the rest of the label alone', () => {
        expect(sanitizeExportLabel('週次レビュー (work) #1')).toBe('週次レビュー (work) #1');
    });

    // The toolbar's custom-name path did no sanitizing at all before the two
    // sites shared this function.
    it('sanitizes the label it stamps', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 7, 22, 12, 0));
        expect(buildExportFilename('work/2026')).toBe(`work_2026_${LOCAL_DAY}.png`);
    });
});
