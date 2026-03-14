import { describe, it, expect } from 'vitest';
import { buildFilterFromFlags, parseDateTimeFlag } from '../../src/cli/CliFilterBuilder';
import type { FilterConditionNode } from '../../src/services/filter/FilterTypes';

describe('CliFilterBuilder', () => {
    describe('buildFilterFromFlags', () => {
        it('returns null when no filter flags present', () => {
            expect(buildFilterFromFlags({})).toBeNull();
            expect(buildFilterFromFlags({ limit: '50' })).toBeNull();
        });

        it('builds file filter', () => {
            const state = buildFilterFromFlags({ file: 'daily/2026-03-14.md' });
            expect(state).not.toBeNull();
            const conditions = state!.root.children as FilterConditionNode[];
            expect(conditions).toHaveLength(1);
            expect(conditions[0].property).toBe('file');
            expect(conditions[0].operator).toBe('includes');
            expect(conditions[0].value).toEqual({ type: 'stringSet', values: ['daily/2026-03-14.md'] });
        });

        it('builds status filter with comma-separated values', () => {
            const state = buildFilterFromFlags({ status: 'x, /' });
            const conditions = state!.root.children as FilterConditionNode[];
            expect(conditions).toHaveLength(1);
            expect(conditions[0].property).toBe('status');
            expect(conditions[0].value).toEqual({ type: 'stringSet', values: ['x', '/'] });
        });

        it('builds tag filter', () => {
            const state = buildFilterFromFlags({ tag: '#work,#urgent' });
            const conditions = state!.root.children as FilterConditionNode[];
            expect(conditions).toHaveLength(1);
            expect(conditions[0].property).toBe('tag');
            expect(conditions[0].value).toEqual({ type: 'stringSet', values: ['#work', '#urgent'] });
        });

        it('builds date filter with two conditions (start <= date AND end >= date)', () => {
            const state = buildFilterFromFlags({ date: '2026-03-14' });
            const conditions = state!.root.children as FilterConditionNode[];
            expect(conditions).toHaveLength(2);
            expect(conditions[0].property).toBe('startDate');
            expect(conditions[0].operator).toBe('onOrBefore');
            expect(conditions[1].property).toBe('endDate');
            expect(conditions[1].operator).toBe('onOrAfter');
        });

        it('combines multiple flags with AND logic', () => {
            const state = buildFilterFromFlags({ file: 'daily/', status: 'x', tag: '#work' });
            expect(state!.root.logic).toBe('and');
            expect(state!.root.children).toHaveLength(3);
        });
    });

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
    });
});
