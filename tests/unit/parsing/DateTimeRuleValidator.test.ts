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

    describe('frontmatter-time-only rule', () => {
        it('returns warning when start has time but no date in frontmatter', () => {
            const result = validateDateTimeRules({
                startTime: '09:00',
                endDateImplicit: false,
                isFrontmatter: true,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('warning');
            expect(result!.rule).toBe('frontmatter-time-only');
        });

        it('returns warning when end has time but no date in frontmatter', () => {
            const result = validateDateTimeRules({
                startDate: '2026-01-10',
                startTime: '09:00',
                endTime: '17:00',
                endDateImplicit: false,
                isFrontmatter: true,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('warning');
            expect(result!.rule).toBe('frontmatter-time-only');
        });

        it('does not trigger for inline tasks', () => {
            const result = validateDateTimeRules({
                startTime: '09:00',
                endDateImplicit: false,
            });
            expect(result?.rule).not.toBe('frontmatter-time-only');
        });

        it('does not trigger when dates are present', () => {
            const result = validateDateTimeRules({
                startDate: '2026-01-10',
                startTime: '09:00',
                endDate: '2026-01-10',
                endTime: '17:00',
                endDateImplicit: false,
                isFrontmatter: true,
            });
            expect(result).toBeUndefined();
        });
    });
});
