import { describe, expect, it } from 'vitest';
import { headerTimeText, timerRing } from '../../../src/timer/TimerRenderer';
import { pomodoroGroups, START_CURSOR } from '../../../src/timer/IntervalMath';
import type { Measure } from '../../../src/timer/TimerProgress';
import type { Session, TimerState } from '../../../src/timer/TimerState';
import type { Clock } from '../../../src/timer/TimerClock';

/**
 * ウィジェットの輪と時間の表示（`TimerRenderer` の `timerRing`、`headerTimeText`）。
 *
 * 走っている間も中断中も、時計の読みを測り方どおりに見せる。中断中の時計は止めた
 * 時点の読みで、countdown とポモドーロは ▶ でそこから続く。countup は ▶ で 0 から
 * 数え直すので、中断中はこれまでの記録の合計を見せる。中断中の色は `suspended`。
 */

const T0 = 1_790_000_000_000;
const COUNTDOWN: Measure = { type: 'countdown', totalSeconds: 1500 };
const POMODORO: Measure = { type: 'interval', source: 'pomodoro', groups: pomodoroGroups(25, 5), at: START_CURSOR };
const SUSPENDED = { kind: 'suspended' } as const;

function timer(measure: Measure, clock: Clock, session: Session, recordedSeconds = 0): TimerState {
    return {
        id: 'timer-1', subject: { kind: 'task', anchor: 'box' }, file: 'notes/a.md', name: 'A', color: '', mode: 'child',
        measure, clock, session, tail: null, owned: [], opening: null,
        recorded: { seconds: recordedSeconds, count: 1 }, priorStartMs: null, draft: null, expanded: true,
    };
}

describe('a suspended timer shows the clock where it stopped, by its measure', () => {
    it('countdown: the time left, in the suspended colour', () => {
        const ring = timerRing(timer(COUNTDOWN, { kind: 'frozen', seconds: 600 }, SUSPENDED, 600), T0);
        expect(ring).toMatchObject({ displaySeconds: 900, ring: 0.6, countupLike: false, tone: 'suspended' });
        expect(headerTimeText(COUNTDOWN, ring)).toBe('15:00');
    });

    it('countdown past zero: below zero, with its sign', () => {
        const ring = timerRing(timer(COUNTDOWN, { kind: 'frozen', seconds: 1800 }, SUSPENDED, 1800), T0);
        expect(ring).toMatchObject({ displaySeconds: -300, countupLike: true, tone: 'suspended' });
        expect(headerTimeText(COUNTDOWN, ring)).toBe('-05:00');
    });

    it('pomodoro: the time left in the segment', () => {
        const ring = timerRing(timer(POMODORO, { kind: 'frozen', seconds: 600 }, SUSPENDED, 600), T0);
        expect(ring).toMatchObject({ displaySeconds: 900, ring: 0.6, countupLike: false, tone: 'suspended' });
        expect(ring.repeatText).not.toBeNull();
        expect(headerTimeText(POMODORO, ring)).toBe('15:00');
    });

    it('countup: the records so far, since ▶ counts from 0 again', () => {
        const countup: Measure = { type: 'countup' };
        const ring = timerRing(timer(countup, { kind: 'frozen', seconds: 300 }, SUSPENDED, 1200), T0);
        expect(ring).toMatchObject({ displaySeconds: 1200, countupLike: true, tone: 'suspended' });
        expect(headerTimeText(countup, ring)).toBe('20:00');
    });
});

describe('a running timer shows its clock now', () => {
    it('countdown: the time left, and past zero below zero', () => {
        const running = (startMs: number) => timer(COUNTDOWN, { kind: 'running', startMs }, { kind: 'running', from: 0 });
        expect(timerRing(running(T0 - 600_000), T0)).toMatchObject({ displaySeconds: 900, tone: 'work' });
        const over = timerRing(running(T0 - 1_800_000), T0);
        expect(over).toMatchObject({ displaySeconds: -300, tone: 'overtime' });
        expect(headerTimeText(COUNTDOWN, over)).toBe('-05:00');
    });
});
