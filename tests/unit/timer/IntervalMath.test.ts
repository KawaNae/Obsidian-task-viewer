import { describe, expect, it } from 'vitest';
import {
    advanceSegment,
    clampToTotalDuration,
    computeCompletedDuration,
    computeTotalDuration,
    getCurrentSegment,
    normalizeGroups,
    type IntervalCursor,
} from '../../../src/timer/IntervalMath';
import type { IntervalGroup } from '../../../src/timer/TimerInstance';

/**
 * 区間の進行と経過の計算。ウィジェット（TimerLifecycle / TimerPersistence /
 * TimerRenderer）と独立ビュー（TimerView）が同じ関数を呼ぶ。以前は両者が別々に
 * 同じ計算を持っていて、片方を直しても他方は直らなかった。
 *
 * カーソルはプレーンなオブジェクトで渡せるので、ここではタイマーを組み立てない。
 */

const DEFAULTS = { prepareSeconds: 10, workSeconds: 1500, breakSeconds: 300 };

function pomodoro(repeatCount: number): IntervalGroup {
    return {
        repeatCount,
        segments: [
            { label: 'Work', durationSeconds: 1500, type: 'work' },
            { label: 'Break', durationSeconds: 300, type: 'break' },
        ],
    };
}

function cursor(groups: IntervalGroup[], overrides: Partial<IntervalCursor> = {}): IntervalCursor {
    return { groups, currentGroupIndex: 0, currentSegmentIndex: 0, currentRepeatIndex: 0, ...overrides };
}

describe('getCurrentSegment', () => {
    it('returns the segment the cursor points at', () => {
        expect(getCurrentSegment(cursor([pomodoro(1)], { currentSegmentIndex: 1 }))?.type).toBe('break');
    });

    it('returns null past the end instead of throwing', () => {
        expect(getCurrentSegment(cursor([pomodoro(1)], { currentSegmentIndex: 2 }))).toBeNull();
        expect(getCurrentSegment(cursor([], {}))).toBeNull();
    });
});

describe('advanceSegment', () => {
    it('walks to the next segment of the same group', () => {
        const c = cursor([pomodoro(2)]);
        expect(advanceSegment(c)).toBe(true);
        expect(c.currentSegmentIndex).toBe(1);
        expect(c.currentRepeatIndex).toBe(0);
    });

    it('starts the next repeat once the group runs out', () => {
        const c = cursor([pomodoro(2)], { currentSegmentIndex: 1 });
        expect(advanceSegment(c)).toBe(true);
        expect(c.currentRepeatIndex).toBe(1);
        expect(c.currentSegmentIndex).toBe(0);
    });

    it('stops after the last repeat of the last group', () => {
        const c = cursor([pomodoro(2)], { currentSegmentIndex: 1, currentRepeatIndex: 1 });
        expect(advanceSegment(c)).toBe(false);
        // 進めなかったときはカーソルを動かさない。
        expect(c.currentRepeatIndex).toBe(1);
        expect(c.currentSegmentIndex).toBe(1);
    });

    it('never runs out when the group repeats forever', () => {
        const c = cursor([pomodoro(0)], { currentSegmentIndex: 1, currentRepeatIndex: 99 });
        expect(advanceSegment(c)).toBe(true);
        expect(c.currentRepeatIndex).toBe(100);
    });

    it('moves to the next group and resets the repeat counter', () => {
        const c = cursor([pomodoro(1), pomodoro(1)], { currentSegmentIndex: 1 });
        expect(advanceSegment(c)).toBe(true);
        expect(c.currentGroupIndex).toBe(1);
        expect(c.currentRepeatIndex).toBe(0);
        expect(c.currentSegmentIndex).toBe(0);
    });
});

describe('computeCompletedDuration', () => {
    it('counts the segments already finished in this repeat', () => {
        expect(computeCompletedDuration(cursor([pomodoro(2)], { currentSegmentIndex: 1 }))).toBe(1500);
    });

    it('counts the finished repeats of the current group', () => {
        expect(computeCompletedDuration(cursor([pomodoro(3)], { currentRepeatIndex: 2 }))).toBe(3600);
    });

    it('counts every repeat of the groups already passed', () => {
        const c = cursor([pomodoro(2), pomodoro(1)], { currentGroupIndex: 1 });
        expect(computeCompletedDuration(c)).toBe(3600);
    });

    it('counts only the repeats actually done for a group that repeats forever', () => {
        // 無限グループは「あと何周」が無いので、済んだ周だけを数える。
        expect(computeCompletedDuration(cursor([pomodoro(0)], { currentRepeatIndex: 2 }))).toBe(3600);
    });
});

describe('computeTotalDuration', () => {
    it('multiplies each group by its repeat count', () => {
        expect(computeTotalDuration([pomodoro(2), pomodoro(1)])).toBe(5400);
    });

    it('is 0 (no upper bound) when any group repeats forever', () => {
        expect(computeTotalDuration([pomodoro(0), pomodoro(3)])).toBe(0);
    });
});

describe('clampToTotalDuration', () => {
    it('caps the value at the total', () => {
        expect(clampToTotalDuration(1800, 2000)).toBe(1800);
    });

    it('lets the value through when there is no upper bound', () => {
        expect(clampToTotalDuration(0, 2000)).toBe(2000);
    });
});

describe('normalizeGroups', () => {
    it('floors durations to whole seconds and to at least 1', () => {
        const [group] = normalizeGroups(
            [{ repeatCount: 1, segments: [{ label: 'W', durationSeconds: 1.9, type: 'work' }] }],
            DEFAULTS,
        );
        expect(group.segments[0].durationSeconds).toBe(1);
    });

    it('fills an empty label from the segment type', () => {
        const [group] = normalizeGroups(
            [{ repeatCount: 1, segments: [{ label: '  ', durationSeconds: 60, type: 'break' }] }],
            DEFAULTS,
        );
        expect(group.segments[0].label).toBe('Break');
    });

    it('keeps 0 as "repeat forever" instead of rounding it up to 1', () => {
        expect(normalizeGroups([pomodoro(0)], DEFAULTS)[0].repeatCount).toBe(0);
    });

    it('drops a group that has no segment at all', () => {
        const groups = normalizeGroups(
            [{ repeatCount: 1, segments: [] }, pomodoro(1)],
            DEFAULTS,
        );
        expect(groups).toHaveLength(1);
        expect(groups[0].segments).toHaveLength(2);
    });

    it('lifts a zero-length segment to 1 second rather than dropping it', () => {
        // 長さは先に max(1, floor(v)) を通るので、0 秒の区間は消えずに 1 秒になる。
        const [group] = normalizeGroups(
            [{ repeatCount: 1, segments: [{ label: 'W', durationSeconds: 0, type: 'work' }] }],
            DEFAULTS,
        );
        expect(group.segments[0].durationSeconds).toBe(1);
    });

    it('falls back to the caller-supplied defaults when nothing survives', () => {
        const [group] = normalizeGroups(undefined, DEFAULTS);
        expect(group.segments.map((s) => s.type)).toEqual(['prepare', 'work', 'break']);
        expect(group.segments.map((s) => s.durationSeconds)).toEqual([10, 1500, 300]);
        expect(group.repeatCount).toBe(1);
    });
});
