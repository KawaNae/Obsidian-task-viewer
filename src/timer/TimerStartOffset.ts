/**
 * 走っている区間の開始をずらす（オフセット）ときの、ずらし先の決め方。
 *
 * 場面は「やり始めたがタイマーをかけ忘れた」で、あとから始めたタイマーを実際に
 * 始めた時刻から数え直す。widget の経過時間の表示から開くメニューが使い、書き込み
 * と状態の移し方は `TimerLifecycle.offsetStart` と `TimerRecorder.moveRunningStart`
 * が持つ。ここは時刻を決めるだけの純粋な関数で、どれも「今」を引数で受ける。
 */

import type { CountdownTimer, CountupTimer, TimerInstance } from './TimerInstance';
import { DateUtils } from '../utils/DateUtils';

/** メニューに並べる「N 分前から」の N。 */
export const OFFSET_PRESET_MINUTES = [5, 10, 15, 30] as const;

const MINUTE_MS = 60_000;

/**
 * 開始をずらせるか。countup と countdown の、走っている区間だけ。中断中と記録待ちは
 * 区間が止まっており、interval は区間の位置と遷移が経過で決まるので対象外。
 */
export function canOffsetStart(timer: TimerInstance): timer is CountupTimer | CountdownTimer {
    if (timer.timerType !== 'countup' && timer.timerType !== 'countdown') return false;
    return timer.runState === 'running' && timer.isRunning && !timer.pendingRecord;
}

/**
 * メニューに出す覚えた時刻（{@link TimerInstance.priorStartMs}）。出すのは 1 本目の
 * 区間の間だけで、⏸→▶ のあとの区間には出さない。覚えた時刻が今より後なら出さない
 * （未来へはずらせない）。
 *
 * 出すのは、覚えた時刻が今日（`startHour` で区切った表示上の日）の中にあるときだけ。
 * 何か月も前の予定の行で始めたとき、その start は作業を始めた時刻ではない。
 */
export function rememberedStart(timer: TimerInstance, nowMs: number, startHour: number): number | null {
    if (timer.sessionCount !== 0) return null;
    const prior = timer.priorStartMs;
    if (typeof prior !== 'number' || prior >= nowMs) return null;
    if (visualDateOf(prior, startHour) !== visualDateOf(nowMs, startHour)) return null;
    return prior;
}

function visualDateOf(ms: number, startHour: number): string {
    const at = new Date(ms);
    return DateUtils.toVisualDate(
        DateUtils.getLocalDateString(at), DateUtils.formatHHMM(at.getHours(), at.getMinutes()), startHour);
}

/**
 * 「ずらす量を指定…」に打った値を、ずらし先の時刻（ミリ秒）に読む。
 *
 * - 数だけ（`20`）: 今から N 分前。N は 1 以上
 * - `HH:MM`（`9:40`）: 今日のその時刻。今より後なら前日のその時刻
 *
 * 全角の数字とコロンも読む。どちらの形でもなければ null。
 */
export function parseOffsetInput(value: string, nowMs: number): number | null {
    const text = value.normalize('NFKC').trim();

    if (/^\d+$/.test(text)) {
        const minutes = Number(text);
        return minutes > 0 ? nowMs - minutes * MINUTE_MS : null;
    }

    const clock = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!clock) return null;
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours > 23 || minutes > 59) return null;

    const at = new Date(nowMs);
    at.setHours(hours, minutes, 0, 0);
    // 前日へは日付で戻す（24 時間を引くと、夏時間の切り替えの日に時刻がずれる）。
    if (at.getTime() > nowMs) at.setDate(at.getDate() - 1);
    return at.getTime();
}

/** メニューに出す時刻。今日なら `HH:MM`、ほかの日なら日付も添える。 */
export function startLabel(startMs: number, nowMs: number): string {
    const at = new Date(startMs);
    const time = DateUtils.formatHHMM(at.getHours(), at.getMinutes());
    const date = DateUtils.getLocalDateString(at);
    return date === DateUtils.getLocalDateString(new Date(nowMs)) ? time : `${date} ${time}`;
}
