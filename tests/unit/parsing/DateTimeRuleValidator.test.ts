import { describe, it, expect } from 'vitest';
import { validateDateTimeRules } from '../../../src/services/parsing/utils/DateTimeRuleValidator';

describe('DateTimeRuleValidator', () => {
    describe('severity classification', () => {
        it('end-before-start returns error severity', () => {
            const result = validateDateTimeRules({
                startDate: '2026-01-10',
                endDate: '2026-01-05',
                endDateImplicit: false,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('error');
            expect(result!.rule).toBe('end-before-start');
        });

        it('cross-midnight returns warning severity', () => {
            const result = validateDateTimeRules({
                startDate: '2026-01-10',
                startTime: '22:00',
                endTime: '06:00',
                endDateImplicit: true,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('warning');
            expect(result!.rule).toBe('cross-midnight');
        });

        it('same-day-inversion returns error severity', () => {
            const result = validateDateTimeRules({
                startDate: '2026-01-10',
                startTime: '14:00',
                endDate: '2026-01-10',
                endTime: '10:00',
                endDateImplicit: false,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('error');
            expect(result!.rule).toBe('same-day-inversion');
        });

        it('end-time-without-start returns error severity', () => {
            const result = validateDateTimeRules({
                endTime: '10:00',
                endDateImplicit: false,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('error');
            expect(result!.rule).toBe('end-time-without-start');
        });

        it('due-without-date returns error severity', () => {
            const result = validateDateTimeRules({
                due: '14:00',
                endDateImplicit: false,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('error');
            expect(result!.rule).toBe('due-without-date');
        });
    });

    describe("rule 4's hint writes the line's date and end time with a start time", () => {
        it('@D>DT02:00: the same day before 02:00, or the next day', () => {
            const r = validateDateTimeRules({ startDate: '2026-10-04', endDate: '2026-10-04', endTime: '02:00', endDateImplicit: false });
            expect(r!.rule).toBe('end-time-without-start');
            expect(r!.hint).toContain('`@2026-10-04T01:00>02:00`');
            expect(r!.hint).toContain('`@2026-10-04T09:00>2026-10-05T02:00`');
        });

        it('@D>ET10:00: the end date the line writes', () => {
            const r = validateDateTimeRules({ startDate: '2026-10-04', endDate: '2026-10-06', endTime: '10:00', endDateImplicit: false });
            expect(r!.hint).toContain('`@2026-10-04T09:00>10:00`');
            expect(r!.hint).toContain('`@2026-10-04T09:00>2026-10-06T10:00`');
        });

        it('@>ET17:00: the end date as the start date', () => {
            const r = validateDateTimeRules({ endDate: '2026-10-04', endTime: '17:00', endDateImplicit: false });
            expect(r!.hint).toContain('`@2026-10-04T09:00>17:00`');
            expect(r!.hint).toContain('`@2026-10-04T09:00>2026-10-05T17:00`');
        });

        it('with no date, the bare request', () => {
            const r = validateDateTimeRules({ endTime: '10:00', endDateImplicit: false });
            expect(r!.hint).not.toContain('`@');
        });
    });
});
