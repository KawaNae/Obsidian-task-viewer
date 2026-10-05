import { describe, expect, it } from 'vitest';
import {
    advance,
    defaultSegmentLabel,
    formatTotalDuration,
    pomodoroGroups,
    repeatText,
    segmentAt,
    START_CURSOR,
    totalDuration,
    type IntervalCursor,
    type IntervalGroup,
} from '../../../src/timer/IntervalMath';

/**
 * 区間の計算。ウィジェットと独立ビュー（TimerView）が同じ口（advance、segmentAt、
 * repeatText、totalDuration、formatTotalDuration、pomodoroGroups）を使う。
 *
 * カーソルはプレーンなオブジェクトで渡せるので、ここではタイマーを組み立てない。
 */

function pomodoro(repeatCount: number): IntervalGroup {
    return {
        repeatCount,
        segments: [
            { label: 'Work', durationSeconds: 1500, type: 'work' },
            { label: 'Break', durationSeconds: 300, type: 'break' },
        ],
    };
}

describe('totalDuration', () => {
    it('multiplies each group by its repeat count', () => {
        expect(totalDuration([pomodoro(2), pomodoro(1)])).toBe(5400);
    });

    it('is 0 (no upper bound) when any group repeats forever', () => {
        expect(totalDuration([pomodoro(0), pomodoro(3)])).toBe(0);
    });
});

function at(overrides: Partial<IntervalCursor> = {}): IntervalCursor {
    return { ...START_CURSOR, ...overrides };
}

describe('segmentAt', () => {
    it('returns the segment the cursor points at, or null past the end', () => {
        expect(segmentAt([pomodoro(1)], at({ segment: 1 }))?.type).toBe('break');
        expect(segmentAt([pomodoro(1)], at({ segment: 2 }))).toBeNull();
        expect(segmentAt([], at())).toBeNull();
    });
});

describe('advance', () => {
    it('stays while the segment has time left', () => {
        expect(advance([pomodoro(2)], at(), 1499)).toEqual({ at: at(), moved: 0, done: null });
    });

    it('moves to the next segment once the clock reaches the end of this one, from where it ended', () => {
        expect(advance([pomodoro(2)], at(), 1500)).toEqual({ at: at({ segment: 1, from: 1500 }), moved: 1, done: null });
    });

    it('moves every segment used up at once', () => {
        // work 1500 + break 300 + work 1500 = 3300。3400 は 2 周目の break の途中。
        expect(advance([pomodoro(2)], at(), 3400)).toEqual({
            at: at({ repeat: 1, segment: 1, from: 3300 }),
            moved: 3,
            done: null,
        });
    });

    it('counts from the cursor, not from the start of the whole run', () => {
        // 前の区間の長さが後で変わっても、from から数える。
        const groups = [pomodoro(0)];
        expect(advance(groups, at({ segment: 1, from: 1000 }), 1299).moved).toBe(0);
        expect(advance(groups, at({ segment: 1, from: 1000 }), 1300).at).toEqual(at({ repeat: 1, segment: 0, from: 1300 }));
    });

    it('never runs out when the group repeats forever', () => {
        const result = advance([pomodoro(0)], at({ repeat: 99, segment: 1 }), 300);
        expect(result.done).toBeNull();
        expect(result.at).toEqual(at({ repeat: 100, segment: 0, from: 300 }));
    });

    it('repeats a group max(1, n) times and then moves to the next group', () => {
        const groups = [pomodoro(1), pomodoro(1)];
        expect(advance(groups, at(), 1800).at).toEqual(at({ group: 1, from: 1800 }));
        expect(advance([pomodoro(-3)], at(), 1800).done).toBe(1800);
    });

    it('answers done with the clock reading at the end of the last segment', () => {
        const result = advance([pomodoro(2)], at(), 99_999);
        expect(result.done).toBe(3600);
        expect(result.moved).toBe(3);
        expect(result.at).toEqual(at({ repeat: 1, segment: 1, from: 3300 }));
    });

    it('is done where it stands when the cursor points at nothing', () => {
        expect(advance([], at({ from: 42 }), 100)).toEqual({ at: at({ from: 42 }), moved: 0, done: 42 });
    });

    it('passes one zero-length segment per call, so a loop of them does not hang', () => {
        const groups: IntervalGroup[] = [{
            repeatCount: 0,
            segments: [{ label: 'Z', durationSeconds: 0, type: 'work' }],
        }];
        expect(advance(groups, at(), 10)).toEqual({ at: at({ repeat: 1 }), moved: 1, done: null });
    });
});

describe('repeatText', () => {
    it('says the round out of the count when the group ends', () => {
        expect(repeatText([pomodoro(4)], at({ repeat: 1 }))).toBe('Work 2/4');
    });

    it('says only the round when the group repeats forever', () => {
        expect(repeatText([pomodoro(0)], at({ repeat: 2, segment: 1 }))).toBe('Break 3');
    });

    it('is empty when the cursor points at nothing', () => {
        expect(repeatText([pomodoro(1)], at({ segment: 5 }))).toBe('');
    });
});

describe('formatTotalDuration', () => {
    it('writes hours and minutes', () => {
        expect(formatTotalDuration([pomodoro(3)])).toBe('1h 30m');
        expect(formatTotalDuration([pomodoro(2)])).toBe('1h');
        expect(formatTotalDuration([pomodoro(1)])).toBe('30m');
    });

    it('writes ∞ when any group repeats forever', () => {
        expect(formatTotalDuration([pomodoro(1), pomodoro(0)])).toBe('∞');
    });
});

describe('pomodoroGroups', () => {
    it('builds work and break from the minutes and repeats forever', () => {
        expect(pomodoroGroups(25, 5)).toEqual([pomodoro(0)]);
    });
});

describe('defaultSegmentLabel', () => {
    it('names a segment by its type', () => {
        expect(defaultSegmentLabel('prepare')).toBe('Prepare');
        expect(defaultSegmentLabel('work')).toBe('Work');
        expect(defaultSegmentLabel('break')).toBe('Break');
    });
});
