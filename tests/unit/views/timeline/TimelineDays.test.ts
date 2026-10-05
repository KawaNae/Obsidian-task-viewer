import { describe, it, expect } from 'vitest';
import { TimelineDays, timelineWindow, windowDates, windowEnd } from '../../../../src/views/timelineview/TimelineDays';

describe('timelineWindow', () => {
    it('puts the past days before the day looked at', () => {
        expect(timelineWindow('2026-10-03', 1, 3, null)).toEqual({ start: '2026-10-02', days: 3 });
        expect(timelineWindow('2026-10-03', 0, 7, null)).toEqual({ start: '2026-10-03', days: 7 });
    });

    it('pulls the start back to an earlier overdue day', () => {
        expect(timelineWindow('2026-10-03', 1, 3, '2026-09-20')).toEqual({ start: '2026-09-20', days: 3 });
    });

    it('ignores an overdue day within the lead', () => {
        expect(timelineWindow('2026-10-03', 2, 3, '2026-10-02')).toEqual({ start: '2026-10-01', days: 3 });
    });

    it('crosses months and years', () => {
        expect(timelineWindow('2026-01-01', 2, 3, null).start).toBe('2025-12-30');
    });

    it('lists the days of a window and its end', () => {
        const w = { start: '2026-09-29', days: 3 };
        expect(windowDates(w)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
        expect(windowEnd(w)).toBe('2026-10-01');
    });
});

function setup(opts: { today?: string; past?: number; pulls?: boolean; oldest?: string | null } = {}) {
    const env = {
        today: opts.today ?? '2026-10-03',
        past: opts.past ?? 1,
        pulls: opts.pulls ?? true,
        oldest: opts.oldest ?? null as string | null,
    };
    const days = new TimelineDays({
        today: () => env.today,
        pastDaysToShow: () => env.past,
        pullsToOverdue: () => env.pulls,
        oldestOverdue: () => env.oldest,
    });
    return { env, days };
}

describe('TimelineDays: following today and a fixed day', () => {
    it('follows today when no date is held', () => {
        const { days } = setup();
        expect(days.viewedDay(undefined)).toBe('2026-10-03');
        expect(days.window(undefined, 3)).toEqual({ start: '2026-10-02', days: 3 });
    });

    it('opening with the tasks pulls a following view to the oldest overdue day', () => {
        const { days } = setup({ oldest: '2026-09-25' });
        expect(days.window(undefined, 3).start).toBe('2026-10-02');
        days.settle(undefined);
        expect(days.window(undefined, 3).start).toBe('2026-09-25');
    });

    it('keeps the pull until the next moment of entering following', () => {
        const { env, days } = setup({ oldest: '2026-09-25' });
        days.settle(undefined);
        env.oldest = '2026-09-28';   // the oldest overdue was completed
        expect(days.window(undefined, 3).start).toBe('2026-09-25');
        days.now();
        expect(days.window(undefined, 3).start).toBe('2026-09-28');
    });

    it('does not pull when the setting is off', () => {
        const { days } = setup({ pulls: false, oldest: '2026-09-25' });
        days.settle(undefined);
        expect(days.window(undefined, 3).start).toBe('2026-10-02');
    });

    it('a fixed day is never pulled', () => {
        const { days } = setup({ oldest: '2026-09-25' });
        days.settle(undefined);
        expect(days.window('2026-10-10', 3)).toEqual({ start: '2026-10-09', days: 3 });
        days.settle('2026-10-10');
        expect(days.window('2026-10-10', 3)).toEqual({ start: '2026-10-09', days: 3 });
    });

    it('restoring a saved date opens on that day (setState)', () => {
        const { days } = setup({ oldest: '2026-09-25' });
        days.settle('2026-08-15');
        expect(days.viewedDay('2026-08-15')).toBe('2026-08-15');
        expect(days.window('2026-08-15', 3)).toEqual({ start: '2026-08-14', days: 3 });
    });
});

describe('TimelineDays: commands', () => {
    it('Now clears the date and pulls anew', () => {
        const { days } = setup({ oldest: '2026-09-30' });
        expect(days.now()).toEqual({ date: undefined });
        expect(days.window(undefined, 3).start).toBe('2026-09-30');
    });

    it('go to date looks at the day with the past days before it', () => {
        const { days } = setup({ past: 2 });
        const patch = days.goTo('2026-12-24');
        expect(patch).toEqual({ date: '2026-12-24' });
        expect(days.window(patch.date, 3)).toEqual({ start: '2026-12-22', days: 3 });
    });

    it('an arrow moves the drawn window by n days', () => {
        const { days } = setup();
        const patch = days.moved(undefined, 3, 1);
        expect(patch).toEqual({ date: '2026-10-04' });
        expect(days.window(patch.date, 3).start).toBe('2026-10-03');
        expect(days.window(days.moved(patch.date, 3, -2).date, 3).start).toBe('2026-10-01');
    });

    it('an arrow from a pulled window moves it without a jump', () => {
        const { days } = setup({ oldest: '2026-09-20' });
        days.settle(undefined);
        expect(days.window(undefined, 3).start).toBe('2026-09-20');
        const patch = days.moved(undefined, 3, 1);
        expect(days.window(patch.date, 3).start).toBe('2026-09-21');
        expect(patch.date).toBe('2026-09-22');
    });

    it('the day rolling moves a following view, pulled anew, and scrolls to now', () => {
        const { env, days } = setup({ oldest: null });
        days.settle(undefined);
        env.today = '2026-10-04';
        env.oldest = '2026-10-01';
        expect(days.dayRolled(undefined)).toBe(true);
        expect(days.window(undefined, 3).start).toBe('2026-10-01');
    });

    it('the day rolling leaves a fixed view where it is', () => {
        const { env, days } = setup();
        env.today = '2026-10-04';
        expect(days.dayRolled('2026-09-01')).toBe(false);
        expect(days.window('2026-09-01', 3).start).toBe('2026-08-31');
    });

    it('saving settings shows a new count of past days at once, and pulls anew', () => {
        const { env, days } = setup({ past: 1 });
        expect(days.window(undefined, 3).start).toBe('2026-10-02');
        env.past = 3;
        env.oldest = '2026-09-01';
        days.settle(undefined);   // settings saved while following
        expect(days.window(undefined, 3).start).toBe('2026-09-01');
        env.pulls = false;
        days.settle(undefined);
        expect(days.window(undefined, 3).start).toBe('2026-09-30');
        expect(days.window('2026-10-20', 3).start).toBe('2026-10-17');
    });
});
