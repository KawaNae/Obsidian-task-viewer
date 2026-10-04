import { describe, it, expect } from 'vitest';
import {
    composeTopRight,
    resolveTopRightField,
    TIME_TOP_RIGHT,
    topRightText,
} from '../../../../src/views/taskcard/TopRightFieldResolver';
import { renderTopRight } from '../../../../src/views/taskcard/TaskCardRenderer';
import { toDisplayTask, NO_TASK_LOOKUP } from '../../../../src/services/display/DisplayTaskConverter';
import { splitTasks } from '../../../../src/services/display/TaskSplitter';
import { statedDates } from '../../../../src/utils/TaskDates';
import { DEFAULT_SETTINGS, type DisplayTask, type Task, type TaskViewerSettings } from '../../../../src/types';
import { readLine } from '../../helpers/readLine';
import { makeTask } from '../../helpers/makeTask';

const START_HOUR = 5;
const settings = { ...DEFAULT_SETTINGS, startHour: START_HOUR } as TaskViewerSettings;

/** The display copy of `task`, as the views get it. */
function shown(task: Task): DisplayTask {
    return toDisplayTask(task, START_HOUR, NO_TASK_LOOKUP);
}

/** The display copy of the task the line `@<notation>` holds. */
function lineTask(notation: string, inherited?: Task['cascadeContext']): DisplayTask {
    const row = readLine(`- [ ] task ${notation}`, settings);
    if (!row) throw new Error(`no task in ${notation}`);
    return shown(inherited ? { ...row, cascadeContext: inherited } : row);
}

function field(task: DisplayTask, name: string): string {
    return resolveTopRightField(task, name, settings) ?? '';
}

describe('the top right shows the dates the note states', () => {
    const rows: Array<[string, DisplayTask, Record<string, string>]> = [
        ['@2026-10-04', lineTask('@2026-10-04'),
            { start: '2026-10-04', end: '', startTime: '', times: '', due: '' }],
        ['@2026-10-04T10:00', lineTask('@2026-10-04T10:00'),
            { start: '2026-10-04 10:00', end: '', startTime: '10:00', times: '10:00', due: '' }],
        ['@2026-10-04T10:00>11:00', lineTask('@2026-10-04T10:00>11:00'),
            { start: '2026-10-04 10:00', end: '11:00', startTime: '10:00', times: '10:00>11:00', due: '' }],
        ['@2026-10-01>2026-10-04', lineTask('@2026-10-01>2026-10-04'),
            { start: '2026-10-01', end: '2026-10-04', startTime: '', times: '', due: '' }],
        ['@2026-10-04 under a section of tv-start:: 06:00', lineTask('@2026-10-04', { startTime: '06:00' }),
            { start: '2026-10-04 06:00', end: '', startTime: '06:00', times: '06:00', due: '' }],
        ['@2026-10-04 inheriting the due 2026-10-10', lineTask('@2026-10-04', { due: '2026-10-10' }),
            { start: '2026-10-04', end: '', startTime: '', times: '', due: '2026-10-10' }],
    ];

    for (const [name, task, expected] of rows) {
        it(name, () => {
            for (const [f, value] of Object.entries(expected)) {
                expect(field(task, f), f).toBe(value);
            }
        });
    }

    it('a time-only end shows the time the line writes, and no date', () => {
        // The line writes no end date: the end is the end time alone.
        expect(field(lineTask('@2026-10-04T10:00>11:00'), 'endDate')).toBe('');
        expect(field(lineTask('@2026-10-04T10:00>11:00'), 'endTime')).toBe('11:00');
    });

    it('a late-night end shows the date it is written with', () => {
        const task = lineTask('@2026-10-01T09:00>2026-10-05T02:00');
        expect(field(task, 'end')).toBe('2026-10-05 02:00');
        expect(field(task, 'endDom')).toBe('5');
    });

    it('splits the due into its date and time', () => {
        const t = lineTask('@2026-03-14>>2026-03-15T09:30');
        expect(field(t, 'dueDate')).toBe('2026-03-15');
        expect(field(t, 'dueTime')).toBe('09:30');
        expect(field(lineTask('@2026-03-14>>2026-03-15'), 'dueTime')).toBe('');
    });

    it('gives the weekday of a real day and none for a day that does not exist', () => {
        const sunday = field(lineTask('@2026-03-15'), 'startWeekday');
        const monday = field(lineTask('@2026-03-16'), 'startWeekday');
        expect(sunday).not.toBe(monday);
        expect(sunday).not.toBe('');
        expect(field(shown(makeTask({ startDate: '2026-02-30' })), 'startWeekday')).toBe('');
    });
});

describe('statedDates', () => {
    it("takes the line's value over the inherited one", () => {
        const stated = statedDates(makeTask({
            startDate: '2026-10-04', startTime: '10:00',
            cascadeContext: { startDate: '2026-10-01', startTime: '06:00', due: '2026-10-10' },
        }));
        expect(stated).toEqual({ startDate: '2026-10-04', startTime: '10:00', due: '2026-10-10' });
    });

    it('fills a field the line leaves empty with the inherited value', () => {
        const stated = statedDates(makeTask({
            startTime: '10:00',
            cascadeContext: { startDate: '2026-10-04', endTime: '11:00' },
        }));
        expect(stated).toEqual({ startDate: '2026-10-04', startTime: '10:00', endTime: '11:00' });
    });

    it('fills in nothing the rules would: no start of the day, no end, no default hour', () => {
        expect(statedDates(makeTask({ startDate: '2026-10-04' }))).toEqual({ startDate: '2026-10-04' });
        expect(statedDates(makeTask({ startDate: '2026-10-04', startTime: '10:00' })))
            .toEqual({ startDate: '2026-10-04', startTime: '10:00' });
        const allDay = shown(makeTask({ startDate: '2026-10-04' }));
        expect(allDay.effectiveStartTime).toBe('05:00');
        expect(allDay.effectiveEndDate).toBe('2026-10-05');
        expect(allDay.stated).toEqual({ startDate: '2026-10-04' });
    });
});

describe('a split task', () => {
    it('shows the times of the line on both segments', () => {
        const task = lineTask('@2026-10-04T22:00>2026-10-05T08:00');
        const segments = splitTasks([task], { type: 'visual-date', startHour: START_HOUR });
        expect(segments).toHaveLength(2);
        expect(segments.map(s => field(s, 'times'))).toEqual(['22:00>08:00', '22:00>08:00']);
    });

    it('shows the dates of the line on a segment a date range cuts', () => {
        const task = lineTask('@2026-10-01>2026-10-06');
        const segments = splitTasks([task], {
            type: 'date-range', start: '2026-10-02', end: '2026-10-03', startHour: START_HOUR,
        });
        expect(segments.length).toBeGreaterThan(1);
        for (const s of segments) {
            expect(field(s, 'start')).toBe('2026-10-01');
            expect(field(s, 'end')).toBe('2026-10-06');
        }
    });
});

describe('composeTopRight', () => {
    it('joins the fields that have a value between the prefix and the suffix', () => {
        const task = lineTask('@2026-10-04T10:00>>2026-10-10');
        const pieces = composeTopRight(task, {
            fields: ['startDate', 'end', 'due'], separator: ' / ', prefix: '[', suffix: ']',
        }, settings);
        expect(topRightText(pieces)).toBe('[2026-10-04 / 2026-10-10]');
        expect(pieces.map(p => p.role)).toEqual(['seg', 'seg', 'sep', 'seg', 'seg']);
    });

    it('is nothing when no field has a value, prefix and all', () => {
        const task = lineTask('@2026-10-04');
        expect(composeTopRight(task, { fields: ['end'], separator: '', prefix: 'until ' }, settings)).toEqual([]);
    });

    it('gives the times of the dated views their start and end roles', () => {
        const pieces = composeTopRight(lineTask('@2026-10-04T10:00>11:00'), TIME_TOP_RIGHT, settings);
        expect(pieces).toEqual([
            { text: '10:00', role: 'start' },
            { text: '>11:00', role: 'end' },
        ]);
    });
});

describe('renderTopRight', () => {
    /** Just what `renderTopRight` touches of an element. */
    class El {
        readonly children: El[] = [];
        textContent = '';
        constructor(readonly cls = '') {}
        createDiv(cls: string): El { const el = new El(cls); this.children.push(el); return el; }
        createSpan(cls: string): El { return this.createDiv(cls); }
    }

    it('draws each piece with the class of its role', () => {
        const card = new El();
        renderTopRight(card as unknown as HTMLElement,
            composeTopRight(lineTask('@2026-10-04T10:00>11:00'), TIME_TOP_RIGHT, settings));
        expect(card.children.map(c => c.cls)).toEqual(['task-card__time']);
        expect(card.children[0].children.map(c => [c.cls, c.textContent])).toEqual([
            ['task-card__time-start', '10:00'],
            ['task-card__time-end', '>11:00'],
        ]);
    });

    it('draws nothing for a task with no stated time', () => {
        const card = new El();
        renderTopRight(card as unknown as HTMLElement,
            composeTopRight(lineTask('@2026-10-04'), TIME_TOP_RIGHT, settings));
        expect(card.children).toEqual([]);
    });
});
