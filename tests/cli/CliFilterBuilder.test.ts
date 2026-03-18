import { describe, it, expect } from 'vitest';
import { parseDateTimeFlag } from '../../src/cli/CliFilterBuilder';

describe('CliFilterBuilder', () => {
    describe('parseDateTimeFlag', () => {
        it('parses date only', () => {
            expect(parseDateTimeFlag('2026-03-14')).toEqual({ date: '2026-03-14' });
        });

        it('parses date with time (space separator)', () => {
            expect(parseDateTimeFlag('2026-03-14 10:00')).toEqual({ date: '2026-03-14', time: '10:00' });
        });

        it('parses date with time (T separator)', () => {
            expect(parseDateTimeFlag('2026-03-14T10:00')).toEqual({ date: '2026-03-14', time: '10:00' });
        });

        it('parses time only', () => {
            expect(parseDateTimeFlag('10:00')).toEqual({ date: '', time: '10:00' });
        });

        it('trims whitespace', () => {
            expect(parseDateTimeFlag('  2026-03-14  ')).toEqual({ date: '2026-03-14' });
        });

        it('returns null for invalid format', () => {
            expect(parseDateTimeFlag('invalid-date')).toBeNull();
            expect(parseDateTimeFlag('2026/03/14')).toBeNull();
            expect(parseDateTimeFlag('March 14')).toBeNull();
            expect(parseDateTimeFlag('')).toBeNull();
        });
    });
});
