/**
 * 1 秒ごとの経過計算。数値フィールドだけを更新し、起きたことを呼び出し側に返す。
 *
 * ウィジェット（`TimerLifecycle`）と独立ビュー（`TimerView`）は、鳴らす音も、
 * 出す `Notice` も、描画の粒度も、記録の有無も違う。同じなのは経過の求め方だけ
 * なので、共有するのはそこに限る。`phase` も書かない — ウィジェットでは区間の
 * 種別、ビューでは表示色の元と、意味の重なりが完全ではないため。
 */

import type {
    CountdownTimer,
    CountupTimer,
    IdleTimer,
    IntervalTimer,
    TimerInstance,
} from './TimerInstance';
import { clampToTotalDuration, computeCompletedDuration, getCurrentSegment } from './IntervalMath';

/** 残りがこれ以下になったら予告ビープ。 */
export const WARN_THRESHOLD_SECONDS = 3;

/** 走り出してから今までの経過（停止中に積んだ分を含む）。 */
export function elapsedSeconds(timer: TimerInstance, nowMs: number): number {
    const sinceStart = Math.floor((nowMs - timer.startTimeMs) / 1000);
    return Math.max(0, timer.pausedElapsedTime + sinceStart);
}

/** 停止時に走行分を `pausedElapsedTime` へ積む。まだ走り出していなければ何もしない。 */
export function accumulatePausedElapsed(timer: TimerInstance, nowMs: number): void {
    if (timer.startTimeMs <= 0) return;
    timer.pausedElapsedTime += Math.max(0, Math.floor((nowMs - timer.startTimeMs) / 1000));
}

export function applyCountupTick(timer: CountupTimer | IdleTimer, nowMs: number): void {
    timer.elapsedTime = elapsedSeconds(timer, nowMs);
}

export interface CountdownTick {
    /** 残り秒。0 を割ると負になり、超過として数え続ける。 */
    remaining: number;
    /** この tick で 0 をまたいだ。完了音と通知はここで 1 度だけ。 */
    crossedZero: boolean;
    /** 残り 3 秒以内（0 は含まない）。 */
    warn: boolean;
}

export function applyCountdownTick(timer: CountdownTimer, nowMs: number): CountdownTick {
    const before = timer.timeRemaining;
    const elapsed = elapsedSeconds(timer, nowMs);
    timer.elapsedTime = elapsed;
    timer.timeRemaining = timer.totalTime - elapsed;

    return {
        remaining: timer.timeRemaining,
        crossedZero: before > 0 && timer.timeRemaining <= 0,
        warn: timer.timeRemaining > 0 && timer.timeRemaining <= WARN_THRESHOLD_SECONDS,
    };
}

export type IntervalTickOutcome =
    /** 区間の途中。 */
    | 'running'
    /** 今の区間を使い切った。次へ送るのは呼び出し側。 */
    | 'segment-complete'
    /** 指す区間が無い（定義が空、または末尾を越えている）。 */
    | 'no-segment';

export interface IntervalTick {
    outcome: IntervalTickOutcome;
    warn: boolean;
}

export function applyIntervalTick(timer: IntervalTimer, nowMs: number): IntervalTick {
    const segment = getCurrentSegment(timer);
    if (!segment) return { outcome: 'no-segment', warn: false };

    const segmentElapsed = elapsedSeconds(timer, nowMs);
    timer.segmentTimeRemaining = Math.max(0, segment.durationSeconds - segmentElapsed);
    timer.totalElapsedTime = clampToTotalDuration(
        timer.totalDuration,
        computeCompletedDuration(timer) + Math.min(segment.durationSeconds, segmentElapsed),
    );

    if (timer.segmentTimeRemaining <= 0) {
        return { outcome: 'segment-complete', warn: false };
    }
    return { outcome: 'running', warn: timer.segmentTimeRemaining <= WARN_THRESHOLD_SECONDS };
}

/**
 * 一時停止したあとの区間表示を作り直す。走行分を `pausedElapsedTime` へ積んだ
 * 後に呼ぶ（{@link accumulatePausedElapsed}）。
 */
export function applyIntervalPauseSnapshot(timer: IntervalTimer): void {
    const segment = getCurrentSegment(timer);
    if (!segment) return;

    timer.segmentTimeRemaining = Math.max(0, segment.durationSeconds - timer.pausedElapsedTime);
    timer.totalElapsedTime = clampToTotalDuration(
        timer.totalDuration,
        computeCompletedDuration(timer) + Math.min(segment.durationSeconds, timer.pausedElapsedTime),
    );
}
