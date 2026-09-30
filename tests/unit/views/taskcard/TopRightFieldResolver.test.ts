import { describe, it, expect } from 'vitest';
import { resolveTopRightField } from '../../../../src/views/taskcard/TopRightFieldResolver';
import type { DisplayTask, TaskViewerSettings } from '../../../../src/types';

const settings = {} as TaskViewerSettings;
const task = (fields: Partial<DisplayTask>) => ({ properties: {}, tags: [], ...fields }) as unknown as DisplayTask;

describe('resolveTopRightField: dates', () => {
    it('splits the due into its date and time', () => {
        const t = task({ due: '2026-03-15T09:30' });
        expect(resolveTopRightField(t, 'dueDate', settings)).toBe('2026-03-15');
        expect(resolveTopRightField(t, 'dueTime', settings)).toBe('09:30');
        expect(resolveTopRightField(task({ due: '2026-03-15' }), 'dueTime', settings)).toBeNull();
    });

    it('gives the weekday of a real day and none for a day that does not exist', () => {
        const sunday = resolveTopRightField(task({ effectiveStartDate: '2026-03-15' }), 'startWeekday', settings);
        const monday = resolveTopRightField(task({ effectiveStartDate: '2026-03-16' }), 'startWeekday', settings);
        expect(sunday).not.toBe(monday);
        expect(sunday).not.toBeNull();
        expect(resolveTopRightField(task({ effectiveStartDate: '2026-02-30' }), 'startWeekday', settings)).toBeNull();
    });
});
