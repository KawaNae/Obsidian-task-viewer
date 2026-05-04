import { describe, it, expect } from 'vitest';
import {
    NO_TASK_LOOKUP,
    materializeRawDates,
    shouldSplitDisplayTask,
    toDisplayTask,
    toDisplayTaskWithSplit,
} from '../../../src/services/display/DisplayTaskConverter';
import { getTaskDateRange } from '../../../src/services/display/VisualDateRange';
import type { Task } from '../../../src/types';

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
        childLineBodyOffsets: [],
        tags: [],
        originalText: '- [ ] test task @2026-01-15',
        parserId: 'tv-inline',
        ...overrides,
    };
}

const startHour = 5; // default 5:00

describe('toDisplayTask', () => {
    it('resolves S-type (date only) to all-day', () => {
        const task = makeTask({ startDate: '2026-01-15' });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveStartDate).toBe('2026-01-15');
        expect(dt.effectiveStartTime).toBe('05:00');
        expect(dt.effectiveEndDate).toBe('2026-01-16');
        expect(dt.effectiveEndTime).toBe('04:59');
        expect(dt.startDateImplicit).toBe(false);
        expect(dt.startTimeImplicit).toBe(true);
        expect(dt.endDateImplicit).toBe(true);
        expect(dt.endTimeImplicit).toBe(true);
    });

    it('resolves S-Timed (date + time) with 1h default duration', () => {
        const task = makeTask({ startDate: '2026-01-15', startTime: '09:00' });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveStartDate).toBe('2026-01-15');
        expect(dt.effectiveStartTime).toBe('09:00');
        expect(dt.effectiveEndDate).toBe('2026-01-15');
        expect(dt.effectiveEndTime).toBe('10:00');
        expect(dt.startTimeImplicit).toBe(false);
        expect(dt.endDateImplicit).toBe(true);
        expect(dt.endTimeImplicit).toBe(true);
    });

    it('resolves SE-Timed (full range)', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '09:00',
            endDate: '2026-01-15',
            endTime: '17:00',
        });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveStartTime).toBe('09:00');
        expect(dt.effectiveEndDate).toBe('2026-01-15');
        expect(dt.effectiveEndTime).toBe('17:00');
        expect(dt.startDateImplicit).toBe(false);
        expect(dt.startTimeImplicit).toBe(false);
        expect(dt.endDateImplicit).toBe(false);
        expect(dt.endTimeImplicit).toBe(false);
    });

    it('resolves E-Timed (endDate + endTime, no start) — 1h before end', () => {
        const task = makeTask({
            endDate: '2026-01-15',
            endTime: '10:00',
        });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveStartDate).toBe('2026-01-15');
        expect(dt.effectiveStartTime).toBe('09:00');
        expect(dt.effectiveEndDate).toBe('2026-01-15');
        expect(dt.effectiveEndTime).toBe('10:00');
        expect(dt.startDateImplicit).toBe(true);
        expect(dt.startTimeImplicit).toBe(true);
    });

    it('resolves E-AllDay (endDate only)', () => {
        const task = makeTask({ endDate: '2026-01-15' });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveEndTime).toBe('04:59');
        expect(dt.startDateImplicit).toBe(true);
    });

    it('resolves S with endTime (same-day end)', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '09:00',
            endTime: '12:00',
        });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveEndDate).toBe('2026-01-15');
        expect(dt.effectiveEndTime).toBe('12:00');
        expect(dt.endDateImplicit).toBe(true);
        expect(dt.endTimeImplicit).toBe(false);
    });

    it('resolves SE with endDate no endTime', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            endDate: '2026-01-17',
        });
        const dt = toDisplayTask(task, startHour);
        expect(dt.effectiveEndDate).toBe('2026-01-17');
        expect(dt.effectiveEndTime).toBe('04:59');
        expect(dt.endTimeImplicit).toBe(true);
    });

    it('sets isSplit false and originalTaskId', () => {
        const task = makeTask({ startDate: '2026-01-15' });
        const dt = toDisplayTask(task, startHour);
        expect(dt.isSplit).toBe(false);
        expect(dt.originalTaskId).toBe(task.id);
    });

    it('handles inherited startDate', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startDateInherited: true,
        });
        const dt = toDisplayTask(task, startHour);
        expect(dt.startDateImplicit).toBe(true);
    });
});

describe('shouldSplitDisplayTask', () => {
    it('returns false for same visual day task', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '09:00',
            endDate: '2026-01-15',
            endTime: '17:00',
        });
        const dt = toDisplayTask(task, startHour);
        expect(shouldSplitDisplayTask(dt, startHour)).toBe(false);
    });

    it('returns true for cross-day task', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '22:00',
            endDate: '2026-01-16',
            endTime: '08:00',
        });
        const dt = toDisplayTask(task, startHour);
        expect(shouldSplitDisplayTask(dt, startHour)).toBe(true);
    });

    it('returns false when no effective end', () => {
        const task = makeTask({ startDate: '2026-01-15' });
        // toDisplayTask resolves implicit end, so build a minimal DisplayTask
        const dt = toDisplayTask(task, startHour);
        // S-AllDay resolved end is next day — should split
        // Actually S-AllDay 05:00→next-day 04:59 crosses boundary
        expect(shouldSplitDisplayTask(dt, startHour)).toBe(false);
    });
});

describe('toDisplayTaskWithSplit', () => {
    it('returns 1 element for non-split task', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '09:00',
            endDate: '2026-01-15',
            endTime: '17:00',
        });
        const result = toDisplayTaskWithSplit(task, startHour);
        expect(result).toHaveLength(1);
        expect(result[0].isSplit).toBe(false);
    });

    it('returns 2 elements for cross-day task', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '22:00',
            endDate: '2026-01-16',
            endTime: '08:00',
        });
        const result = toDisplayTaskWithSplit(task, startHour);
        expect(result).toHaveLength(2);
        expect(result[0].splitContinuesAfter).toBe(true);
        expect(result[0].splitContinuesBefore).toBe(false);
        expect(result[1].splitContinuesBefore).toBe(true);
        expect(result[1].splitContinuesAfter).toBe(false);
    });
});

describe('materializeRawDates', () => {
    it('endTime 有り: visual end → raw inclusive (no +1)', () => {
        const base = makeTask({
            startDate: '2026-05-13', startTime: '07:30',
            endDate: '2026-05-19', endTime: '09:45',
        });
        const updates = materializeRawDates(
            { effectiveEndDate: '2026-05-19' },
            base, startHour,
        );
        expect(updates.endDate).toBe('2026-05-19'); // +1 されない
    });

    it('endTime 無し allday: visual end → raw exclusive (+1)', () => {
        const base = makeTask({
            startDate: '2026-05-04',
            endDate: '2026-05-09', // exclusive raw (visual end = 5/8)
        });
        // visual end は inclusive 5/8
        const updates = materializeRawDates(
            { effectiveEndDate: '2026-05-08' },
            base, startHour,
        );
        expect(updates.endDate).toBe('2026-05-09'); // +1 される
    });

    it('cross-midnight start (startTime < startHour): unshift で +1 day', () => {
        const base = makeTask({
            startDate: '2026-05-13', startTime: '03:00',
            endDate: '2026-05-13', endTime: '04:00',
        });
        // visual start day = 5-12 (3am < startHour 5)
        const updates = materializeRawDates(
            { effectiveStartDate: '2026-05-12', effectiveStartTime: '03:00' },
            base, startHour,
        );
        expect(updates.startDate).toBe('2026-05-13'); // unshift で +1
        expect(updates.startTime).toBe('03:00');
    });

    it('round-trip: endTime 有り task で no-op edit すると base と一致', () => {
        const base = makeTask({
            startDate: '2026-05-13', startTime: '07:30',
            endDate: '2026-05-19', endTime: '09:45',
        });
        const dt = toDisplayTask(base, startHour, NO_TASK_LOOKUP);
        const range = getTaskDateRange(dt, startHour);
        const updates = materializeRawDates(
            {
                effectiveStartDate: range.effectiveStart!,
                effectiveStartTime: dt.effectiveStartTime,
                effectiveEndDate: range.effectiveEnd!,
                effectiveEndTime: dt.effectiveEndTime,
            },
            base, startHour,
        );
        expect(updates.startDate).toBe(base.startDate);
        expect(updates.startTime).toBe(base.startTime);
        expect(updates.endDate).toBe(base.endDate);
        expect(updates.endTime).toBe(base.endTime);
    });

    it('round-trip: pure allday task で no-op edit すると base と一致', () => {
        const base = makeTask({
            startDate: '2026-05-04',
            endDate: '2026-05-09', // exclusive
        });
        const dt = toDisplayTask(base, startHour, NO_TASK_LOOKUP);
        const range = getTaskDateRange(dt, startHour);
        // dt.effectiveEndTime は '04:59' に設定され、visualEnd は前日にシフトする (5/8)
        const updates = materializeRawDates(
            { effectiveEndDate: range.effectiveEnd! },
            base, startHour,
        );
        // edits に effectiveEndTime を含めないので willHaveEndTime=false 経路 → +1
        expect(updates.endDate).toBe(base.endDate); // 5-09 が再構築される
    });

    it('effectiveEndTime を edit で「付ける」と inclusive 経路に切り替わる', () => {
        // base は pure allday (endTime なし、endDate=exclusive 5-09)
        const base = makeTask({
            startDate: '2026-05-04',
            endDate: '2026-05-09',
        });
        // edit で endTime を付ける → willHaveEndTime=true → 不変 (no +1)
        const updates = materializeRawDates(
            { effectiveEndDate: '2026-05-08', effectiveEndTime: '17:00' },
            base, startHour,
        );
        expect(updates.endDate).toBe('2026-05-08');
        expect(updates.endTime).toBe('17:00');
    });

    it('effectiveEndTime を edit で「消す」と exclusive 経路に切り替わる', () => {
        // base は endTime あり (raw endDate=inclusive)
        const base = makeTask({
            startDate: '2026-05-13', startTime: '07:30',
            endDate: '2026-05-19', endTime: '09:45',
        });
        // edit で endTime を空文字で消去 (undefined ではなく明示的に空)
        // ただし現状の DisplayDateEdits は string 型なので空文字での消去は表現できない。
        // ここでは effectiveEndTime を空文字で渡すと willHaveEndTime=false になることを確認。
        const updates = materializeRawDates(
            { effectiveEndDate: '2026-05-19', effectiveEndTime: '' as any },
            base, startHour,
        );
        // willHaveEndTime=false 経路: visual 5-19 → raw 5-20 (exclusive)
        expect(updates.endDate).toBe('2026-05-20');
        expect(updates.endTime).toBe('');
    });

    it('only-startDate 編集はそのまま raw に書く (時刻シフトなし)', () => {
        const base = makeTask({ startDate: '2026-05-13' });
        const updates = materializeRawDates(
            { effectiveStartDate: '2026-05-15' },
            base, startHour,
        );
        expect(updates.startDate).toBe('2026-05-15');
        expect(updates.startTime).toBeUndefined();
        expect(updates.endDate).toBeUndefined();
    });
});
