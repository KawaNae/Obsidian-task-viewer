import { describe, it, expect } from 'vitest';
import { categorizeTasksForDate } from '../../../../src/services/display/TaskDateCategorizer';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../../src/services/display/DisplayTaskConverter';
import { ScheduleTaskCategorizer } from '../../../../src/views/scheduleview/utils/ScheduleTaskCategorizer';
import { ScheduleGridCalculator } from '../../../../src/views/scheduleview/utils/ScheduleGridCalculator';
import type { DisplayTask, Task } from '../../../../src/types';

const startHour = 5;
const day = '2026-10-02';

function dt(file: string, line: number, content: string, fields: Partial<Task>): DisplayTask {
    return toDisplayTask({
        id: `tv-inline:${file}:n:r1:${line}`,
        file,
        line,
        content,
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        tags: [],
        originalText: `- [ ] ${content}`,
        parserId: 'tv-inline',
        ...fields,
    }, startHour, NO_TASK_LOOKUP);
}

function schedule(tasks: DisplayTask[]) {
    const getStartHour = () => startHour;
    const gridCalculator = new ScheduleGridCalculator({ getStartHour, hoursPerDay: 24, minGapHeightPx: 20, maxGapHeightPx: 60 });
    const categorizer = new ScheduleTaskCategorizer({ getStartHour, gridCalculator });
    return categorizer.toScheduleFormat(categorizeTasksForDate(tasks, day, startHour));
}

const contents = (tasks: DisplayTask[]) => tasks.map(t => t.content);

// Schedule draws each section in the canonical order (TaskRenderOrder), as
// Timeline does; it used to re-sort every section by file and line.
describe('Schedule keeps the canonical order', () => {
    it('all-day: a task begun on an earlier day comes first, whatever its file', () => {
        const shopping = dt('a.md', 5, 'shopping', { startDate: '2026-10-02' });
        const trip = dt('b.md', 1, 'trip', { startDate: '2026-10-01', endDate: '2026-10-04' });
        expect(contents(schedule([shopping, trip]).allDay)).toEqual(['trip', 'shopping']);
    });

    it('all-day: on the same day, by file, then line as a number', () => {
        const ten = dt('a.md', 10, 'ten', { startDate: '2026-10-02' });
        const nine = dt('a.md', 9, 'nine', { startDate: '2026-10-02' });
        const other = dt('b.md', 1, 'other', { startDate: '2026-10-02' });
        expect(contents(schedule([other, ten, nine]).allDay)).toEqual(['nine', 'ten', 'other']);
    });

    it('timed: at the same start, the longer first', () => {
        const short = dt('a.md', 1, 'short', { startDate: day, startTime: '10:00', endTime: '10:30' });
        const long = dt('b.md', 1, 'long', { startDate: day, startTime: '10:00', endTime: '12:00' });
        expect(contents(schedule([short, long]).timed)).toEqual(['long', 'short']);
    });

    it('due only: by due, then file and line', () => {
        const evening = dt('a.md', 1, 'evening', { due: '2026-10-02T18:00' });
        const morning = dt('b.md', 1, 'morning', { due: '2026-10-02T09:00' });
        const bare = dt('c.md', 1, 'bare', { due: '2026-10-02' });
        expect(contents(schedule([evening, morning, bare]).dueOnly)).toEqual(['bare', 'morning', 'evening']);
    });
});
