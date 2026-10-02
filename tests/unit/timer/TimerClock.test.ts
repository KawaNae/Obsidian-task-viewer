import { describe, expect, it } from 'vitest';
import { freeze, msAt, readSeconds, restart, resume, shift } from '../../../src/timer/TimerClock';

/**
 * 時計は走っているか止まっているかの2つの形で、経過は読むたびに時刻から求める。
 * 時刻は引数で渡す。
 */

const T0 = 1_700_000_000_000;

describe('TimerClock', () => {
    it('reads whole seconds since the start while running', () => {
        expect(readSeconds(restart(T0), T0 + 2_999)).toBe(2);
        expect(readSeconds(restart(T0), T0 + 3_000)).toBe(3);
    });

    it('reads 0 before the start', () => {
        expect(readSeconds(restart(T0), T0 - 5_000)).toBe(0);
    });

    it('freezes at the reading of the moment and stays there', () => {
        const frozen = freeze(restart(T0), T0 + 70_500);
        expect(frozen).toEqual({ kind: 'frozen', seconds: 70 });
        expect(readSeconds(frozen, T0 + 999_000)).toBe(70);
        expect(freeze(frozen, T0 + 999_000)).toBe(frozen);
    });

    it('resumes from the frozen reading', () => {
        const resumed = resume({ kind: 'frozen', seconds: 70 }, T0);
        expect(readSeconds(resumed, T0)).toBe(70);
        expect(readSeconds(resumed, T0 + 5_000)).toBe(75);
        expect(resume(resumed, T0 + 9_000)).toBe(resumed);
    });

    it('shifts the start of a running clock and leaves a frozen one alone', () => {
        expect(readSeconds(shift(restart(T0), T0 - 60_000), T0)).toBe(60);
        const frozen = { kind: 'frozen' as const, seconds: 5 };
        expect(shift(frozen, T0)).toBe(frozen);
    });

    it('tells the time a running clock reads a number of seconds', () => {
        expect(msAt(restart(T0), 90)).toBe(T0 + 90_000);
        const resumed = resume({ kind: 'frozen', seconds: 30 }, T0);
        expect(msAt(resumed, 30)).toBe(T0);
    });
});
