import { describe, it, expect } from 'vitest';
import { NotationUtils } from '../../src/views/taskcard/NotationUtils';
import type { Task } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'at-notation:note.md:ln:1',
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
        parserId: 'at-notation',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotationUtils.buildNotationLabel', () => {
    it('returns null when no startDate and no startTime', () => {
        expect(NotationUtils.buildNotationLabel(makeTask())).toBeNull();
    });

    it('builds date-only label', () => {
        const task = makeTask({ startDate: '2026-03-11' });
        expect(NotationUtils.buildNotationLabel(task)).toBe('@2026-03-11');
    });

    it('builds date+time label', () => {
        const task = makeTask({ startDate: '2026-03-11', startTime: '09:00' });
        expect(NotationUtils.buildNotationLabel(task)).toBe('@2026-03-11T09:00');
    });

    it('builds time-only label', () => {
        const task = makeTask({ startTime: '14:00' });
        expect(NotationUtils.buildNotationLabel(task)).toBe('@14:00');
    });

    it('includes end portion', () => {
        const task = makeTask({
            startDate: '2026-03-11',
            startTime: '09:00',
            endDate: '2026-03-11',
            endTime: '17:00',
        });
        expect(NotationUtils.buildNotationLabel(task)).toBe('@2026-03-11T09:00>2026-03-11T17:00');
    });

    it('includes end time only', () => {
        const task = makeTask({
            startDate: '2026-03-11',
            startTime: '09:00',
            endTime: '10:00',
        });
        expect(NotationUtils.buildNotationLabel(task)).toBe('@2026-03-11T09:00>10:00');
    });
});

describe('NotationUtils.formatChildNotation', () => {
    it('time-only with parent startDate → uses parent date', () => {
        expect(NotationUtils.formatChildNotation('@T10:00', '2026-03-11')).toBe('@2026-03-11…');
    });

    it('time-only without parent → returns original', () => {
        expect(NotationUtils.formatChildNotation('@T10:00', undefined)).toBe('@T10:00');
    });

    it('date-only → returns as-is with trailing space', () => {
        expect(NotationUtils.formatChildNotation('@2026-03-11', undefined)).toBe('@2026-03-11 ');
    });

    it('date with extra info → truncates with …', () => {
        expect(NotationUtils.formatChildNotation('@2026-03-11T09:00', undefined)).toBe('@2026-03-11…');
    });
});
