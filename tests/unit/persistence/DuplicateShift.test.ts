import { describe, it, expect } from 'vitest';
import { planInPlaceCopies } from '../../../src/services/persistence/DuplicateShift';
import { toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import type { Task } from '../../../src/types';

const START_HOUR = 5;

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'tv-inline:test.md:seq:1',
        file: 'test.md',
        line: 0,
        content: 'task',
        statusChar: ' ',
        parserId: 'tv-inline',
        indent: 0,
        childIds: [],
        childLines: [],
        tags: [],
        originalText: '- [ ] task',
        ...overrides,
    } as Task;
}

/**
 * The lines a duplicate would write, through the real date resolution and the
 * real formatter — the copies are only ever seen as lines, so that is what the
 * assertions read.
 */
function copyLines(task: Task, count = 1): string[] {
    const plan = planInPlaceCopies(task, toDisplayTask(task, START_HOUR, () => undefined), count);
    if (plan.kind === 'verbatim') {
        // The writer repeats the file's own line; the test stands in for it
        // with the line the task was parsed from.
        return Array.from({ length: plan.count }, () => task.originalText);
    }
    return plan.tasks.map(copy => TaskParser.format(copy));
}

/** Whether the plan moves the task at all, as opposed to repeating its line. */
function isShifted(task: Task): boolean {
    return planInPlaceCopies(task, toDisplayTask(task, START_HOUR, () => undefined), 1).kind === 'shifted';
}

describe('planInPlaceCopies', () => {
    it('starts the copy at a written end and keeps the length', () => {
        const task = makeTask({
            startDate: '2026-03-11', startTime: '10:00',
            endDate: '2026-03-11', endTime: '11:30',
            originalText: '- [ ] task @2026-03-11T10:00>2026-03-11T11:30',
        });

        expect(copyLines(task)).toEqual(['- [ ] task @2026-03-11T11:30>13:00']);
    });

    it('starts the copy an hour on when no end was written, and writes none either', () => {
        const task = makeTask({
            startDate: '2026-03-11', startTime: '15:00',
            originalText: '- [ ] task @2026-03-11T15:00',
        });

        // The implicit hour is the length, so the copy is given it the same way.
        expect(copyLines(task)).toEqual(['- [ ] task @2026-03-11T16:00']);
    });

    it('leaves an all-day task where it is', () => {
        const task = makeTask({ startDate: '2026-03-11', originalText: '- [ ] task @2026-03-11' });

        expect(copyLines(task)).toEqual(['- [ ] task @2026-03-11']);
    });

    it('leaves a task with no dates alone', () => {
        const task = makeTask();

        expect(copyLines(task)).toEqual(['- [ ] task']);
    });

    it('chains several copies, each starting where the one before ends', () => {
        const task = makeTask({
            startDate: '2026-03-11', startTime: '10:00',
            endDate: '2026-03-11', endTime: '11:00',
            originalText: '- [ ] task @2026-03-11T10:00>2026-03-11T11:00',
        });

        expect(copyLines(task, 3)).toEqual([
            '- [ ] task @2026-03-11T11:00>12:00',
            '- [ ] task @2026-03-11T12:00>13:00',
            '- [ ] task @2026-03-11T13:00>14:00',
        ]);
    });

    it('drops the block id, which belongs to the line that was written', () => {
        const task = makeTask({
            startDate: '2026-03-11', startTime: '10:00',
            endDate: '2026-03-11', endTime: '11:00',
            blockId: 'tv-timer-abc',
            originalText: '- [ ] task @2026-03-11T10:00>2026-03-11T11:00 ^tv-timer-abc',
        });

        expect(copyLines(task)[0]).not.toContain('^');
    });

    it('does not shift a due date', () => {
        const task = makeTask({
            startDate: '2026-03-11', startTime: '10:00',
            endDate: '2026-03-11', endTime: '11:00',
            due: '2026-03-20',
            originalText: '- [ ] task @2026-03-11T10:00>2026-03-11T11:00>2026-03-20',
        });

        expect(copyLines(task)[0]).toContain('>2026-03-20');
    });

    it('keeps a time-only line time-only while the copy stays in the day', () => {
        // The day comes from the note's scope; the copy goes on following it.
        const task = makeTask({
            startTime: '10:00', endTime: '11:00',
            cascadeContext: { startDate: '2026-03-11' },
            originalText: '- [ ] task @10:00>11:00',
        } as Partial<Task>);

        expect(copyLines(task)).toEqual(['- [ ] task @11:00>12:00']);
    });

    it('spells out the date once the shift leaves the day scope names', () => {
        // 23:00-23:30 copies to 23:30-00:00; the next copy starts next day.
        const task = makeTask({
            startTime: '23:00', endTime: '23:30',
            cascadeContext: { startDate: '2026-03-11' },
            originalText: '- [ ] task @23:00>23:30',
        } as Partial<Task>);

        const [first, second] = copyLines(task, 2);
        // An end before its start reads as the next day, so it stays a time.
        expect(first).toBe('- [ ] task @23:30>00:00');
        // The second copy has left 03-11 entirely and has to say so.
        expect(second).toBe('- [ ] task @2026-03-12T00:00>00:30');
    });

    it('moves a copy of a task that already crosses midnight onto the right day', () => {
        const task = makeTask({
            startDate: '2026-03-11', startTime: '23:00',
            endDate: '2026-03-12', endTime: '01:00',
            originalText: '- [ ] task @2026-03-11T23:00>2026-03-12T01:00',
        });

        expect(copyLines(task)).toEqual(['- [ ] task @2026-03-12T01:00>03:00']);
    });

    it('gives a task of no length the default hour, so no copy lands on its slot', () => {
        const task = makeTask({
            startDate: '2026-03-11', startTime: '10:00',
            endDate: '2026-03-11', endTime: '10:00',
            originalText: '- [ ] task @2026-03-11T10:00>2026-03-11T10:00',
        });

        expect(copyLines(task)).toEqual(['- [ ] task @2026-03-11T11:00>11:00']);
    });

    it('makes every copy of an all-day task the same line', () => {
        const task = makeTask({ startDate: '2026-03-11', originalText: '- [ ] task @2026-03-11' });

        expect(copyLines(task, 2)).toEqual([
            '- [ ] task @2026-03-11',
            '- [ ] task @2026-03-11',
        ]);
    });

    it('repeats the line as written when there is nothing to move', () => {
        // Not reformatted: a task standing still should not be reworded.
        const task = makeTask({
            startDate: '2026-03-11',
            originalText: '+  [ ] @2026-03-11  odd   spacing',
        });

        expect(copyLines(task)).toEqual(['+  [ ] @2026-03-11  odd   spacing']);
        expect(isShifted(task)).toBe(false);
    });

    it('writes out an end the task only inherited, so the copy keeps its length', () => {
        // The inherited end stays where it is while the copy moves, so a copy
        // that did not write its own end would come out a different length.
        const task = makeTask({
            startDate: '2026-03-11', startTime: '10:00',
            cascadeContext: { endTime: '12:00' },
            originalText: '- [ ] task @2026-03-11T10:00',
        } as Partial<Task>);

        expect(copyLines(task, 2)).toEqual([
            '- [ ] task @2026-03-11T12:00>14:00',
            '- [ ] task @2026-03-11T14:00>16:00',
        ]);
    });

    it('writes out an end date the task only inherited', () => {
        const task = makeTask({
            startDate: '2026-03-11', startTime: '23:00',
            cascadeContext: { endDate: '2026-03-12', endTime: '01:00' },
            originalText: '- [ ] task @2026-03-11T23:00',
        } as Partial<Task>);

        expect(copyLines(task)).toEqual(['- [ ] task @2026-03-12T01:00>03:00']);
    });

    it('shifts a task whose start time comes from scope', () => {
        // Effective, not written, is what decides: this one holds a time.
        const task = makeTask({
            startDate: '2026-03-11',
            cascadeContext: { startTime: '10:00', endTime: '11:00' },
            originalText: '- [ ] task @2026-03-11',
        } as Partial<Task>);

        expect(copyLines(task)).toEqual(['- [ ] task @2026-03-11T11:00>12:00']);
    });

    it('leaves a span of whole days alone', () => {
        // An end date with no time means "to the end of that day". The last
        // minute before the day rolls over is a setting, not a time the task
        // gave, and writing it out would leak startHour into the line.
        const task = makeTask({
            startDate: '2026-03-11', startTime: '10:00',
            endDate: '2026-03-13',
            originalText: '- [ ] task @2026-03-11T10:00>2026-03-13',
        });

        expect(isShifted(task)).toBe(false);
        expect(copyLines(task)).toEqual(['- [ ] task @2026-03-11T10:00>2026-03-13']);
    });
});
