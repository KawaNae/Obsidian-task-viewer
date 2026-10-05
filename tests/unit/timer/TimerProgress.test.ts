import { describe, expect, it } from 'vitest';
import { progressOf, tickOf, type Measure } from '../../../src/timer/TimerProgress';
import { pomodoroGroups, START_CURSOR, type IntervalCursor } from '../../../src/timer/IntervalMath';
import { restart, type Clock } from '../../../src/timer/TimerClock';
import type { IntervalGroup } from '../../../src/timer/IntervalMath';

/**
 * 測り方と時計の読みから表示と出来事を導く。ウィジェットと独立ビューが同じ
 * 関数を使い、音や Notice や記録は呼び手が持つ。
 */

const T0 = 1_700_000_000_000;

function interval(groups: IntervalGroup[], at: Partial<IntervalCursor> = {}): Measure {
    return { type: 'interval', source: 'template', groups, at: { ...START_CURSOR, ...at } };
}

const PREP_WORK: IntervalGroup[] = [{
    repeatCount: 2,
    segments: [
        { label: 'Prepare', durationSeconds: 10, type: 'prepare' },
        { label: 'Work', durationSeconds: 60, type: 'work' },
    ],
}];

describe('progressOf', () => {
    it('countup counts up and turns the ring once in 30 minutes', () => {
        expect(progressOf({ type: 'countup' }, 450)).toEqual({
            displaySeconds: 450, ring: 0.25, countupLike: true, tone: 'work', repeatText: null,
        });
        expect(progressOf({ type: 'countup' }, 1800 + 900).ring).toBe(0.5);
    });

    it('countdown shows what is left of the whole', () => {
        expect(progressOf({ type: 'countdown', totalSeconds: 600 }, 150)).toEqual({
            displaySeconds: 450, ring: 0.75, countupLike: false, tone: 'work', repeatText: null,
        });
    });

    it('countdown past zero counts the overtime like a countup', () => {
        expect(progressOf({ type: 'countdown', totalSeconds: 600 }, 600 + 450)).toEqual({
            displaySeconds: -450, ring: 0.25, countupLike: true, tone: 'overtime', repeatText: null,
        });
    });

    it('interval shows what is left of the segment, in the tone of its type', () => {
        expect(progressOf(interval(PREP_WORK), 5)).toEqual({
            displaySeconds: 5, ring: 0.5, countupLike: false, tone: 'prepare', repeatText: 'Prepare 1/2',
        });
        expect(progressOf(interval(PREP_WORK, { segment: 1, from: 10 }), 25)).toMatchObject({
            displaySeconds: 45, ring: 0.75, tone: 'work', repeatText: 'Work 1/2',
        });
        expect(progressOf(interval(pomodoroGroups(25, 5), { segment: 1, from: 1500 }), 1500).tone).toBe('break');
    });

    it('interval does not go below zero before the segment is moved', () => {
        expect(progressOf(interval(PREP_WORK), 12)).toMatchObject({ displaySeconds: 0, ring: 0 });
    });

    it('interval pointing at nothing is plain and empty', () => {
        expect(progressOf(interval([]), 0)).toEqual({
            displaySeconds: 0, ring: 0, countupLike: false, tone: 'plain', repeatText: '',
        });
    });
});

describe('tickOf', () => {
    const clock = restart(T0);
    const at = (seconds: number) => T0 + seconds * 1000;

    it('a frozen clock has nothing happen', () => {
        const frozen: Clock = { kind: 'frozen', seconds: 9 };
        const measure = { type: 'countdown', totalSeconds: 10 } as const;
        expect(tickOf({ measure, clock: frozen }, at(100), at(99))).toEqual({
            measure, segmentsMoved: 0, finishedAtMs: null, crossedZero: false, warn: false,
        });
    });

    it('countdown crosses zero once, between the last tick and this one', () => {
        const measure: Measure = { type: 'countdown', totalSeconds: 10 };
        expect(tickOf({ measure, clock }, at(10), at(9)).crossedZero).toBe(true);
        expect(tickOf({ measure, clock }, at(12), at(9)).crossedZero).toBe(true);
        expect(tickOf({ measure, clock }, at(11), at(10)).crossedZero).toBe(false);
        expect(tickOf({ measure, clock }, at(9), at(8)).crossedZero).toBe(false);
    });

    it('countdown warns with 1 to 3 seconds left', () => {
        const measure: Measure = { type: 'countdown', totalSeconds: 10 };
        expect(tickOf({ measure, clock }, at(6), at(5)).warn).toBe(false);
        expect(tickOf({ measure, clock }, at(7), at(6)).warn).toBe(true);
        expect(tickOf({ measure, clock }, at(9), at(8)).warn).toBe(true);
        expect(tickOf({ measure, clock }, at(10), at(9)).warn).toBe(false);
    });

    it('countup has nothing happen', () => {
        const measure: Measure = { type: 'countup' };
        expect(tickOf({ measure, clock }, at(5000), at(4999))).toMatchObject({
            measure, segmentsMoved: 0, finishedAtMs: null, crossedZero: false, warn: false,
        });
    });

    it('interval moves the segments used up and warns by the segment it moved to', () => {
        const tick = tickOf({ measure: interval(PREP_WORK), clock }, at(10), at(9));
        expect(tick.segmentsMoved).toBe(1);
        expect(tick.measure).toEqual(interval(PREP_WORK, { segment: 1, from: 10 }));
        expect(tick.warn).toBe(false);
        expect(tick.finishedAtMs).toBeNull();
    });

    it('interval moves several segments at once after a long gap', () => {
        const tick = tickOf({ measure: interval(PREP_WORK), clock }, at(75), at(1));
        expect(tick.segmentsMoved).toBe(2);
        expect(tick.measure).toEqual(interval(PREP_WORK, { repeat: 1, segment: 0, from: 70 }));
    });

    it('interval warns with 1 to 3 seconds left of the segment', () => {
        expect(tickOf({ measure: interval(PREP_WORK), clock }, at(7), at(6)).warn).toBe(true);
        expect(tickOf({ measure: interval(PREP_WORK), clock }, at(6), at(5)).warn).toBe(false);
        // 送った先の区間で見る: 3 秒の区間へ送ると、送った tick で予告する。
        const short: IntervalGroup[] = [{
            repeatCount: 1,
            segments: [
                { label: 'A', durationSeconds: 5, type: 'work' },
                { label: 'B', durationSeconds: 3, type: 'break' },
            ],
        }];
        expect(tickOf({ measure: interval(short), clock }, at(5), at(4))).toMatchObject({ segmentsMoved: 1, warn: true });
    });

    it('interval tells when the last segment ended, at the time it ended', () => {
        const tick = tickOf({ measure: interval(PREP_WORK, { repeat: 1, segment: 1, from: 80 }), clock }, at(200), at(199));
        expect(tick.finishedAtMs).toBe(at(140));
        expect(tick.segmentsMoved).toBe(0);
        expect(tick.warn).toBe(false);
    });
});
