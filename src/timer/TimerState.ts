/**
 * ウィジェットのタイマーの状態。保存するのはこの形だけで、経過、残り、区間の
 * 位置は時計（`TimerClock`）と測り方（`TimerProgress` の `Measure`）から関数で
 * 求める。状態を変えるのは `TimerTransitions.step` だけで、`TimerBoard.dispatch`
 * が当てる。
 *
 * 実行時の予定（tick、往復中の操作、end の書き足しの門、✕ の確認）は保存しない
 * ので、ここには置かない（`TimerRuntime`）。
 */

import { readSeconds, type Clock } from './TimerClock';
import { advance } from './IntervalMath';
import type { Measure } from './TimerProgress';

/**
 * タイマーが計るもの。時間を越えて追うのは錨か日付だけで、行の名前は持たない。
 *
 * - `task`  … 対象の行の錨（ファイルで1つだけの `^id`）。行に錨が無ければ、
 *             開始の命令が付ける錨を決め、開始の書き込みで付ける
 * - `daily` … デイリーノートの日（`YYYY-MM-DD`）。対象の行を持たない
 */
export type Subject =
    | { kind: 'task'; anchor: string }
    | { kind: 'daily'; date: string };

/**
 * 1 本目の記録をどこに書くか。2 本目からは常に尻尾の兄弟なので、効くのは
 * 開始の書き込みの1回だけ。
 *
 * - `self`    … 対象の行そのものを記録にする
 * - `child`   … 対象の子として書く（デイリーノートは見出しの下）
 * - `sibling` … 完了済みの対象の連なりの隣に書く（`[x]` から「続きを開始」）
 */
export type RecordMode = 'self' | 'child' | 'sibling';

/**
 * 止めたが記録していない走行。止めた時点で固定し、書けるまで変えない。
 *
 * - `endMs`   … 記録の終わり（押した時刻、ポモドーロの周の終わりは満ちた時刻）
 * - `seconds` … 記録の長さ。記録の開始は `endMs − seconds`
 * - `then`    … 書けたあとの行き先。⏸ は中断、■ は閉じる
 */
export interface PendingRecord {
    endMs: number;
    seconds: number;
    then: 'suspend' | 'close';
}

/**
 * 記録の区切り。
 *
 * - `running`   … 走っている。記録は時計の読み `from` から
 * - `pending`   … 止めたが記録していない（記録待ち）。書けなければ再読み込みもまたぐ
 * - `suspended` … 記録を書き終えて、▶ を待つ
 */
export type Session =
    | { kind: 'running'; from: number }
    | { kind: 'pending'; record: PendingRecord }
    | { kind: 'suspended' };

/**
 * 行を書く書き込みが、書けたあとのタイマーに残す錨の姿。書く前に保存し、書けたら
 * 当てる。書く途中で再読み込みされたら、`tail` の錨をファイルで引き、在れば当てる。
 *
 * - `tail`  … この書き込みが書く行の錨。書けたら尻尾になる
 * - `owned` … 書けたあとの {@link TimerState.owned}
 */
export interface Opening {
    tail: string;
    owned: string[];
}

export interface TimerState {
    /** タイマーの名前。対象から作らない（対象の錨は開始の書き込みで行に付く）。 */
    id: string;
    subject: Subject;
    /** タイマーの行があるノート。デイリーノートは 1 本目が書けるまで ''。送る操作とノートの改名で書き換わる。 */
    file: string;
    /** 表示の写し。索引が変わるたびに対象の行から取り直す（`TimerRenderer.refreshFromIndex`）。 */
    name: string;
    color: string;
    mode: RecordMode;
    /** ウィジェットが測るのは countup、countdown、ポモドーロ（interval の source 'pomodoro'）だけ。 */
    measure: Measure;
    /** running の間だけ走る。pending と suspended では止まっている。 */
    clock: Clock;
    session: Session;
    /** 尻尾の錨: 最後に書いた記録の行。次の ▶ はその兄弟に書く。self の 1 本目は対象の錨そのもの。 */
    tail: string | null;
    /**
     * 自分の書き込みで付けて、まだ外していない錨。外してよいのはここにある錨だけで、
     * 錨の形からは推さない（`TimerRecorder.mayTakeOff`）。
     */
    owned: string[];
    /** 書いている途中の行と、書けたあとの錨の姿。無ければ null。 */
    opening: Opening | null;
    /** 書き終えた記録の長さの合計と本数。中断中の表示と、開始をずらすメニューが読む。 */
    recorded: { seconds: number; count: number };
    /**
     * self の開始が対象の行の start を上書きする前の、その行の start（ミリ秒）。
     * 開始をずらすメニューの候補に出す（`TimerStartOffset.rememberedStart`）。
     * self で、行の start に時刻があるときだけ。ほかは null。
     */
    priorStartMs: number | null;
    /**
     * 尻尾の行がまだ無い間の名前の下書き。名前の正は尻尾の行で、入力欄はその
     * 編集器である（`TimerContentBinding`）。行が無い間と、書けなかった間だけ
     * ここに溜め、行が生えたら書き出す。
     */
    draft: string | null;
    expanded: boolean;
}

/** タイマーの id。対象から作らず、タイマーの一生のあいだ変わらない。 */
export function newTimerId(): string {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
        return `timer-${cryptoObj.randomUUID()}`;
    }
    timerIdCounter += 1;
    return `timer-${timerIdCounter}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

let timerIdCounter = 0;

/** 対象の行の錨。デイリーノートは対象の行を持たない。 */
export function targetOf(timer: Pick<TimerState, 'subject'>): string | null {
    return timer.subject.kind === 'task' ? timer.subject.anchor : null;
}

/** 走っているか、記録待ちか。どちらもノートに走行中の行を持ち、✕ は確認の2打を要る。 */
export function holdsRun(timer: Pick<TimerState, 'session'>): boolean {
    return timer.session.kind !== 'suspended';
}

/**
 * ポモドーロの周を終えたか（周に限りがあり、最後の区間が満ちた）。終えた
 * ポモドーロは記録して閉じるだけで、⏸ で中断しない（▶ の続きが無い）。
 */
export function finished(timer: Pick<TimerState, 'measure' | 'clock'>, nowMs: number): boolean {
    const { measure } = timer;
    if (measure.type !== 'interval') return false;
    return advance(measure.groups, measure.at, readSeconds(timer.clock, nowMs)).done !== null;
}

/** 種類の名前（記録の通知が言う）。 */
export function kindName(measure: Measure): 'Timer' | 'Countdown' | 'Pomodoro' {
    switch (measure.type) {
        case 'countdown': return 'Countdown';
        case 'interval': return 'Pomodoro';
        default: return 'Timer';
    }
}

/**
 * ログ用に、タイマーが行を引くときに頼る手がかりを 1 行にまとめる。挙動には
 * 関与しない。
 */
export function describeTimerAnchor(timer: Pick<TimerState, 'mode' | 'subject' | 'file' | 'tail'>): string {
    return [
        `mode=${timer.mode}`,
        timer.subject.kind === 'task' ? `target=${timer.subject.anchor}` : `daily=${timer.subject.date}`,
        `file=${timer.file || '-'}`,
        `tail=${timer.tail ?? '-'}`,
    ].join(' ');
}
