/**
 * 測り方と時計から、表示と出来事を導く。純関数だけを置き、ウィジェットと独立
 * ビュー（`TimerView`）が同じ関数を使う。
 *
 * 音、Notice、記録、描画は呼び手が持つ。ここが答えるのは、時計の読みが何を
 * 見せるか（{@link progressOf}）と、前の tick から今までに何が起きたか
 * （{@link tickOf}）だけ。
 */

import type { IntervalGroup } from './IntervalMath';
import { msAt, readSeconds, type Clock } from './TimerClock';
import { advance, repeatText, segmentAt, type IntervalCursor } from './IntervalMath';

/** 何を測るか。interval の `at` は区間の位置（`IntervalMath`）。 */
export type Measure =
    | { type: 'countup' }
    | { type: 'countdown'; totalSeconds: number }
    | { type: 'interval'; source: 'pomodoro' | 'template'; groups: IntervalGroup[]; at: IntervalCursor };

/** 輪の色。区間の種類か、countdown の超過か、色の無いもの。 */
export type Tone = 'work' | 'break' | 'prepare' | 'overtime' | 'plain';

export interface Progress {
    /** 見せる秒。countdown は残り（超過で負）、interval は区間の残り。 */
    displaySeconds: number;
    /** 輪の満ち方（0..1）。 */
    ring: number;
    /** 数え上げの見た目（countup と countdown の超過）。 */
    countupLike: boolean;
    tone: Tone;
    /** interval の周の文言。interval でなければ null。 */
    repeatText: string | null;
}

/** 数え上げの輪が1周する秒。 */
const FULL_ROTATION_SECONDS = 30 * 60;

/** 残りがこの秒以下（0 は含まない）になったら予告する。 */
export const WARN_SECONDS = 3;

/** 時計の読み seconds で、測り方が見せるもの。区間は送らない（送るのは {@link tickOf}）。 */
export function progressOf(measure: Measure, seconds: number): Progress {
    switch (measure.type) {
        case 'countup':
            return {
                displaySeconds: seconds,
                ring: rotation(seconds),
                countupLike: true,
                tone: 'work',
                repeatText: null,
            };
        case 'countdown': {
            const remaining = measure.totalSeconds - seconds;
            if (remaining >= 0) {
                return {
                    displaySeconds: remaining,
                    ring: measure.totalSeconds > 0 ? Math.min(1, remaining / measure.totalSeconds) : 0,
                    countupLike: false,
                    tone: 'work',
                    repeatText: null,
                };
            }
            return {
                displaySeconds: remaining,
                ring: rotation(-remaining),
                countupLike: true,
                tone: 'overtime',
                repeatText: null,
            };
        }
        case 'interval': {
            const segment = segmentAt(measure.groups, measure.at);
            if (!segment) {
                return { displaySeconds: 0, ring: 0, countupLike: false, tone: 'plain', repeatText: '' };
            }
            const remaining = segmentRemaining(segment.durationSeconds, measure.at, seconds);
            return {
                displaySeconds: remaining,
                ring: segment.durationSeconds > 0 ? clamp01(remaining / segment.durationSeconds) : 0,
                countupLike: false,
                tone: segment.type,
                repeatText: repeatText(measure.groups, measure.at),
            };
        }
    }
}

export interface Tick {
    /** 区間を送った後の測り方。 */
    measure: Measure;
    /** 送った区間の数。 */
    segmentsMoved: number;
    /** interval の最後の区間が終わった時刻。終わっていなければ null。 */
    finishedAtMs: number | null;
    /** countdown が前の tick から今までに 0 をまたいだ。 */
    crossedZero: boolean;
    /** countdown の残りか、interval の（送った後の）区間の残りが 1..{@link WARN_SECONDS} 秒。 */
    warn: boolean;
}

/**
 * 前の tick（lastMs）から今（nowMs）までに起きたこと。止まっている時計では
 * 何も起きない。
 */
export function tickOf(run: { measure: Measure; clock: Clock }, nowMs: number, lastMs: number): Tick {
    const { measure, clock } = run;
    const quiet: Tick = { measure, segmentsMoved: 0, finishedAtMs: null, crossedZero: false, warn: false };
    if (clock.kind === 'frozen') return quiet;

    const seconds = readSeconds(clock, nowMs);
    switch (measure.type) {
        case 'countup':
            return quiet;
        case 'countdown': {
            const before = measure.totalSeconds - readSeconds(clock, lastMs);
            const remaining = measure.totalSeconds - seconds;
            return {
                ...quiet,
                crossedZero: before > 0 && remaining <= 0,
                warn: warns(remaining),
            };
        }
        case 'interval': {
            const advanced = advance(measure.groups, measure.at, seconds);
            const next: Measure = { ...measure, at: advanced.at };
            if (advanced.done !== null) {
                return { ...quiet, measure: next, segmentsMoved: advanced.moved, finishedAtMs: msAt(clock, advanced.done) };
            }
            const segment = segmentAt(measure.groups, advanced.at);
            const remaining = segment ? segmentRemaining(segment.durationSeconds, advanced.at, seconds) : 0;
            return { ...quiet, measure: next, segmentsMoved: advanced.moved, warn: warns(remaining) };
        }
    }
}

function segmentRemaining(durationSeconds: number, at: IntervalCursor, seconds: number): number {
    return Math.max(0, durationSeconds - (seconds - at.from));
}

function warns(remaining: number): boolean {
    return remaining > 0 && remaining <= WARN_SECONDS;
}

function rotation(seconds: number): number {
    return clamp01((seconds % FULL_ROTATION_SECONDS) / FULL_ROTATION_SECONDS);
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}
