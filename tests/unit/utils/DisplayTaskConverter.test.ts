import { describe, it, expect } from 'vitest';
import { toDisplayTask, shouldSplitDisplayTask, toDisplayTaskWithSplit } from '../../../src/services/display/DisplayTaskConverter';
import type { Task } from '../../../src/types';

/** Build a minimal Task for testing. */
function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'at-notation:test.md:ln:1',
        file: 'test.md',
        line: 0,
        content: 'test task',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        tags: [],
        originalText: '- [ ] test task @2026-01-15',
        parserId: 'at-notation',
        ...overrides,
    };
}

const startHour = 5; // default 5:00

describe('toDisplayTask', () => {
    it('resolves S-type (date only) to all-day', () => {
        const task = makeTask({ startDate: '2026-01-15' });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveStartDate).toBe('2026-01-15');
        expect(dt.effectiveStartTime).toBe('05:00');
        expect(dt.effectiveEndDate).toBe('2026-01-16');
        expect(dt.effectiveEndTime).toBe('04:59');
        expect(dt.startDateImplicit).toBe(false);
        expect(dt.startTimeImplicit).toBe(true);
        expect(dt.endDateImplicit).toBe(true);
        expect(dt.endTimeImplicit).toBe(true);
    });

    it('resolves S-Timed (date + time) with 1h default duration', () => {
        const task = makeTask({ startDate: '2026-01-15', startTime: '09:00' });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveStartDate).toBe('2026-01-15');
        expect(dt.effectiveStartTime).toBe('09:00');
        expect(dt.effectiveEndDate).toBe('2026-01-15');
        expect(dt.effectiveEndTime).toBe('10:00');
        expect(dt.startTimeImplicit).toBe(false);
        expect(dt.endDateImplicit).toBe(true);
        expect(dt.endTimeImplicit).toBe(true);
    });

    it('resolves SE-Timed (full range)', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '09:00',
            endDate: '2026-01-15',
            endTime: '17:00',
        });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveStartTime).toBe('09:00');
        expect(dt.effectiveEndDate).toBe('2026-01-15');
        expect(dt.effectiveEndTime).toBe('17:00');
        expect(dt.startDateImplicit).toBe(false);
        expect(dt.startTimeImplicit).toBe(false);
        expect(dt.endDateImplicit).toBe(false);
        expect(dt.endTimeImplicit).toBe(false);
    });

    it('resolves E-Timed (endDate + endTime, no start) — 1h before end', () => {
        const task = makeTask({
            endDate: '2026-01-15',
            endTime: '10:00',
        });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveStartDate).toBe('2026-01-15');
        expect(dt.effectiveStartTime).toBe('09:00');
        expect(dt.effectiveEndDate).toBe('2026-01-15');
        expect(dt.effectiveEndTime).toBe('10:00');
        expect(dt.startDateImplicit).toBe(true);
        expect(dt.startTimeImplicit).toBe(true);
    });

    it('resolves E-AllDay (endDate only)', () => {
        const task = makeTask({ endDate: '2026-01-15' });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveEndTime).toBe('04:59');
        expect(dt.startDateImplicit).toBe(true);
    });

    it('resolves S with endTime (same-day end)', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '09:00',
            endTime: '12:00',
        });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveEndDate).toBe('2026-01-15');
        expect(dt.effectiveEndTime).toBe('12:00');
        expect(dt.endDateImplicit).toBe(true);
        expect(dt.endTimeImplicit).toBe(false);
    });

    it('resolves SE with endDate no endTime', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            endDate: '2026-01-17',
        });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveEndDate).toBe('2026-01-17');
        expect(dt.effectiveEndTime).toBe('04:59');
        expect(dt.endTimeImplicit).toBe(true);
    });

    it('sets isSplit false and originalTaskId', () => {
        const task = makeTask({ startDate: '2026-01-15' });
        const dt = toDisplayTask(task, startHour);
        expect(dt.isSplit).toBe(false);
        expect(dt.originalTaskId).toBe(task.id);
    });

    it('handles inherited startDate', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startDateInherited: true,
        });
        const dt = toDisplayTask(task, startHour);
        expect(dt.startDateImplicit).toBe(true);
    });
});

describe('shouldSplitDisplayTask', () => {
    it('returns false for same visual day task', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '09:00',
            endDate: '2026-01-15',
            endTime: '17:00',
        });
        const dt = toDisplayTask(task, startHour);
        expect(shouldSplitDisplayTask(dt, startHour)).toBe(false);
    });

    it('returns true for cross-day task', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '22:00',
            endDate: '2026-01-16',
            endTime: '08:00',
        });
        const dt = toDisplayTask(task, startHour);
        expect(shouldSplitDisplayTask(dt, startHour)).toBe(true);
    });

    it('returns false when no effective end', () => {
        const task = makeTask({ startDate: '2026-01-15' });
        // toDisplayTask resolves implicit end, so build a minimal DisplayTask
        const dt = toDisplayTask(task, startHour);
        // S-AllDay resolved end is next day — should split
        // Actually S-AllDay 05:00→next-day 04:59 crosses boundary
        expect(shouldSplitDisplayTask(dt, startHour)).toBe(false);
    });
});

describe('toDisplayTaskWithSplit', () => {
    it('returns 1 element for non-split task', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '09:00',
            endDate: '2026-01-15',
            endTime: '17:00',
        });
        const result = toDisplayTaskWithSplit(task, startHour);
        expect(result).toHaveLength(1);
        expect(result[0].isSplit).toBe(false);
    });

    it('returns 2 elements for cross-day task', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '22:00',
            endDate: '2026-01-16',
            endTime: '08:00',
        });
        const result = toDisplayTaskWithSplit(task, startHour);
        expect(result).toHaveLength(2);
        expect(result[0].splitContinuesAfter).toBe(true);
        expect(result[0].splitContinuesBefore).toBe(false);
        expect(result[1].splitContinuesBefore).toBe(true);
        expect(result[1].splitContinuesAfter).toBe(false);
    });
});
