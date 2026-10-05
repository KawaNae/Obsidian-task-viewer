/**
 * タイマーの時計。走っているか止まっているかの2つの形だけを持ち、経過は
 * 読むたびに時刻から求める。経過、残り、区間の位置は保存せず、時計と測り方
 * （`TimerProgress` の `Measure`）から関数で導く。
 *
 * 時刻は引数で受ける。関数の中で now を読まない。
 */

export type RunningClock = { kind: 'running'; startMs: number };
export type FrozenClock = { kind: 'frozen'; seconds: number };

/** `running` は startMs から数えている。`frozen` は seconds で止まっている。 */
export type Clock = RunningClock | FrozenClock;

/** 時計の読み（秒）。走っていれば開始からの経過の秒の切り捨てで、開始より前は 0。 */
export function readSeconds(clock: Clock, nowMs: number): number {
    if (clock.kind === 'frozen') return clock.seconds;
    return Math.max(0, Math.floor((nowMs - clock.startMs) / 1000));
}

/** 今の読みで止める。止まっている時計はそのまま。 */
export function freeze(clock: Clock, nowMs: number): FrozenClock {
    if (clock.kind === 'frozen') return clock;
    return { kind: 'frozen', seconds: readSeconds(clock, nowMs) };
}

/** 止めた読みから続ける。走っている時計はそのまま。 */
export function resume(clock: Clock, nowMs: number): RunningClock {
    if (clock.kind === 'running') return clock;
    return { kind: 'running', startMs: nowMs - clock.seconds * 1000 };
}

/** 0 から数え直す。 */
export function restart(nowMs: number): RunningClock {
    return { kind: 'running', startMs: nowMs };
}

/** 走っている時計の開始を動かす。止まっている時計はそのまま。 */
export function shift(clock: Clock, startMs: number): Clock {
    if (clock.kind === 'frozen') return clock;
    return { kind: 'running', startMs };
}

/** 走っている時計が seconds を指す時刻。 */
export function msAt(clock: RunningClock, seconds: number): number {
    return clock.startMs + seconds * 1000;
}
