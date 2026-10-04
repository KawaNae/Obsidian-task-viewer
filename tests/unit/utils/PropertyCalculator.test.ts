import { describe, it, expect } from 'vitest';
import { PropertyCalculator } from '../../../src/interaction/menu/PropertyCalculator';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import type { DisplayTask, Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * What the menu shows of a task's dates: the line's values plain, the rest
 * faint, at the precision they are written with (startHour 5).
 */
const startHour = 5;
const dt = (task: Partial<Task>): DisplayTask => toDisplayTask(makeTask(task), startHour, NO_TASK_LOOKUP);
const calc = new PropertyCalculator();
const start = (task: Partial<Task>) => calc.calculateStart({ task: dt(task), startHour, viewStartDate: null });
const end = (task: Partial<Task>) => calc.calculateEnd({ task: dt(task), startHour, viewStartDate: null });

describe('PropertyCalculator', () => {
    describe('calculateStart', () => {
        it('a written start is plain', () => {
            expect(start({ startDate: '2026-03-11', startTime: '09:00' }))
                .toEqual({ date: '2026-03-11', time: '09:00', dateImplicit: false, timeImplicit: false });
        });

        it('a bare date has no time (no 05:00)', () => {
            expect(start({ startDate: '2026-03-11' }))
                .toEqual({ date: '2026-03-11', dateImplicit: false, timeImplicit: true });
        });

        it('an inherited time is faint', () => {
            expect(start({ startDate: '2026-03-11', cascadeContext: { startTime: '06:00' } }))
                .toEqual({ date: '2026-03-11', time: '06:00', dateImplicit: false, timeImplicit: true });
        });

        it('@>E: the start date the rules give, faint, with no time', () => {
            expect(start({ endDate: '2026-03-12' }))
                .toEqual({ date: '2026-03-11', dateImplicit: true, timeImplicit: true });
        });

        it('a due-only task has no start', () => {
            expect(start({ due: '2026-03-11' }).isUnset).toBe(true);
        });
    });

    describe('calculateEnd', () => {
        it('the default hour gives a date and a time, faint', () => {
            expect(end({ startDate: '2026-03-11', startTime: '09:00' }))
                .toEqual({ date: '2026-03-11', time: '10:00', dateImplicit: true, timeImplicit: true });
        });

        it('a time past midnight ends the next day', () => {
            expect(end({ startDate: '2026-03-11', startTime: '23:30' }))
                .toEqual({ date: '2026-03-12', time: '00:30', dateImplicit: true, timeImplicit: true });
        });

        it('@D ends with the date written to end it (the rule until 11c), and no time', () => {
            expect(end({ startDate: '2026-03-11' }))
                .toEqual({ date: '2026-03-12', dateImplicit: true, timeImplicit: true });
        });

        it('a written bare end date gets no time', () => {
            expect(end({ startDate: '2026-03-11', endDate: '2026-03-13' }))
                .toEqual({ date: '2026-03-13', dateImplicit: false, timeImplicit: true });
        });

        it('a written end is plain', () => {
            expect(end({ startDate: '2026-03-11', startTime: '09:00', endDate: '2026-03-12', endTime: '18:00' }))
                .toEqual({ date: '2026-03-12', time: '18:00', dateImplicit: false, timeImplicit: false });
        });

        it('a due-only task has no end', () => {
            expect(end({ due: '2026-03-11' }).isUnset).toBe(true);
        });
    });

    describe('calculateDue', () => {
        it('splits datetime due', () => {
            expect(calc.calculateDue(dt({ due: '2026-03-15T17:00' })))
                .toEqual({ date: '2026-03-15', time: '17:00', dateImplicit: false, timeImplicit: false });
        });

        it('returns date-only due as explicit', () => {
            expect(calc.calculateDue(dt({ due: '2026-03-15' })))
                .toEqual({ date: '2026-03-15', dateImplicit: false, timeImplicit: false });
        });

        it('cascade 継承 due (raw due なし) は implicit として表示する', () => {
            expect(calc.calculateDue(dt({ cascadeContext: { due: '2026-03-15' } })))
                .toEqual({ date: '2026-03-15', dateImplicit: true, timeImplicit: true });
        });

        it('returns isUnset when no due at all', () => {
            expect(calc.calculateDue(dt({ startDate: '2026-03-11' })).isUnset).toBe(true);
        });
    });
});
