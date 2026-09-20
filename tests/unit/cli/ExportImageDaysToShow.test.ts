import { describe, it, expect } from 'vitest';
import {
    computeRenderedRange,
    parseDaysToShow,
    validateDaysToShow,
} from '../../../src/cli/handlers/ExportImageHandler';
import { schemaFor } from '../../../src/services/viewConfig';
import { VIEW_META_TIMELINE, VIEW_META_CALENDAR } from '../../../src/constants/viewRegistry';

const TIMELINE_TYPE = VIEW_META_TIMELINE.type;
const CALENDAR_TYPE = VIEW_META_CALENDAR.type;

function errorMessage(result: string | null): string {
    expect(result).not.toBe(null);
    return (JSON.parse(result!) as { error: string }).error;
}

describe('parseDaysToShow', () => {
    const schema = schemaFor(TIMELINE_TYPE);

    it('parses an in-range integer string', () => {
        expect(parseDaysToShow(schema, '10')).toBe(10);
        expect(parseDaysToShow(schema, '1')).toBe(1);
        expect(parseDaysToShow(schema, '30')).toBe(30);
    });

    it('rejects out-of-range values', () => {
        expect(parseDaysToShow(schema, '0')).toBeUndefined();
        expect(parseDaysToShow(schema, '31')).toBeUndefined();
    });

    it('rejects non-integer input', () => {
        expect(parseDaysToShow(schema, '5.5')).toBeUndefined();
        expect(parseDaysToShow(schema, 'abc')).toBeUndefined();
    });

    it('returns undefined when raw is undefined', () => {
        expect(parseDaysToShow(schema, undefined)).toBeUndefined();
    });
});

describe('validateDaysToShow', () => {
    it('passes when days-to-show is absent', () => {
        expect(validateDaysToShow({}, TIMELINE_TYPE)).toBe(null);
    });

    it('passes for an in-range integer', () => {
        expect(validateDaysToShow({ 'days-to-show': '5' }, TIMELINE_TYPE)).toBe(null);
        expect(validateDaysToShow({ 'days-to-show': '30' }, TIMELINE_TYPE)).toBe(null);
    });

    it('errors on a value above the max', () => {
        const err = errorMessage(validateDaysToShow({ 'days-to-show': '31' }, TIMELINE_TYPE));
        expect(err).toMatch(/Invalid days-to-show: '31'/);
        expect(err).toMatch(/between 1 and 30/);
    });

    it('errors on a value below the min', () => {
        const err = errorMessage(validateDaysToShow({ 'days-to-show': '0' }, TIMELINE_TYPE));
        expect(err).toMatch(/Invalid days-to-show: '0'/);
    });

    it('errors on a non-integer value', () => {
        const err = errorMessage(validateDaysToShow({ 'days-to-show': '5.5' }, TIMELINE_TYPE));
        expect(err).toMatch(/Invalid days-to-show: '5.5'/);
    });

    it('does not check days-to-show for a view that has no such field', () => {
        expect(validateDaysToShow({ 'days-to-show': '999' }, CALENDAR_TYPE)).toBe(null);
    });
});

describe('computeRenderedRange (timeline)', () => {
    it('computes the range from an explicit in-range days-to-show', () => {
        const range = computeRenderedRange(TIMELINE_TYPE, '2026-01-01', { 'days-to-show': '5' });
        expect(range).toEqual({ anchor: '2026-01-01', from: '2026-01-01', to: '2026-01-05' });
    });

    it('falls back to the schema default when days-to-show is absent', () => {
        const range = computeRenderedRange(TIMELINE_TYPE, '2026-01-01', {});
        // Schema default is 3 days: anchor + 2.
        expect(range).toEqual({ anchor: '2026-01-01', from: '2026-01-01', to: '2026-01-03' });
    });

    it('reads the exact same value the render path would (regression: no separate raw-parseInt path)', () => {
        // Before the fix, this function used a raw parseInt with no bounds, so
        // it could compute a range for a days-to-show value the schema would
        // reject when actually applying config (falling back to the default).
        // Feeding an out-of-range value here must now match what
        // parseDaysToShow reports as unparseable, not silently accept it.
        const schema = schemaFor(TIMELINE_TYPE);
        expect(parseDaysToShow(schema, '999')).toBeUndefined();
        const range = computeRenderedRange(TIMELINE_TYPE, '2026-01-01', { 'days-to-show': '999' });
        // Falls back to the default (3), it does not compute a 999-day range.
        expect(range).toEqual({ anchor: '2026-01-01', from: '2026-01-01', to: '2026-01-03' });
    });
});
