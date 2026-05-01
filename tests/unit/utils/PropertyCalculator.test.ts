import { describe, it, expect } from 'vitest';
import { PropertyCalculator } from '../../../src/interaction/menu/PropertyCalculator';
import type { DisplayTask } from '../../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDT(overrides: Partial<DisplayTask> = {}): DisplayTask {
    return {
        id: 'tv-inline:note.md:ln:1',
        file: 'note.md',
        line: 0,
        content: 'Test',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        originalText: '',
        tags: [],
        parserId: 'tv-inline',
        effectiveStartDate: '2026-03-11',
        startDateImplicit: false,
        startTimeImplicit: false,
        endDateImplicit: false,
        endTimeImplicit: false,
        originalTaskId: 'tv-inline:note.md:ln:1',
        isSplit: false,
        ...overrides,
    };
}

const calc = new PropertyCalculator();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PropertyCalculator', () => {

    describe('calculateStart', () => {
        it('returns date and time for normal task', () => {
            const dt = makeDT({ effectiveStartDate: '2026-03-11', effectiveStartTime: '09:00' });
            const result = calc.calculateStart({ task: dt, startHour: 0, viewStartDate: null });
            expect(result.date).toBe('2026-03-11');
            expect(result.time).toBe('09:00');
            expect(result.isUnset).toBeUndefined();
        });

        it('returns isUnset for D-type (empty effectiveStartDate)', () => {
            const dt = makeDT({ effectiveStartDate: '' });
            const result = calc.calculateStart({ task: dt, startHour: 0, viewStartDate: null });
            expect(result.isUnset).toBe(true);
        });

        it('reflects implicit flags', () => {
            const dt = makeDT({ startDateImplicit: true, startTimeImplicit: true });
            const result = calc.calculateStart({ task: dt, startHour: 0, viewStartDate: null });
            expect(result.dateImplicit).toBe(true);
            expect(result.timeImplicit).toBe(true);
        });
    });

    describe('calculateEnd', () => {
        it('returns date and time when present', () => {
            const dt = makeDT({ effectiveEndDate: '2026-03-11', effectiveEndTime: '17:00' });
            const result = calc.calculateEnd({ task: dt, startHour: 0, viewStartDate: null });
            expect(result.date).toBe('2026-03-11');
            expect(result.time).toBe('17:00');
        });

        it('returns isUnset when no effectiveEndDate', () => {
            const dt = makeDT({ effectiveEndDate: undefined });
            const result = calc.calculateEnd({ task: dt, startHour: 0, viewStartDate: null });
            expect(result.isUnset).toBe(true);
        });
    });

    describe('calculateDue', () => {
        it('returns date-only due', () => {
            const dt = makeDT({ due: '2026-03-20' });
            const result = calc.calculateDue(dt);
            expect(result.date).toBe('2026-03-20');
            expect(result.time).toBeUndefined();
        });

        it('splits datetime due', () => {
            const dt = makeDT({ due: '2026-03-20T15:00' });
            const result = calc.calculateDue(dt);
            expect(result.date).toBe('2026-03-20');
            expect(result.time).toBe('15:00');
        });

        it('returns isUnset when no due', () => {
            const dt = makeDT({ due: undefined });
            const result = calc.calculateDue(dt);
            expect(result.isUnset).toBe(true);
        });
    });
});
