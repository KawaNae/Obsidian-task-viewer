import { describe, expect, it } from 'vitest';
import { legacyProgress } from '../../../src/timer/TimerProgressUI';
import type { CountdownTimer, CountupTimer, IntervalTimer } from '../../../src/timer/TimerInstance';

/**
 * ウィジェットのタイマーを輪の状態に読む一時的な口。輪の色は phase の 'idle' を
 * 中断（suspended）、countdown の超過（overtime）、それ以外（plain）に分け、ほかの
 * 数は今の描画のとおり。
 */

function countup(overrides: Partial<CountupTimer> = {}): CountupTimer {
    return {
        id: 't', taskId: 't', taskName: '', taskOriginalText: '', taskFile: '',
        startTimeMs: 0, pausedElapsedTime: 0, phase: 'work', isRunning: true,
        runState: 'running', sessionCount: 0, recordedElapsedTime: 0, isExpanded: true,
        intervalId: null, recordMode: 'self', parserId: 'tv-inline', taskColor: '',
        timerType: 'countup', elapsedTime: 0,
        ...overrides,
    };
}

function countdown(overrides: Partial<CountdownTimer> = {}): CountdownTimer {
    return {
        ...countup() as unknown as CountdownTimer,
        timerType: 'countdown', totalTime: 600, timeRemaining: 600, elapsedTime: 0,
        ...overrides,
    };
}

function interval(overrides: Partial<IntervalTimer> = {}): IntervalTimer {
    return {
        ...countup() as unknown as IntervalTimer,
        timerType: 'interval',
        intervalSource: 'pomodoro',
        groups: [{
            repeatCount: 4,
            segments: [
                { label: 'Work', durationSeconds: 1500, type: 'work' },
                { label: 'Break', durationSeconds: 300, type: 'break' },
            ],
        }],
        currentGroupIndex: 0, currentSegmentIndex: 1, currentRepeatIndex: 1,
        segmentTimeRemaining: 75, totalElapsedTime: 0, totalDuration: 7200,
        phase: 'break',
        ...overrides,
    };
}

describe('legacyProgress', () => {
    it('a suspended timer shows what was recorded, in the suspended tone', () => {
        expect(legacyProgress(countup({ runState: 'suspended', isRunning: false, phase: 'idle', recordedElapsedTime: 450 })))
            .toEqual({ ring: 0.25, displaySeconds: 450, tone: 'suspended', countupLike: true, repeatText: null });
    });

    it('a running countup is in the work tone; one not yet started is plain', () => {
        expect(legacyProgress(countup({ elapsedTime: 450 })).tone).toBe('work');
        expect(legacyProgress(countup({ phase: 'idle', isRunning: false })).tone).toBe('plain');
    });

    it('a countdown past zero is in the overtime tone', () => {
        expect(legacyProgress(countdown({ phase: 'idle', timeRemaining: -450 })))
            .toEqual({ ring: 0.25, displaySeconds: -450, tone: 'overtime', countupLike: true, repeatText: null });
        expect(legacyProgress(countdown({ timeRemaining: 150 })))
            .toEqual({ ring: 0.25, displaySeconds: 150, tone: 'work', countupLike: false, repeatText: null });
    });

    it('an interval shows the segment left and the round', () => {
        expect(legacyProgress(interval()))
            .toEqual({ ring: 0.25, displaySeconds: 75, tone: 'break', countupLike: false, repeatText: 'Break 2/4' });
    });
});
