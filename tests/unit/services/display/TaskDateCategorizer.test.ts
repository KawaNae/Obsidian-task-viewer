import { describe, it, expect } from 'vitest';
import {
    categorizeTasksForDate,
    categorizeTasksByDate,
} from '../../../../src/services/display/TaskDateCategorizer';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../../src/services/display/DisplayTaskConverter';
import { splitTasks } from '../../../../src/services/display/TaskSplitter';
import type { DisplayTask, Task } from '../../../../src/types';

/** Build a minimal Task for testing. */
function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'tv-inline:test.md:ln:1',
        file: 'test.md',
        line: 0,
        content: 'test task',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        tags: [],
        originalText: '- [ ] test task',
        parserId: 'tv-inline',
        ...overrides,
    };
}

const startHour = 5;

function dt(overrides: Partial<Task> = {}): DisplayTask {
    return toDisplayTask(makeTask(overrides), startHour, NO_TASK_LOOKUP);
}

/** Hand-built DisplayTask for branches the converter cannot produce. */
function makeDisplayTask(overrides: Partial<DisplayTask> = {}): DisplayTask {
    return {
        ...makeTask(),
        effectiveStartDate: '',
        startDateImplicit: true,
        startTimeImplicit: true,
        endDateImplicit: true,
        endTimeImplicit: true,
        originalTaskId: 'tv-inline:test.md:ln:1',
        isSplit: false,
        childEntries: [],
        ...overrides,
    };
}

function idsOf(tasks: DisplayTask[]): string[] {
    return tasks.map((t) => t.id);
}

describe('日付所属: dueOnly', () => {
    it('due の calendar 日付に所属する（visual 日付ではない）', () => {
        // due 2026-01-16T02:00 は startHour=5 の visual では Jan15 夜だが、
        // 所属は raw due の calendar 日付 Jan16（締切 = calendarDate の意味論）
        const task = dt({ id: 'due-task', due: '2026-01-16T02:00' });
        expect(idsOf(categorizeTasksForDate([task], '2026-01-16', startHour).dueOnly)).toEqual(['due-task']);
        expect(idsOf(categorizeTasksForDate([task], '2026-01-15', startHour).dueOnly)).toEqual([]);
    });
});

describe('日付所属: allDay', () => {
    // allDay の所属は AllDay レーンのカード配置と同じ getTaskDateRange の
    // visual span。S-AllDay の effective 解決（翌日 04:59 終端）は
    // toVisualDate シフトで吸収され、所属は 1 visual 日になる。
    it('S-AllDay Jan15 は visual 1 日分（Jan15）のみに所属する', () => {
        const task = dt({ id: 'allday-s', startDate: '2026-01-15' });
        expect(idsOf(categorizeTasksForDate([task], '2026-01-15', startHour).allDay)).toEqual(['allday-s']);
        expect(idsOf(categorizeTasksForDate([task], '2026-01-16', startHour).allDay)).toEqual([]);
        expect(idsOf(categorizeTasksForDate([task], '2026-01-17', startHour).allDay)).toEqual([]);
    });

    it('SE-AllDay Jan15〜Jan17（raw endDate は exclusive 側の二重規格）は visual Jan15/16 に所属する', () => {
        const task = dt({ id: 'allday-se', startDate: '2026-01-15', endDate: '2026-01-17' });
        expect(idsOf(categorizeTasksForDate([task], '2026-01-15', startHour).allDay)).toEqual(['allday-se']);
        expect(idsOf(categorizeTasksForDate([task], '2026-01-16', startHour).allDay)).toEqual(['allday-se']);
        expect(idsOf(categorizeTasksForDate([task], '2026-01-17', startHour).allDay)).toEqual([]);
    });

    it('反転 range（effectiveEndDate < effectiveStartDate）はクランプされ開始日 1 日に所属する', () => {
        const task = makeDisplayTask({
            id: 'inverted',
            effectiveStartDate: '2026-01-17',
            effectiveEndDate: '2026-01-15',
        });
        expect(idsOf(categorizeTasksForDate([task], '2026-01-17', startHour).allDay)).toEqual(['inverted']);
        for (const date of ['2026-01-15', '2026-01-16']) {
            const buckets = categorizeTasksForDate([task], date, startHour);
            expect(idsOf(buckets.allDay)).toEqual([]);
            expect(idsOf(buckets.timed)).toEqual([]);
        }
    });
});

describe('日付所属: timed', () => {
    it('raw 02:00 は前日の visual 日付に所属する', () => {
        const task = dt({ id: 'late-night', startDate: '2026-01-16', startTime: '02:00' });
        expect(idsOf(categorizeTasksForDate([task], '2026-01-15', startHour).timed)).toEqual(['late-night']);
        expect(idsOf(categorizeTasksForDate([task], '2026-01-16', startHour).timed)).toEqual([]);
    });

    it('日中のタスクは当日の visual 日付に所属する', () => {
        const task = dt({ id: 'daytime', startDate: '2026-01-15', startTime: '09:00' });
        expect(idsOf(categorizeTasksForDate([task], '2026-01-15', startHour).timed)).toEqual(['daytime']);
    });
});

describe('categorizeTasksForDate ≡ categorizeTasksByDate（単日と複数日の一致性）', () => {
    const fixture = [
        dt({ id: 'f-due', due: '2026-01-16T02:00' }),
        dt({ id: 'f-allday', startDate: '2026-01-15' }),
        dt({ id: 'f-se', startDate: '2026-01-14', endDate: '2026-01-16' }),
        dt({ id: 'f-timed', startDate: '2026-01-15', startTime: '09:00' }),
        dt({ id: 'f-latenight', startDate: '2026-01-16', startTime: '02:00' }),
        dt({ id: 'f-none' }),
    ];
    const dates = ['2026-01-14', '2026-01-15', '2026-01-16', '2026-01-17'];

    it('全日付・全バケツで id 列が一致する', () => {
        const byDate = categorizeTasksByDate(fixture, dates, startHour);
        for (const date of dates) {
            const single = categorizeTasksForDate(fixture, date, startHour);
            const multi = byDate.get(date)!;
            expect(idsOf(multi.allDay)).toEqual(idsOf(single.allDay));
            expect(idsOf(multi.timed)).toEqual(idsOf(single.timed));
            expect(idsOf(multi.dueOnly)).toEqual(idsOf(single.dueOnly));
        }
    });

    it('複数日の分配 snapshot', () => {
        const byDate = categorizeTasksByDate(fixture, dates, startHour);
        const snapshot = dates.map((date) => {
            const b = byDate.get(date)!;
            return `${date} allDay=[${idsOf(b.allDay)}] timed=[${idsOf(b.timed)}] dueOnly=[${idsOf(b.dueOnly)}]`;
        });
        expect(snapshot).toEqual([
            '2026-01-14 allDay=[f-se] timed=[] dueOnly=[]',
            '2026-01-15 allDay=[f-se,f-allday] timed=[f-timed,f-latenight] dueOnly=[]',
            '2026-01-16 allDay=[] timed=[] dueOnly=[f-due]',
            '2026-01-17 allDay=[] timed=[] dueOnly=[]',
        ]);
    });
});

describe('バケツ内ソート（TaskRenderOrder 準拠）', () => {
    it('timed: startHour 起点の相対分で wrap する（23:00 が 04:30 より先）', () => {
        const late = dt({ id: 'z-2300', startDate: '2026-01-15', startTime: '23:00' });
        const night = dt({ id: 'a-0430', startDate: '2026-01-16', startTime: '04:30' });
        const timed = categorizeTasksForDate([night, late], '2026-01-15', startHour).timed;
        expect(idsOf(timed)).toEqual(['z-2300', 'a-0430']);
    });

    it('timed: 同時刻は duration 降順、同一なら id 昇順', () => {
        const short = dt({ id: 'a-short', startDate: '2026-01-15', startTime: '10:00', endTime: '10:30' });
        const long = dt({ id: 'z-long', startDate: '2026-01-15', startTime: '10:00', endTime: '12:00' });
        const k2 = dt({ id: 'k2', startDate: '2026-01-15', startTime: '14:00' });
        const k1 = dt({ id: 'k1', startDate: '2026-01-15', startTime: '14:00' });
        const timed = categorizeTasksForDate([short, long, k2, k1], '2026-01-15', startHour).timed;
        expect(idsOf(timed)).toEqual(['z-long', 'a-short', 'k1', 'k2']);
    });

    it('allDay: 開始日昇順、同日は id 昇順', () => {
        const b = dt({ id: 'b', startDate: '2026-01-15', endDate: '2026-01-16' });
        const a = dt({ id: 'a', startDate: '2026-01-15', endDate: '2026-01-16' });
        const earlier = dt({ id: 'z-earlier', startDate: '2026-01-14', endDate: '2026-01-16' });
        const allDay = categorizeTasksForDate([b, a, earlier], '2026-01-15', startHour).allDay;
        expect(idsOf(allDay)).toEqual(['z-earlier', 'a', 'b']);
    });

    it('dueOnly: due 昇順', () => {
        const evening = dt({ id: 'a-evening', due: '2026-01-15T18:00' });
        const morning = dt({ id: 'z-morning', due: '2026-01-15T09:00' });
        const dueOnly = categorizeTasksForDate([evening, morning], '2026-01-15', startHour).dueOnly;
        expect(idsOf(dueOnly)).toEqual(['z-morning', 'a-evening']);
    });
});

describe('splitTasks との統合', () => {
    it('visual 境界跨ぎの timed タスクは分割後も両セグメント timed のまま各日に所属する', () => {
        const task = dt({
            id: 'crossing',
            startDate: '2026-01-15', startTime: '22:00',
            endDate: '2026-01-16', endTime: '08:00',
        });
        const split = splitTasks([task], { type: 'visual-date', startHour });
        expect(split.length).toBe(2);

        const byDate = categorizeTasksByDate(split, ['2026-01-15', '2026-01-16'], startHour);
        const day15 = byDate.get('2026-01-15')!;
        const day16 = byDate.get('2026-01-16')!;
        expect(day15.timed.length).toBe(1);
        expect(day16.timed.length).toBe(1);
        expect(day15.timed[0].originalTaskId).toBe('crossing');
        expect(day16.timed[0].originalTaskId).toBe('crossing');
        expect(day15.allDay.length + day16.allDay.length).toBe(0);
    });
});
