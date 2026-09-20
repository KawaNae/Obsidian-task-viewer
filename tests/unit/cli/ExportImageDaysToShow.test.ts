import { describe, it, expect } from 'vitest';
import {
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
