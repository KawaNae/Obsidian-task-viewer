/**
 * 走っている区間の開始をずらす（オフセット）ときの、ずらし先の決め方。
 *
 * 場面は「やり始めたがタイマーをかけ忘れた」で、あとから始めたタイマーを実際に
 * 始めた時刻から数え直す。widget の経過時間の表示から開くメニューと「ずらす量を
 * 指定…」のダイアログ（`TimerStartOffsetModal`）が使い、書き込みと状態の移し方は
 * `TimerLifecycle.offsetStart` と `TimerRecorder.moveRunningStart` が持つ。ここは
 * 時刻を決めて言い表すだけの純粋な関数で、どれも「今」を引数で受ける。
 */

import type { TimerState } from './TimerState';
import { DateUtils } from '../utils/DateUtils';
import { TimeInput } from '../utils/values/DateValues';
import { IntInput } from '../utils/values/NumberValues';
import { t } from '../i18n';

/** メニューに並べる「N 分前から」の N。 */
export const OFFSET_PRESET_MINUTES = [5, 10, 15, 30] as const;

const MINUTE_MS = 60_000;

/**
 * 開始をずらせるか。countup と countdown の、走っている区間だけ。中断中と記録待ちは
 * 時計が止まっており、ポモドーロは区間の位置が時計の読みで決まるので対象外。
 * ⏸→▶ のあとの countdown の区間もずらせて、残りはずらした分だけ減る（時計は
 * 止めた所から続く）。
 */
export function canOffsetStart(timer: Pick<TimerState, 'measure' | 'session'>): boolean {
    return timer.measure.type !== 'interval' && timer.session.kind === 'running';
}

/**
 * メニューに出す覚えた時刻（{@link TimerState.priorStartMs}）。出すのは 1 本目の
 * 区間の間だけで、⏸→▶ のあとの区間には出さない。覚えた時刻が今より後なら出さない
 * （未来へはずらせない）。
 *
 * 出すのは、覚えた時刻が今日（`startHour` で区切った表示上の日）の中にあるときだけ。
 * 何か月も前の予定の行で始めたとき、その start は作業を始めた時刻ではない。
 */
export function rememberedStart(timer: Pick<TimerState, 'recorded' | 'priorStartMs'>, nowMs: number, startHour: number): number | null {
    if (timer.recorded.count !== 0) return null;
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
 * 「ずらす量を指定…」の欄の形。量（`minutes`）は今から何分前か、時刻（`time`）は
 * 始めた時刻を打つ。ダイアログ（`TimerStartOffsetModal`）の上の切り替えで選ぶ。
 */
export type OffsetInputKind = 'minutes' | 'time';

/**
 * 欄の読み方。量は 1 以上の整数（`20`）、時刻は `H:mm` か `HH:mm`（`9:40`）。
 * どちらも全角の数字とコロンを読む（`utils/values` の codec）。読めない値は理由を
 * 欄の下に出す。
 */
export const OFFSET_FIELDS = {
    minutes: IntInput.codec({ min: 1 }),
    time: TimeInput,
} as const;

/** 欄から読めた値: 何分前か、始めた時刻（`HH:mm`）。 */
export type OffsetInput =
    | { kind: 'minutes'; minutes: number }
    | { kind: 'time'; time: string };

/**
 * 読めた値の、ずらし先の時刻（ミリ秒）。量は今から N 分前、時刻は今日のその時刻で、
 * 今より後なら前日のその時刻。どちらの形でも、今より後にはならない。
 */
export function offsetStart(input: OffsetInput, nowMs: number): number {
    if (input.kind === 'minutes') return nowMs - input.minutes * MINUTE_MS;
    const [hours, minutes] = input.time.split(':').map(Number);
    const at = new Date(nowMs);
    at.setHours(hours, minutes, 0, 0);
    // 前日へは日付で戻す（24 時間を引くと、夏時間の切り替えの日に時刻がずれる）。
    if (at.getTime() > nowMs) at.setDate(at.getDate() - 1);
    return at.getTime();
}

/**
 * メニューとダイアログの見通しに出す時刻。今日なら `HH:MM`、前日なら「前日」を
 * 添え、それより前なら日付を添える。日は暦の日で、時刻の欄が「今より後なら前日」
 * と読むときの前日と同じ。
 */
export function startLabel(startMs: number, nowMs: number): string {
    const at = new Date(startMs);
    const time = DateUtils.formatHHMM(at.getHours(), at.getMinutes());
    const date = DateUtils.getLocalDateString(at);
    const today = DateUtils.getLocalDateString(new Date(nowMs));
    if (date === today) return time;
    if (date === DateUtils.addDays(today, -1)) return t('timer.offsetPreviousDay', { time });
    return `${date} ${time}`;
}

/** ずらし先が今から何分前か（「50 分前」「2 時間 5 分前」）。分に満たない端数は切り捨てる。 */
export function agoLabel(startMs: number, nowMs: number): string {
    const total = Math.max(0, Math.floor((nowMs - startMs) / MINUTE_MS));
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return hours > 0 ? t('timer.offsetAgoHours', { hours, minutes }) : t('timer.offsetAgoMinutes', { minutes });
}
