import { describe, expect, it } from 'vitest';
import { EXTEND_STEP_MINUTES, decideLazyEnd, nextExtendedEnd } from '../../../src/timer/TimerLazyEnd';

/**
 * セッション行は開始時刻だけを持つので、実効 end は「start + 既定の 1 時間」に
 * なる。1 時間を超えて走ると行が現在より手前で終わったことになり赤く出るため、
 * 実効 end を過ぎたときだけ end を先へ書き足す。
 */

const ms = (iso: string) => new Date(iso).getTime();
const STEP = EXTEND_STEP_MINUTES * 60_000;

describe('nextExtendedEnd', () => {
    it('刻みの境界へ切り上げる', () => {
        expect(nextExtendedEnd(ms('2026-08-14T19:07:30'))).toBe(ms('2026-08-14T19:10:00'));
        expect(nextExtendedEnd(ms('2026-08-14T19:00:01'))).toBe(ms('2026-08-14T19:05:00'));
    });

    it('境界ちょうどでも次の境界へ進む', () => {
        // 同じ時刻を返すと書いた直後にまた過去になり、毎 tick 書き込むことになる。
        expect(nextExtendedEnd(ms('2026-08-14T19:10:00'))).toBe(ms('2026-08-14T19:15:00'));
    });

    it('常に現在より未来を返す', () => {
        for (let offset = 0; offset < STEP; offset += 37_000) {
            const now = ms('2026-08-14T19:00:00') + offset;
            expect(nextExtendedEnd(now)).toBeGreaterThan(now);
        }
    });

    it('日を跨ぐ', () => {
        expect(nextExtendedEnd(ms('2026-08-14T23:57:10'))).toBe(ms('2026-08-15T00:00:00'));
    });
});

describe('decideLazyEnd', () => {
    const now = ms('2026-08-14T19:07:30');

    it('実効 end の内側では書かない', () => {
        // 19:00 開始・end なしの行は 20:00 まで暗黙に伸びている。
        const decision = decideLazyEnd(now, ms('2026-08-14T20:00:00'));
        expect(decision).toEqual({ kind: 'hold', floorMs: ms('2026-08-14T20:00:00') });
    });

    it('実効 end を過ぎたら次の境界まで書き足す', () => {
        const decision = decideLazyEnd(now, ms('2026-08-14T19:05:00'));
        expect(decision).toEqual({ kind: 'extend', endMs: ms('2026-08-14T19:10:00') });
    });

    it('実効 end が現在ちょうどなら書き足す', () => {
        const decision = decideLazyEnd(now, now);
        expect(decision.kind).toBe('extend');
    });

    it('明示 end を持つ行はその end 経過時から延長が始まる', () => {
        // 門は行の実効 end であって定数ではない。30 分枠で始めたセッションは
        // 19:00 開始なら 19:30 まで書かず、そこを過ぎたら 5 分刻みに入る。
        const start = ms('2026-08-14T19:00:00');
        const explicitEnd = ms('2026-08-14T19:30:00');

        expect(decideLazyEnd(start + 20 * 60_000, explicitEnd))
            .toEqual({ kind: 'hold', floorMs: explicitEnd });
        expect(decideLazyEnd(ms('2026-08-14T19:31:00'), explicitEnd))
            .toEqual({ kind: 'extend', endMs: ms('2026-08-14T19:35:00') });
    });

    it('書き足した end は次の見直しまでの門になる', () => {
        // 書いた end を過ぎた時点で次の延長が起きるので、間隔は刻みに収束する。
        const first = decideLazyEnd(now, ms('2026-08-14T19:05:00'));
        if (first.kind !== 'extend') throw new Error('expected extend');

        const held = decideLazyEnd(first.endMs - 1, first.endMs);
        expect(held.kind).toBe('hold');

        const second = decideLazyEnd(first.endMs, first.endMs);
        expect(second).toEqual({ kind: 'extend', endMs: first.endMs + STEP });
    });
});
