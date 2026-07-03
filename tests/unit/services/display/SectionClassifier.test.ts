import { describe, it, expect } from 'vitest';
import { classifyForSection, bucketBySection } from '../../../../src/services/display/SectionClassifier';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../../src/services/display/DisplayTaskConverter';
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

/** Converter-resolved DisplayTask (the normal production path). */
function dt(overrides: Partial<Task> = {}, hour = startHour): DisplayTask {
    return toDisplayTask(makeTask(overrides), hour, NO_TASK_LOOKUP);
}

/** Hand-built DisplayTask for defensive branches the converter cannot produce. */
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

describe('classifyForSection', () => {
    it('due のみ → dueOnly', () => {
        expect(classifyForSection(dt({ due: '2026-01-15T10:00' }), startHour)).toBe('dueOnly');
    });

    it('日付も due もなし → null', () => {
        expect(classifyForSection(dt({}), startHour)).toBe(null);
    });

    it('S-AllDay（日付のみ、解決後 05:00→翌 04:59 = 23h59m） → allday', () => {
        expect(classifyForSection(dt({ startDate: '2026-01-15' }), startHour)).toBe('allDay');
    });

    it('S-Timed（暗黙 +1h） → timed', () => {
        expect(classifyForSection(dt({ startDate: '2026-01-15', startTime: '09:00' }), startHour)).toBe('timed');
    });

    it('ちょうど 23h30m → allday（閾値は ≥）', () => {
        const task = dt({
            startDate: '2026-01-15', startTime: '06:00',
            endDate: '2026-01-16', endTime: '05:30',
        });
        expect(classifyForSection(task, startHour)).toBe('allDay');
    });

    it('23h29m → timed', () => {
        const task = dt({
            startDate: '2026-01-15', startTime: '06:00',
            endDate: '2026-01-16', endTime: '05:29',
        });
        expect(classifyForSection(task, startHour)).toBe('timed');
    });

    it('E-Timed（endDate + endTime のみ） → timed', () => {
        expect(classifyForSection(dt({ endDate: '2026-01-15', endTime: '10:00' }), startHour)).toBe('timed');
    });

    it('startHour=0 でも 23.5h 閾値は同じ', () => {
        const allday = dt({
            startDate: '2026-01-15', startTime: '06:00',
            endDate: '2026-01-16', endTime: '05:30',
        }, 0);
        const timed = dt({
            startDate: '2026-01-15', startTime: '06:00',
            endDate: '2026-01-16', endTime: '05:29',
        }, 0);
        expect(classifyForSection(allday, 0)).toBe('allDay');
        expect(classifyForSection(timed, 0)).toBe('timed');
    });

    it('防御分岐: effectiveStartTime 不在の手組み task → allday', () => {
        const task = makeDisplayTask({ effectiveStartDate: '2026-01-15' });
        expect(classifyForSection(task, startHour)).toBe('allDay');
    });

    it('防御分岐: effectiveStartDate 空 + raw startDate あり → null', () => {
        const task = makeDisplayTask({ effectiveStartDate: '', startDate: '2026-01-15' });
        expect(classifyForSection(task, startHour)).toBe(null);
    });
});

describe('bucketBySection', () => {
    it('混合配列を重複なく 3 バケツに分配する', () => {
        const dueOnly = dt({ due: '2026-01-20' });
        const allday = dt({ startDate: '2026-01-15' });
        const timed = dt({ startDate: '2026-01-15', startTime: '09:00' });
        const boundary = dt({
            startDate: '2026-01-15', startTime: '06:00',
            endDate: '2026-01-16', endTime: '05:30',
        });
        const none = dt({});

        const buckets = bucketBySection([dueOnly, allday, timed, boundary, none], startHour);

        expect(buckets.allDay).toEqual([allday, boundary]);
        expect(buckets.timed).toEqual([timed]);
        expect(buckets.dueOnly).toEqual([dueOnly]);
        // none はどのバケツにも入らない
        const total = buckets.allDay.length + buckets.timed.length + buckets.dueOnly.length;
        expect(total).toBe(4);
    });
});
