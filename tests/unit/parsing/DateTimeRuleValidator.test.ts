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
});
