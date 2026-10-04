import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskApi } from '../../../../src/api/TaskApi';
import { filterOfParams } from '../../../../src/api/FilterParamsBuilder';
import { compileFilter } from '../../../../src/services/filter/FilterExpr';
import { TaskFilterEngine } from '../../../../src/services/filter/TaskFilterEngine';
import { TaskReadService } from '../../../../src/services/data/TaskReadService';
import { splitTasks } from '../../../../src/services/display/TaskSplitter';
import { categorizeTasksByDate } from '../../../../src/services/display/TaskDateCategorizer';
import { daysWindow } from '../../../../src/utils/DayWindow';
import { overlaps } from '../../../../src/utils/SpanRelation';
import type { Task } from '../../../../src/types';
import { makeTask } from '../../helpers/makeTask';

/**
 * Stage 7's issue P (T1–T6) and tasks with only a due: the views, the window queries and the overdue
 * mark of Timeline's heading answer the same visual days (startHour 5).
 */
const CASES: { name: string; task: Partial<Task>; days: string[] }[] = [
    { name: 'T1 @2026-10-01', task: { startDate: '2026-10-01' }, days: ['2026-10-01'] },
    { name: 'T2 @2026-10-01>2026-10-05', task: { startDate: '2026-10-01', endDate: '2026-10-05' },
        days: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'] },
    { name: 'T3 @>2026-10-05', task: { endDate: '2026-10-05' }, days: ['2026-10-05'] },
    { name: 'T4 @2026-10-02T02:00', task: { startDate: '2026-10-02', startTime: '02:00' }, days: ['2026-10-01'] },
    { name: 'T5 @2026-10-01T22:00>2026-10-02T05:00',
        task: { startDate: '2026-10-01', startTime: '22:00', endDate: '2026-10-02', endTime: '05:00' }, days: ['2026-10-01'] },
    { name: 'T6 @2026-10-01T10:00>2026-10-03T18:00',
        task: { startDate: '2026-10-01', startTime: '10:00', endDate: '2026-10-03', endTime: '18:00' },
        days: ['2026-10-01', '2026-10-02', '2026-10-03'] },
    { name: '@>>2026-10-05', task: { due: '2026-10-05' }, days: ['2026-10-05'] },
    { name: '@>>2026-10-05T02:00', task: { due: '2026-10-05T02:00' }, days: ['2026-10-04'] },
];

const DAYS = ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];
const startHour = 5;

function serviceOver(tasks: Task[]): TaskReadService {
    const index = {
        getRevision: () => 1,
        getTasks: () => tasks,
        getTask: (id: string) => tasks.find(t => t.id === id),
    };
    return new TaskReadService(index as any, () => ({ startHour, weekStartDay: 1 }));
}

afterEach(() => {
    vi.useRealTimers();
});

describe.each(CASES)('$name', ({ task, days }) => {
    const service = serviceOver([makeTask({ id: 'x', ...task })]);

    it('tasksInWindow finds it on its days only', () => {
        const found = DAYS.filter(d => service.tasksInWindow(daysWindow(d, d, startHour)).length > 0);
        expect(found).toEqual(days);
    });

    it('the views draw it on the same days', () => {
        const drawn = service.getAllDisplayTasks();
        const split = splitTasks(drawn, { type: 'visual-date', startHour });
        const map = categorizeTasksByDate(split, DAYS, startHour);
        const on = DAYS.filter(d => {
            const b = map.get(d)!;
            return b.allDay.length + b.timed.length > 0;
        });
        expect(on).toEqual(days);
    });

    it('the API today answers it on the same days', () => {
        const api = new TaskApi({
            app: {},
            settings: { startHour, weekStartDay: 1 },
            getTaskReadService: () => service,
            getIndex: () => ({ getTask: () => undefined }),
            getOperations: () => ({}),
        } as any);
        const found = DAYS.filter(d => {
            const [y, m, day] = d.split('-').map(Number);
            vi.useFakeTimers();
            vi.setSystemTime(new Date(y, m - 1, day + 1, 3, 0)); // 03:00 the next morning: still d
            return api.today().total > 0;
        });
        expect(found).toEqual(days);
    });

    it("list's date window takes it on the same days", () => {
        const [dt] = service.getAllDisplayTasks();
        const context = { startHour, weekStartDay: 1 as const, taskLookup: () => undefined, now: new Date() };
        const found = DAYS.filter(d =>
            TaskFilterEngine.evaluate(dt, compileFilter(filterOfParams({}, { date: d })!), context));
        expect(found).toEqual(days);
    });

    it("Timeline's heading marks the same days", () => {
        const [dt] = service.getAllDisplayTasks();
        expect(DAYS.filter(d => overlaps(dt.span!, daysWindow(d, d, startHour)))).toEqual(days);
    });
});
