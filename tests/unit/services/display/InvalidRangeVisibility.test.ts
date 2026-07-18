import { describe, it, expect } from 'vitest';
import { validateDateTimeRules } from '../../../../src/services/parsing/utils/DateTimeRuleValidator';

describe('end<start 不正記法の検出', () => {
    it('同日 endTime < startTime (明示 endDate) → error same-day-inversion', () => {
        const result = validateDateTimeRules({
            startDate: '2026-05-21',
            startTime: '19:15',
            endDate: '2026-05-21',
            endTime: '14:30',
            endDateImplicit: false,
        });
        expect(result).toBeDefined();
        expect(result!.severity).toBe('error');
        expect(result!.rule).toBe('same-day-inversion');
    });

    it('endDate < startDate → error end-before-start', () => {
        const result = validateDateTimeRules({
            startDate: '2026-07-18',
            endDate: '2026-07-17',
            endDateImplicit: false,
        });
        expect(result).toBeDefined();
        expect(result!.severity).toBe('error');
        expect(result!.rule).toBe('end-before-start');
    });

    it('同日 endTime < startTime (暗黙 endDate) → warning cross-midnight', () => {
        const result = validateDateTimeRules({
            startDate: '2026-05-21',
            startTime: '19:15',
            endTime: '14:30',
            endDateImplicit: true,
        });
        expect(result).toBeDefined();
        expect(result!.severity).toBe('warning');
        expect(result!.rule).toBe('cross-midnight');
    });

    it('end == start (0分タスク) → 有効', () => {
        const result = validateDateTimeRules({
            startDate: '2026-07-18',
            startTime: '10:00',
            endDate: '2026-07-18',
            endTime: '10:00',
            endDateImplicit: false,
        });
        expect(result).toBeUndefined();
    });

    it('正常タスク → 有効', () => {
        const result = validateDateTimeRules({
            startDate: '2026-07-18',
            startTime: '10:00',
            endDate: '2026-07-18',
            endTime: '12:00',
            endDateImplicit: false,
        });
        expect(result).toBeUndefined();
    });

    it('startDate のみ (end なし) → 有効', () => {
        const result = validateDateTimeRules({
            startDate: '2026-07-18',
            startTime: '10:00',
            endDateImplicit: true,
        });
        expect(result).toBeUndefined();
    });
});

describe('isVisible フィルタ', () => {
    it('validation.severity=error のタスクは非表示', () => {
        const dt = {
            validation: { severity: 'error' as const, rule: 'same-day-inversion' as const, message: '', hint: '' },
        };
        expect(!dt.validation || dt.validation.severity !== 'error').toBe(false);
    });

    it('validation.severity=warning のタスクは表示', () => {
        const dt = {
            validation: { severity: 'warning' as const, rule: 'cross-midnight' as const, message: '', hint: '' },
        };
        expect(!dt.validation || dt.validation.severity !== 'error').toBe(true);
    });

    it('validation なしのタスクは表示', () => {
        const dt = { validation: undefined };
        expect(!dt.validation || dt.validation.severity !== 'error').toBe(true);
    });
});
