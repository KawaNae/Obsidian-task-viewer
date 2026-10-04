import { describe, it, expect } from 'vitest';
import {
    NO_TASK_LOOKUP,
    materializeRawDates,
    shouldSplitDisplayTask,
    splitDisplayTaskAtBoundary,
    toDisplayTask,
} from '../../../src/services/display/DisplayTaskConverter';
import { classifyForSection } from '../../../src/services/display/SectionClassifier';
import { dayStart, instantText, visualDaysOf } from '../../../src/utils/DayWindow';
import type { DisplayTask, Task, TaskSpan } from '../../../src/types';

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
        originalText: '- [ ] test task @2026-01-15',
        parserId: 'tv-inline',
        ...overrides,
    };
}

const startHour = 5; // default 5:00

function shown(overrides: Partial<Task>): DisplayTask {
    return toDisplayTask(makeTask(overrides), startHour, NO_TASK_LOOKUP);
}

/** A span's moments as `YYYY-MM-DD HH:mm` on the wall clock. */
function moments(span: TaskSpan | null): { start: string; end: string } | null {
    if (!span) return null;
    const text = (ms: number) => { const { date, time } = instantText(ms); return `${date} ${time}`; };
    return { start: text(span.startMs), end: text(span.endMs) };
}

describe('toDisplayTask', () => {
    it('resolves S-type (date only) to all-day', () => {
        const dt = shown({ startDate: '2026-01-15' });
        expect(moments(dt.span)).toEqual({ start: '2026-01-15 05:00', end: '2026-01-16 05:00' });
        // Only what is written is stated; the rest the rules fill in on the span.
        expect(dt.stated).toEqual({ startDate: '2026-01-15' });
        expect(dt.drawn).toEqual(dt.span);
        expect(dt.dueMs).toBeNull();
    });

    it('resolves S-Timed (date + time) with 1h default duration', () => {
        const dt = shown({ startDate: '2026-01-15', startTime: '09:00' });
        expect(moments(dt.span)).toEqual({ start: '2026-01-15 09:00', end: '2026-01-15 10:00' });
        expect(dt.stated).toEqual({ startDate: '2026-01-15', startTime: '09:00' });
    });

    it('resolves SE-Timed (full range)', () => {
        const dt = shown({
            startDate: '2026-01-15',
            startTime: '09:00',
            endDate: '2026-01-15',
            endTime: '17:00',
        });
        expect(moments(dt.span)).toEqual({ start: '2026-01-15 09:00', end: '2026-01-15 17:00' });
        expect(dt.stated).toEqual({
            startDate: '2026-01-15', startTime: '09:00', endDate: '2026-01-15', endTime: '17:00',
        });
    });

    it('resolves E-Timed (endDate + endTime, no start) — 1h before end', () => {
        const dt = shown({
            endDate: '2026-01-15',
            endTime: '10:00',
        });
        expect(moments(dt.span)).toEqual({ start: '2026-01-15 09:00', end: '2026-01-15 10:00' });
        expect(dt.stated.startDate).toBeUndefined();
        expect(dt.stated.startTime).toBeUndefined();
    });

    it('resolves E-AllDay (endDate only)', () => {
        const dt = shown({ endDate: '2026-01-15' });
        expect(moments(dt.span)).toEqual({ start: '2026-01-15 05:00', end: '2026-01-16 05:00' });
        expect(dt.stated.startDate).toBeUndefined();
    });

    it('resolves S with endTime (same-day end)', () => {
        const dt = shown({
            startDate: '2026-01-15',
            startTime: '09:00',
            endTime: '12:00',
        });
        expect(moments(dt.span)).toEqual({ start: '2026-01-15 09:00', end: '2026-01-15 12:00' });
        expect(dt.stated.endDate).toBeUndefined();
        expect(dt.stated.endTime).toBe('12:00');
    });

    it('resolves SE with endDate no endTime', () => {
        const dt = shown({
            startDate: '2026-01-15',
            endDate: '2026-01-17',
        });
        expect(moments(dt.span)?.end).toBe('2026-01-18 05:00');
        expect(dt.stated.endTime).toBeUndefined();
    });

    it('sets isSplit false and originalTaskId', () => {
        const task = makeTask({ startDate: '2026-01-15' });
        const dt = toDisplayTask(task, startHour, NO_TASK_LOOKUP);
        expect(dt.isSplit).toBe(false);
        expect(dt.originalTaskId).toBe(task.id);
    });

    it('uses cascadeContext startDate when task has no startDate', () => {
        const dt = shown({
            startDate: undefined,
            cascadeContext: { startDate: '2026-01-15' },
        });
        expect(moments(dt.span)?.start).toBe('2026-01-15 05:00');
        expect(dt.stated.startDate).toBe('2026-01-15');
        expect(dt.startDate).toBeUndefined();
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
        const dt = toDisplayTask(task, startHour, NO_TASK_LOOKUP);
        expect(shouldSplitDisplayTask(dt, startHour)).toBe(false);
    });

    it('returns true for cross-day task', () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '22:00',
            endDate: '2026-01-16',
            endTime: '08:00',
        });
        const dt = toDisplayTask(task, startHour, NO_TASK_LOOKUP);
        expect(shouldSplitDisplayTask(dt, startHour)).toBe(true);
    });

    it('returns false for an all-day task', () => {
        const task = makeTask({ startDate: '2026-01-15' });
        // toDisplayTask resolves implicit end, so build a minimal DisplayTask
        const dt = toDisplayTask(task, startHour, NO_TASK_LOOKUP);
        // S-AllDay 05:00 → next-day 05:00 is one visual day, and all-day is never split
        expect(shouldSplitDisplayTask(dt, startHour)).toBe(false);
    });
});

describe('splitDisplayTaskAtBoundary', () => {
    it('leaves each half open only towards the other', () => {
        // Which end of a segment continues is what the card's notched corner
        // reads: the head runs off its day forward, the tail arrives from
        // behind, and neither claims the side it actually ends on.
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '22:00',
            endDate: '2026-01-16',
            endTime: '08:00',
        });
        const [head, tail] = splitDisplayTaskAtBoundary(toDisplayTask(task, startHour, NO_TASK_LOOKUP), startHour);

        expect(head.splitContinuesAfter).toBe(true);
        expect(head.splitContinuesBefore).toBe(false);
        expect(tail.splitContinuesBefore).toBe(true);
        expect(tail.splitContinuesAfter).toBe(false);
    });

    it("keeps the line's values, stated and span on both halves, and cuts only drawn at the day's start", () => {
        const task = makeTask({
            startDate: '2026-01-15',
            startTime: '22:00',
            endDate: '2026-01-16',
            endTime: '08:00',
        });
        const dt = toDisplayTask(task, startHour, NO_TASK_LOOKUP);
        const [head, tail] = splitDisplayTaskAtBoundary(dt, startHour);
        const boundary = dayStart('2026-01-16', startHour);

        for (const segment of [head, tail]) {
            expect(segment.startDate).toBe('2026-01-15');
            expect(segment.startTime).toBe('22:00');
            expect(segment.endDate).toBe('2026-01-16');
            expect(segment.endTime).toBe('08:00');
            expect(segment.stated).toEqual(dt.stated);
            expect(segment.span).toEqual(dt.span);
        }
        expect(head.drawn).toEqual({ startMs: dt.span!.startMs, endMs: boundary });
        expect(tail.drawn).toEqual({ startMs: boundary, endMs: dt.span!.endMs });
        expect(visualDaysOf(head.drawn!, startHour)).toEqual({ first: '2026-01-15', last: '2026-01-15' });
        expect(visualDaysOf(tail.drawn!, startHour)).toEqual({ first: '2026-01-16', last: '2026-01-16' });
    });
});

describe('materializeRawDates', () => {
    it('endTime 有り: 見た目の最後の日を書く', () => {
        const base = makeTask({
            startDate: '2026-05-13', startTime: '07:30',
            endDate: '2026-05-19', endTime: '09:45',
        });
        const updates = materializeRawDates(
            { endDay: '2026-05-19' },
            base, startHour,
        );
        expect(updates.endDate).toBe('2026-05-19');
    });

    it('endTime 無し allday: 見た目の最後の日をそのまま書く', () => {
        const base = makeTask({
            startDate: '2026-05-04',
            endDate: '2026-05-08',
        });
        const updates = materializeRawDates(
            { endDay: '2026-05-10' },
            base, startHour,
        );
        expect(updates.endDate).toBe('2026-05-10');
    });

    it('startHour 0 でも見た目の最後の日をそのまま書く', () => {
        const base = makeTask({ startDate: '2026-05-04', endDate: '2026-05-08' });
        expect(materializeRawDates({ endDay: '2026-05-10' }, base, 0).endDate).toBe('2026-05-10');
        const dt = toDisplayTask(base, 0, NO_TASK_LOOKUP);
        expect(visualDaysOf(dt.drawn!, 0).last).toBe('2026-05-08');
    });

    it('cross-midnight start (startTime < startHour): unshift で +1 day', () => {
        const base = makeTask({
            startDate: '2026-05-13', startTime: '03:00',
            endDate: '2026-05-13', endTime: '04:00',
        });
        // visual start day = 5-12 (3am < startHour 5)
        const updates = materializeRawDates(
            { startDay: '2026-05-12', startTime: '03:00' },
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
        const days = visualDaysOf(dt.drawn!, startHour);
        const updates = materializeRawDates(
            {
                startDay: days.first,
                startTime: instantText(dt.span!.startMs).time,
                endDay: days.last,
                endTime: instantText(dt.span!.endMs).time,
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
            endDate: '2026-05-08',
        });
        const dt = toDisplayTask(base, startHour, NO_TASK_LOOKUP);
        // span は 5/9 05:00 で終わり、その前の瞬間の visual day は 5/8
        const days = visualDaysOf(dt.drawn!, startHour);
        expect(days.last).toBe('2026-05-08');
        const updates = materializeRawDates(
            { endDay: days.last },
            base, startHour,
        );
        expect(updates.endDate).toBe(base.endDate);
    });

    it('endTime を edit で付けると、その日付と時刻を書く', () => {
        const base = makeTask({
            startDate: '2026-05-04',
            endDate: '2026-05-08',
        });
        const updates = materializeRawDates(
            { endDay: '2026-05-08', endTime: '17:00' },
            base, startHour,
        );
        expect(updates.endDate).toBe('2026-05-08');
        expect(updates.endTime).toBe('17:00');
    });

    it('endTime を edit で消すと、見た目の最後の日をそのまま書く', () => {
        const base = makeTask({
            startDate: '2026-05-13', startTime: '07:30',
            endDate: '2026-05-19', endTime: '09:45',
        });
        // 空文字の endTime は時刻を消す
        const updates = materializeRawDates(
            { endDay: '2026-05-19', endTime: '' as any },
            base, startHour,
        );
        expect(updates.endDate).toBe('2026-05-19');
        expect(updates.endTime).toBe('');
    });

    it('only-startDate 編集はそのまま raw に書く (時刻シフトなし)', () => {
        const base = makeTask({ startDate: '2026-05-13' });
        const updates = materializeRawDates(
            { startDay: '2026-05-15' },
            base, startHour,
        );
        expect(updates.startDate).toBe('2026-05-15');
        expect(updates.startTime).toBeUndefined();
        expect(updates.endDate).toBeUndefined();
    });
});

/**
 * 継承（cascadeContext）由来の日時は、タスク行に書かれた日時と同じ解決を
 * 受ける。以前は暗黙 end の解決が raw フィールドだけを見ていたため、
 * セクションから継承した時刻が「時刻として」効かず、timed であるべき
 * タスクが 23h59m の allDay になっていた。
 */
describe('toDisplayTask — cascade 継承日時の解決', () => {
    it('継承 startTime + raw startDate は timed（既定 1h）になる', () => {
        const dt = shown({
            startDate: '2026-01-15',
            cascadeContext: { startTime: '09:00' },
        });
        expect(moments(dt.span)).toEqual({ start: '2026-01-15 09:00', end: '2026-01-15 10:00' });
        expect(classifyForSection(dt, startHour)).toBe('timed');
        expect(visualDaysOf(dt.drawn!, startHour)).toEqual({ first: '2026-01-15', last: '2026-01-15' });
    });

    it('日付も時刻も継承（セクション tv-start:: 06:00 + ファイル tv-start）でも timed', () => {
        const dt = shown({
            cascadeContext: { startDate: '2026-06-30', startTime: '06:00' },
        });
        expect(moments(dt.span)).toEqual({ start: '2026-06-30 06:00', end: '2026-06-30 07:00' });
        expect(classifyForSection(dt, startHour)).toBe('timed');
    });

    it('継承 endTime + raw endDate は捨てられない', () => {
        const dt = shown({
            endDate: '2026-01-15',
            cascadeContext: { endTime: '10:00' },
        });
        // E-Timed: 終端の 1 時間前が暗黙の開始
        expect(moments(dt.span)).toEqual({ start: '2026-01-15 09:00', end: '2026-01-15 10:00' });
        expect(classifyForSection(dt, startHour)).toBe('timed');
    });

    it('継承 endDate のみのタスクはどのセクションからも消えない', () => {
        const dt = shown({
            cascadeContext: { endDate: '2026-01-15', endTime: '10:00' },
        });
        expect(moments(dt.span)?.start).toBe('2026-01-15 09:00');
        expect(classifyForSection(dt, startHour)).not.toBeNull();
        expect(visualDaysOf(dt.drawn!, startHour).first).toBe('2026-01-15');
    });

    it('時刻なしの継承 endDate はその日の allDay', () => {
        const dt = shown({ cascadeContext: { endDate: '2026-01-15' } });
        expect(moments(dt.span)?.end).toBe('2026-01-16 05:00');
        expect(classifyForSection(dt, startHour)).toBe('allDay');
    });

    it('raw と継承で結果が一致する（同じ値ならどちらに書いても同じ）', () => {
        const raw = shown({ startDate: '2026-01-15', startTime: '09:00' });
        const cascaded = shown({ cascadeContext: { startDate: '2026-01-15', startTime: '09:00' } });
        expect(cascaded.stated).toEqual(raw.stated);
        expect(cascaded.span).toEqual(raw.span);
    });

    it('生の値は行に書かれたまま（継承値は stated にだけ入り、placeholder 表示になる）', () => {
        const dt = shown({
            startDate: '2026-01-15',
            cascadeContext: { startTime: '09:00' },
        });
        expect(dt.startDate).toBe('2026-01-15');
        expect(dt.startTime).toBeUndefined();
        expect(dt.stated).toEqual({ startDate: '2026-01-15', startTime: '09:00' });
    });
});
