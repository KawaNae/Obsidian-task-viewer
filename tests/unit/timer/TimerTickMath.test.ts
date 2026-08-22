import { describe, expect, it } from 'vitest';
import {
    accumulatePausedElapsed,
    applyCountdownTick,
    applyCountupTick,
    applyIntervalPauseSnapshot,
    applyIntervalTick,
    elapsedSeconds,
} from '../../../src/timer/TimerTickMath';
import type { CountdownTimer, CountupTimer, IntervalTimer } from '../../../src/timer/TimerInstance';

/**
 * 1 秒ごとの経過計算。ウィジェット（TimerLifecycle）と独立ビュー（TimerView）が
 * 同じ関数を呼ぶ。音・Notice・描画・記録は呼び出し側に残るので、ここで見るのは
 * 数値と「何が起きたか」の判定だけ。
 *
 * 時刻は引数で渡す。now を関数の中で読むと固定できない。
 */

const T0 = 1_700_000_000_000;

function countup(overrides: Partial<CountupTimer> = {}): CountupTimer {
    return {
        id: 't', taskId: 't', taskName: '', taskOriginalText: '', taskFile: '',
        startTimeMs: T0, pausedElapsedTime: 0, phase: 'work', isRunning: true,
        runState: 'running', sessionCount: 0, recordedElapsedTime: 0, isExpanded: true,
        intervalId: null, recordMode: 'self', parserId: 'tv-inline', taskColor: '',
        timerType: 'countup', elapsedTime: 0,
        ...overrides,
    };
}

function countdown(overrides: Partial<CountdownTimer> = {}): CountdownTimer {
    return {
        ...countup() as unknown as CountdownTimer,
        timerType: 'countdown', totalTime: 60, timeRemaining: 60, elapsedTime: 0,
        ...overrides,
    };
}

function interval(overrides: Partial<IntervalTimer> = {}): IntervalTimer {
    return {
        ...countup() as unknown as IntervalTimer,
        timerType: 'interval',
        intervalSource: 'pomodoro',
        groups: [{
            repeatCount: 1,
            segments: [
                { label: 'Work', durationSeconds: 60, type: 'work' },
                { label: 'Break', durationSeconds: 30, type: 'break' },
            ],
        }],
        currentGroupIndex: 0, currentSegmentIndex: 0, currentRepeatIndex: 0,
        segmentTimeRemaining: 60, totalElapsedTime: 0, totalDuration: 90,
        ...overrides,
    };
}

describe('elapsedSeconds', () => {
    it('adds the current stretch to what was already accumulated', () => {
        expect(elapsedSeconds(countup({ pausedElapsedTime: 100 }), T0 + 10_000)).toBe(110);
    });

    it('floors partial seconds instead of rounding', () => {
        expect(elapsedSeconds(countup(), T0 + 1_999)).toBe(1);
    });

    it('never goes negative when the clock moved backwards', () => {
        expect(elapsedSeconds(countup(), T0 - 5_000)).toBe(0);
    });
});

describe('accumulatePausedElapsed', () => {
    it('folds the running stretch into pausedElapsedTime', () => {
        const timer = countup({ pausedElapsedTime: 30 });
        accumulatePausedElapsed(timer, T0 + 10_000);
        expect(timer.pausedElapsedTime).toBe(40);
    });

    it('does nothing for a timer that never started', () => {
        const timer = countup({ startTimeMs: 0, pausedElapsedTime: 30 });
        accumulatePausedElapsed(timer, T0);
        expect(timer.pausedElapsedTime).toBe(30);
    });
});

describe('applyCountupTick', () => {
    it('writes the elapsed time', () => {
        const timer = countup();
        applyCountupTick(timer, T0 + 5_000);
        expect(timer.elapsedTime).toBe(5);
    });
});

describe('applyCountdownTick', () => {
    it('counts the remaining time down', () => {
        const timer = countdown();
        expect(applyCountdownTick(timer, T0 + 10_000).remaining).toBe(50);
        expect(timer.elapsedTime).toBe(10);
    });

    it('warns inside the last 3 seconds', () => {
        expect(applyCountdownTick(countdown(), T0 + 57_000).warn).toBe(true);
        expect(applyCountdownTick(countdown(), T0 + 56_000).warn).toBe(false);
    });

    it('does not warn once the remaining time hits 0', () => {
        expect(applyCountdownTick(countdown(), T0 + 60_000).warn).toBe(false);
    });

    it('reports crossing zero exactly once', () => {
        const timer = countdown();
        expect(applyCountdownTick(timer, T0 + 60_000).crossedZero).toBe(true);
        // 超過はそのまま数え続ける。2 度目の tick で鳴らし直さない。
        expect(applyCountdownTick(timer, T0 + 70_000).crossedZero).toBe(false);
        expect(timer.timeRemaining).toBe(-10);
    });

    it('leaves phase alone — the caller decides what it means', () => {
        const timer = countdown({ phase: 'work' });
        applyCountdownTick(timer, T0 + 90_000);
        expect(timer.phase).toBe('work');
    });
});

describe('applyIntervalTick', () => {
    it('counts the current segment down and accumulates the total', () => {
        const timer = interval();
        expect(applyIntervalTick(timer, T0 + 20_000).outcome).toBe('running');
        expect(timer.segmentTimeRemaining).toBe(40);
        expect(timer.totalElapsedTime).toBe(20);
    });

    it('warns inside the last 3 seconds of the segment', () => {
        expect(applyIntervalTick(interval(), T0 + 57_000).warn).toBe(true);
        expect(applyIntervalTick(interval(), T0 + 56_000).warn).toBe(false);
    });

    it('reports the segment as complete instead of overrunning it', () => {
        const timer = interval();
        const tick = applyIntervalTick(timer, T0 + 61_000);
        expect(tick.outcome).toBe('segment-complete');
        expect(timer.segmentTimeRemaining).toBe(0);
    });

    it('caps the total at the interval length', () => {
        const timer = interval({ currentSegmentIndex: 1 });
        applyIntervalTick(timer, T0 + 999_000);
        expect(timer.totalElapsedTime).toBe(90);
    });

    it('reports no-segment when the cursor points past the end', () => {
        expect(applyIntervalTick(interval({ currentSegmentIndex: 2 }), T0).outcome).toBe('no-segment');
    });
});

describe('applyIntervalPauseSnapshot', () => {
    it('rebuilds the segment display from the accumulated time', () => {
        const timer = interval({ pausedElapsedTime: 25, segmentTimeRemaining: 0, totalElapsedTime: 0 });
        applyIntervalPauseSnapshot(timer);
        expect(timer.segmentTimeRemaining).toBe(35);
        expect(timer.totalElapsedTime).toBe(25);
    });

    it('counts the segments already finished', () => {
        const timer = interval({ currentSegmentIndex: 1, pausedElapsedTime: 10 });
        applyIntervalPauseSnapshot(timer);
        expect(timer.segmentTimeRemaining).toBe(20);
        expect(timer.totalElapsedTime).toBe(70);
    });
});
