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

        it('rejects out-of-range dates on every parse surface (unified with @notation)', () => {
            expect(parseDateTimeField('2026-13-01').date).toBeUndefined();
            expect(parseDateTimeField('2026-00-15').date).toBeUndefined();
            expect(parseDateTimeField('2026-12-32').date).toBeUndefined();
            expect(parseDateTimeField('2026-12-31').date).toBe('2026-12-31');
        });

        it('rejects out-of-range times', () => {
            expect(parseDateTimeField('99:99').time).toBeUndefined();
            expect(parseDateTimeField('24:00').time).toBeUndefined();
            expect(parseDateTimeField('23:59').time).toBe('23:59');
            expect(parseDateTimeField('00:00').time).toBe('00:00');
        });

        it('keeps the valid component when the other is invalid', () => {
            expect(parseDateTimeField('2026-13-01T14:30')).toEqual({ date: undefined, time: '14:30' });
            expect(parseDateTimeField('2026-07-15T99:99')).toEqual({ date: '2026-07-15', time: undefined });
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
