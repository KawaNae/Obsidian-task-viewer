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

    it('夏時間の日の @D（23時間）も、開始が日付だけなので allDay', () => {
        const short = { ...dt({ startDate: '2026-01-15' }), span: { startMs: 0, endMs: 23 * 3_600_000 } };
        expect(classifyForSection(short)).toBe('allDay');
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

    it('期間の無い行（日付の無い @T10:00）は due が無ければ null', () => {
        expect(classifyForSection(dt({ startTime: '10:00' }))).toBe(null);
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
