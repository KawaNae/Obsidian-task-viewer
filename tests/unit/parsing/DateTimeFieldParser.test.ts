import { describe, it, expect } from 'vitest';
import { normalizeYamlDate, parseDateTimeField } from '../../../src/services/parsing/utils/DateTimeFieldParser';

describe('DateTimeFieldParser', () => {
    describe('parseDateTimeField', () => {
        it('extracts date and time fragments', () => {
            expect(parseDateTimeField('2026-07-15T14:30')).toEqual({ date: '2026-07-15', time: '14:30' });
            expect(parseDateTimeField('2026-07-15')).toEqual({ date: '2026-07-15', time: undefined });
            expect(parseDateTimeField('14:30')).toEqual({ date: undefined, time: '14:30' });
            expect(parseDateTimeField(null)).toEqual({});
        });

        // A fragment of a date's or a time's shape that names none is not
        // read, and neither is the rest of the value: the same predicate the
        // input fields read with (`DateUtils.readDate`).
        it('reads no value naming a day that does not exist', () => {
            for (const text of ['2026-13-01', '2026-00-15', '2026-12-32', '2026-02-30', '2025-02-29', '2026-04-31']) {
                expect(parseDateTimeField(text), text).toBeNull();
            }
            expect(parseDateTimeField('2026-12-31')).toEqual({ date: '2026-12-31', time: undefined });
            expect(parseDateTimeField('2028-02-29')).toEqual({ date: '2028-02-29', time: undefined });
        });

        it('reads no value naming a time that does not exist', () => {
            expect(parseDateTimeField('99:99')).toBeNull();
            expect(parseDateTimeField('24:00')).toBeNull();
            expect(parseDateTimeField('23:59')).toEqual({ date: undefined, time: '23:59' });
            expect(parseDateTimeField('00:00')).toEqual({ date: undefined, time: '00:00' });
        });

        it('reads neither part when one of them does not read', () => {
            expect(parseDateTimeField('2026-13-01T14:30')).toBeNull();
            expect(parseDateTimeField('2026-02-30T14:30')).toBeNull();
            expect(parseDateTimeField('2026-07-15T99:99')).toBeNull();
        });
    });

    describe('normalizeYamlDate', () => {
        it('formats Date objects', () => {
            expect(normalizeYamlDate(new Date(2026, 6, 15))).toBe('2026-07-15');
            expect(normalizeYamlDate(new Date(2026, 6, 15, 9, 5))).toBe('2026-07-15T09:05');
        });

        it('converts sexagesimal minutes to HH:MM', () => {
            expect(normalizeYamlDate(570)).toBe('09:30');
            expect(normalizeYamlDate(1440)).toBeNull();
        });

        it('trims strings and nullifies empties', () => {
            expect(normalizeYamlDate('  2026-07-15 ')).toBe('2026-07-15');
            expect(normalizeYamlDate('')).toBeNull();
            expect(normalizeYamlDate(null)).toBeNull();
        });
    });
});
