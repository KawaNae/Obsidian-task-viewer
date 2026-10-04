import { describe, it, expect } from 'vitest';
import { evaluateFilter } from '../helpers/filterContext';
import { makeTask } from '../helpers/makeTask';
import { compileFilter, ALWAYS } from '../../../src/services/filter/FilterExpr';
import type { Task } from '../../../src/types';
import type { FilterCondition, PeriodRelation } from '../../../src/services/filter/FilterTypes';

/** startHour 5, the week on Monday, now Sunday 2026-10-04 12:00: this week is 09/28 to 10/04. */
const ctx = { startHour: 5, weekStartDay: 1 as const, now: new Date(2026, 9, 4, 12, 0) };
const matches = (task: Partial<Task>, condition: FilterCondition) =>
    evaluateFilter(makeTask(task), { filters: [condition], logic: 'and' }, ctx);
const thisWeek = (operator: PeriodRelation): FilterCondition => ({ property: 'period', operator, value: { preset: 'thisWeek' } });

const tasks = {
    inside: { startDate: '2026-09-30' },
    across: { startDate: '2026-10-03', endDate: '2026-10-06' },
    outside: { startDate: '2026-10-10' },
    noDate: {},
    dueOnly: { due: '2026-10-02' },
};

describe('the period condition (this week)', () => {
    const answers = (operator: PeriodRelation) =>
        Object.fromEntries(Object.entries(tasks).map(([name, task]) => [name, matches(task, thisWeek(operator))]));

    it('overlaps: the span shares time with the week; a due-only task by the span read from its due', () => {
        expect(answers('overlaps')).toEqual({ inside: true, across: true, outside: false, noDate: false, dueOnly: true });
    });

    it('within: the whole span is in the week', () => {
        expect(answers('within')).toEqual({ inside: true, across: false, outside: false, noDate: false, dueOnly: true });
    });

    it('the negations leave out a task with no span', () => {
        expect(answers('notOverlaps')).toEqual({ inside: false, across: false, outside: true, noDate: false, dueOnly: false });
        expect(answers('notWithin')).toEqual({ inside: false, across: true, outside: true, noDate: false, dueOnly: false });
    });

    it('a task with a span and a due is decided by its span only', () => {
        const task = { startDate: '2026-10-10', due: '2026-10-02' };
        expect(matches(task, thisWeek('overlaps'))).toBe(false);
        expect(matches(task, thisWeek('notOverlaps'))).toBe(true);
    });

    it('a moment: overlapped by the span it falls in, from its start up to its end', () => {
        const at10 = (operator: PeriodRelation): FilterCondition => ({ property: 'period', operator, value: '2026-10-04T10:00' });
        expect(matches({ startDate: '2026-10-04', startTime: '10:00', endTime: '11:00' }, at10('overlaps'))).toBe(true);
        expect(matches({ startDate: '2026-10-04', startTime: '10:00', endTime: '10:00' }, at10('overlaps'))).toBe(true);
        expect(matches({ startDate: '2026-10-04', startTime: '09:00', endTime: '10:00' }, at10('overlaps'))).toBe(false);
    });

    it('a range: open on a side without an end', () => {
        const from = (operator: PeriodRelation): FilterCondition => ({ property: 'period', operator, value: { from: '2026-10-05' } });
        expect(matches(tasks.across, from('overlaps'))).toBe(true);
        expect(matches(tasks.inside, from('overlaps'))).toBe(false);
        expect(matches(tasks.outside, from('within'))).toBe(true);
    });
});

describe('a range with equals (startHour 5)', () => {
    const dueIn: FilterCondition = { property: 'due', operator: 'equals', value: { from: '2026-10-01', to: '2026-10-10' } };

    it('a due closes in the days: 10/11 05:00 closes 10/10, 05:01 does not', () => {
        expect(matches({ due: '2026-10-10' }, dueIn)).toBe(true);
        expect(matches({ due: '2026-10-11T05:00' }, dueIn)).toBe(true);
        expect(matches({ due: '2026-10-11T05:01' }, dueIn)).toBe(false);
        expect(matches({ due: '2026-10-01T05:00' }, dueIn)).toBe(false);
    });
});

describe('compileFilter: the period condition', () => {
    const one = (c: FilterCondition) => compileFilter({ logic: 'and', filters: [c] });
    const atom = (rel: 'overlaps' | 'within') => ({ kind: 'period', rel, value: { preset: 'thisWeek' } });

    it('overlaps and within are the atom', () => {
        expect(one(thisWeek('overlaps'))).toEqual({ kind: 'all', items: [atom('overlaps')] });
        expect(one(thisWeek('within'))).toEqual({ kind: 'all', items: [atom('within')] });
    });

    it('a negation asks for a span first: all(has(period), not(atom))', () => {
        expect(one(thisWeek('notOverlaps'))).toEqual({ kind: 'all', items: [
            { kind: 'all', items: [{ kind: 'has', property: 'period' }, { kind: 'not', item: atom('overlaps') }] },
        ] });
        expect(one(thisWeek('notWithin'))).toEqual({ kind: 'all', items: [
            { kind: 'all', items: [{ kind: 'has', property: 'period' }, { kind: 'not', item: atom('within') }] },
        ] });
    });

    it('a row with no value, \'\', or a range with no end chosen constrains nothing', () => {
        expect(one({ property: 'period', operator: 'notOverlaps' })).toEqual({ kind: 'all', items: [ALWAYS] });
        expect(one({ property: 'period', operator: 'overlaps', value: '' })).toEqual({ kind: 'all', items: [ALWAYS] });
        expect(one({ property: 'period', operator: 'overlaps', value: { from: '', to: '' } })).toEqual({ kind: 'all', items: [ALWAYS] });
        expect(one({ property: 'due', operator: 'equals', value: {} })).toEqual({ kind: 'all', items: [ALWAYS] });
    });
});
