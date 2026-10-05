import { describe, it, expect } from 'vitest';
import { FilterSerializer } from '../../../src/services/filter/FilterSerializer';
import type { FilterCondition } from '../../../src/services/filter/FilterTypes';
import { evaluateFilter } from '../helpers/filterContext';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

const read = (condition: Record<string, unknown>) => FilterSerializer.parse({ logic: 'and', filters: [condition] });
const roundTrip = (condition: Record<string, unknown>) => FilterSerializer.toJSON(read(condition).state);
const reasonOf = (condition: Record<string, unknown>) => {
    const { state, issues } = read(condition);
    expect(state.filters).toEqual([]);
    expect(issues).toHaveLength(1);
    return issues[0].reason;
};

describe('FilterSerializer: date values', () => {
    it('reads and writes back a range, a date and a time, and a period row', () => {
        const rows = [
            { property: 'due', operator: 'equals', value: { from: '2026-10-01', to: '2026-10-10' } },
            { property: 'startDate', operator: 'before', value: '2026-10-04T10:00' },
            { property: 'period', operator: 'overlaps', value: { from: { preset: 'thisWeek' }, to: '2026-10-20T18:00' } },
            { property: 'period', operator: 'notWithin', value: { from: '2026-10-01' } },
            { property: 'period', operator: 'within', value: { preset: 'nextNDays', n: 3 } },
            { property: 'period', operator: 'overlaps' },
            { property: 'due', operator: 'equals', value: { from: '', to: '' } },
        ];
        for (const row of rows) {
            expect(read(row).issues, JSON.stringify(row)).toEqual([]);
            expect(roundTrip(row)).toEqual({ logic: 'and', filters: [row] });
        }
    });

    it('reads a date and a time with a space in the T form', () => {
        expect(roundTrip({ property: 'startDate', operator: 'after', value: '2026-10-04 9:40' }))
            .toEqual({ logic: 'and', filters: [{ property: 'startDate', operator: 'after', value: '2026-10-04T09:40' }] });
        expect(roundTrip({ property: 'period', operator: 'overlaps', value: { from: '2026-10-04 10:00' } }))
            .toEqual({ logic: 'and', filters: [{ property: 'period', operator: 'overlaps', value: { from: '2026-10-04T10:00' } }] });
    });

    it('refuses a range on an operator other than equals, an empty range, a reversed one and a range in a range', () => {
        expect(reasonOf({ property: 'due', operator: 'before', value: { from: '2026-10-01', to: '2026-10-10' } }))
            .toBe(`'due' takes a range only with equals`);
        expect(reasonOf({ property: 'period', operator: 'overlaps', value: {} })).toBe(`'period' range: give from, to or both`);
        expect(reasonOf({ property: 'due', operator: 'equals', value: { from: '2026-10-10', to: '2026-10-01' } }))
            .toBe(`'due' range: from 2026-10-10 is after to 2026-10-01`);
        expect(reasonOf({ property: 'period', operator: 'overlaps', value: { from: '2026-10-04T11:00', to: '2026-10-04T10:00' } }))
            .toBe(`'period' range: from 2026-10-04T11:00 is after to 2026-10-04T10:00`);
        expect(reasonOf({ property: 'period', operator: 'overlaps', value: { from: { from: '2026-10-01' } } }))
            .toBe(`'period' range: from is a range; an end is a date, a date and a time or a preset`);
    });

    it('refuses a value that is no date, and a period row on the parent', () => {
        expect(reasonOf({ property: 'startDate', operator: 'equals', value: '2026-10-04 25:00' })).toMatch(/^'startDate' takes a date that exists/);
        expect(reasonOf({ property: 'period', operator: 'overlaps', value: { from: '2026-02-30' } })).toMatch(/^'period' takes a date that exists/);
        expect(reasonOf({ property: 'period', operator: 'overlaps', value: { preset: 'today' }, target: 'parent' }))
            .toBe(`'period' asks about the task itself: it takes no target parent`);
    });
});

/**
 * The date conditions the Main vault's saved views hold (Templates/TaskViewer/Views):
 * read without a word, written back as they were, and answering as they did
 * before the range and the period came in (develop 1156faf8).
 */
describe('the saved shapes of the Main vault', () => {
    const shapes = [
        { property: 'startDate', operator: 'equals', value: { preset: 'today' } },
        { property: 'startDate', operator: 'equals', value: { preset: 'thisMonth' } },
        { property: 'due', operator: 'isSet' },
    ];
    const tasks: Record<string, Partial<Task>> = {
        today: { startDate: '2026-10-04' },
        lateNight: { startDate: '2026-10-05', startTime: '02:00' },
        lastMonth: { startDate: '2026-09-30', endDate: '2026-10-02' },
        dueOnly: { due: '2026-10-10' },
        nextMonth: { startDate: '2026-11-01', due: '2026-10-31' },
        noDate: {},
    };
    const ctx = { startHour: 5, weekStartDay: 1 as const, now: new Date(2026, 9, 4, 12, 0) };

    it('reads each without an issue and writes it back the same', () => {
        for (const shape of shapes) {
            expect(read(shape).issues).toEqual([]);
            expect(roundTrip(shape)).toEqual({ logic: 'and', filters: [shape] });
        }
    });

    it('answers the same for the same tasks', () => {
        const answers = shapes.map(shape => {
            const state = read(shape).state;
            return Object.fromEntries(Object.entries(tasks).map(([name, task]) =>
                [name, evaluateFilter(makeTask(task), state, ctx)]));
        });
        expect(answers).toEqual([
            { today: true, lateNight: true, lastMonth: false, dueOnly: false, nextMonth: false, noDate: false },
            { today: true, lateNight: true, lastMonth: false, dueOnly: true, nextMonth: false, noDate: false },
            { today: false, lateNight: false, lastMonth: false, dueOnly: true, nextMonth: true, noDate: false },
        ]);
    });
});
