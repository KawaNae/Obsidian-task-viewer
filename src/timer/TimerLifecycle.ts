/**
 * タイマーの操作: 開始の書き込み（{@link TimerLifecycle.begin}）、⏸ と ■
 * （{@link TimerLifecycle.stop}）、▶（{@link TimerLifecycle.resume}）、開始をずらす、
 * ✕（{@link TimerLifecycle.close}）、tick（区間の送り、周の終わり、end の書き足し）。
 *
 * 規則は「書けてから状態を進める」。書き込みを待ってから出来事を `TimerBoard` に
 * 当てる。状態がどう移るかは `TimerTransitions` が答える。
 */

import { AudioUtils } from './AudioUtils';
import type { TimerBoard } from './TimerBoard';
import type { TimerRecorder } from './TimerRecorder';
import type { TimerRuntime } from './TimerRuntime';
import { holdsRun, type PendingRecord, type TimerState } from './TimerState';
import { tickOf } from './TimerProgress';
import { canOffsetStart } from './TimerStartOffset';
import type { Task } from '../types';

/** 名前の入力欄の書き出し（`TimerContentBinding`）。 */
export interface ContentOutlet {
    /** @returns 打った名前を書けたか（書くものが無ければ書けたと答える）。 */
    flush(timer: TimerState): Promise<boolean>;
    /** 書いていない名前を捨てる（✕ の破棄。行ごと消える）。 */
    discard(timer: TimerState): void;
    /** 閉じたタイマーの書き出しの予定を落とす。 */
    release(timerId: string): void;
}

export interface LifecycleDeps {
    board: TimerBoard;
    runtime: TimerRuntime;
    recorder: TimerRecorder;
    content: ContentOutlet;
    /** tick の描き直し: 時間の表示だけを進める。 */
    renderTimes(): void;
}

export class TimerLifecycle {
    private board: TimerBoard;
    private runtime: TimerRuntime;
    private recorder: TimerRecorder;
    private content: ContentOutlet;

    constructor(private deps: LifecycleDeps) {
        this.board = deps.board;
        this.runtime = deps.runtime;
        this.recorder = deps.recorder;
        this.content = deps.content;
    }

    // ─── 開始 ─────────────────────────────────────────────────

    /**
     * 開始の書き込み: 1 本目の行を書く（self は対象の行の start、child は子、sibling は
     * 完了の連なりの隣、デイリーノートは見出しの下）。対象の行に錨が無ければ同じ
     * 書き込みで付ける。書けなければ閉じる。理由は書き込みの層か recorder が1回だけ
     * 告げている。
     *
     * @param task 開始を押したときの対象の写し。デイリーノートは null。
     */
    begin(timer: TimerState, task: Task | null): Promise<void> {
        return this.exclusive(timer, async () => {
            if (!(await this.recorder.writeStart(timer, task))) {
                // 何も書いていない。付けた錨も無いので、閉じても外すものは無い。
                this.closeNow(timer);
                return;
            }
            this.runtime.lazyEndFloorMs.delete(timer.id);
            // 書き込みの往復中に打たれた名前は下書きに溜まっている。行が生えた今なら書ける。
            await this.content.flush(timer);
        });
    }

    // ─── 記録 ─────────────────────────────────────────────────

    /**
     * ⏸（`then` が suspend）と ■（close）。記録を書く出口はすべてここを通る。
     *
     * 走っていれば時計を止めて記録を固定し（`stopped`）、それから書く。書けたら
     * ⏸ は中断、■ は閉じる。書けなければ記録待ちのまま残り、再読み込みもまたぐ。
     * 記録待ちで押し直すと、固定した時刻と長さで書き直し、行き先だけを替える。
     * 中断中の ■ は書くものが無いので閉じる。
     *
     * @param atMs 記録の終わり。ポモドーロの周の終わりは満ちた時刻。
     */
    stop(timer: TimerState, then: PendingRecord['then'], atMs = Date.now()): Promise<void> {
        return this.exclusive(timer, async () => {
            if (then === 'close') AudioUtils.playFinishSound();
            else AudioUtils.playPauseSound();
            if (timer.session.kind === 'suspended') {
                if (then === 'close') this.closeNow(timer);
                return;
            }
            this.board.dispatch(timer, { type: 'stopped', then }, atMs);
            await this.record(timer);
        });
    }

    /**
     * 固定した記録を書く。記録は走行中の行の名前を読むので、打った名前を先に
     * 書き出す。名前を書けなければ記録に進まない — 古い名前で記録を書けば通知が
     * 拒否と成功の2回になり、打った名前は行き先を失う。
     */
    private async record(timer: TimerState): Promise<void> {
        const session = timer.session;
        if (session.kind !== 'pending') return;
        const record = session.record;
        if (!(await this.content.flush(timer))) return;
        if (!(await this.recorder.recordSessionEnd(timer, record))) return;
        if (record.then === 'close') {
            this.closeNow(timer);
            return;
        }
        this.board.dispatch(timer, { type: 'recorded' });
        // 中断は手を止めた合図。走っているタイマーが無くなれば次のタスクを提案する。
        this.wakeIdle();
    }

    /**
     * ▶: 新しい走行中の行を尻尾の兄弟に書き、書けたら走る。時計は countup と
     * countdown は押した時刻から 0、ポモドーロは止めた所から続ける
     * （`TimerTransitions` の `resumed`）。書けなければ中断のまま残る。
     */
    resume(timer: TimerState): Promise<void> {
        if (timer.session.kind !== 'suspended') return Promise.resolve();
        const pressedAt = Date.now();
        return this.exclusive(timer, async () => {
            // 中断中に打たれた名前は直前の記録の行宛て。新しい行を書く前に書き出す。
            const began = await this.content.flush(timer)
                && await this.recorder.startNextSession(timer, pressedAt);
            if (!began) return;
            this.board.dispatch(timer, { type: 'resumed', pressedAt });
            this.runtime.lazyEndFloorMs.delete(timer.id);
            this.board.setIdle(null);
            AudioUtils.playStartSound();
            // 往復の間に打たれた名前は、新しい行が受け取る。
            await this.content.flush(timer);
        });
    }

    /**
     * 走っている区間の開始を `startMs` へずらす（`TimerStartOffset`）。先に走行の行の
     * start を書き直し（`TimerRecorder.moveRunningStart`）、書けてから時計を動かす。
     * ずらせるのは countup と countdown の走っている区間だけで、未来へはずらせない。
     */
    offsetStart(timer: TimerState, startMs: number): Promise<void> {
        return this.exclusive(timer, async () => {
            if (!canOffsetStart(timer) || startMs > Date.now()) return;
            if (!(await this.recorder.moveRunningStart(timer, startMs))) return;
            this.board.dispatch(timer, { type: 'shifted', startMs });
            // end の無い行の実効 end は start から決まる。書き足しの門を引き直す。
            this.runtime.lazyEndFloorMs.delete(timer.id);
        });
    }

    // ─── 閉じる ───────────────────────────────────────────────

    /**
     * ✕。分かれ目は記録の区切り（`session.kind`）だけで決まる。中断中は記録を書き
     * 終えているので確認なしで閉じる。走っているか記録待ちなら、ノートに走行中の行を
     * 持つので、確認の2打目（`confirmed`）で行ごと捨てる。
     *
     * @returns 確認を求めるか（`confirm`）、閉じる操作を始めたか（`closing`）。
     */
    close(timer: TimerState, confirmed: boolean): 'confirm' | 'closing' {
        if (!holdsRun(timer)) {
            this.closeNow(timer);
            return 'closing';
        }
        if (!confirmed) return 'confirm';
        void this.discard(timer);
        return 'closing';
    }

    /**
     * 今の走行を記録せずに閉じる。自分で書いた走行中の行は道連れにする（判断は
     * `TimerRecorder.discardRunningPlaceholder`）。名前の下書きは行ごと消えるので書かない。
     */
    private discard(timer: TimerState): Promise<void> {
        return this.exclusive(timer, async () => {
            this.content.discard(timer);
            await this.recorder.discardRunningPlaceholder(timer);
            this.closeNow(timer);
        });
    }

    /**
     * 表から外し、後始末をする: 打った名前を書き切ってから、このタイマーが付けた
     * 錨を外す（ほかのタイマーが頼る錨は残す。`TimerRecorder.releaseAnchors`）。
     * 尻尾の錨を先に外すと、名前の書き先を引けなくなる。
     */
    private closeNow(timer: TimerState): void {
        if (!this.board.has(timer)) return;
        this.board.remove(timer);
        this.runtime.forget(timer.id);
        this.wakeIdle();
        void (async () => {
            await this.content.flush(timer);
            this.content.release(timer.id);
            await this.recorder.releaseAnchors(timer);
        })();
    }

    // ─── 提案 ─────────────────────────────────────────────────

    /** 走っているタイマー（記録待ちを含む）が無ければ、次のタスクの提案を出す。 */
    private wakeIdle(): void {
        if (this.board.idle) return;
        if (this.board.values().some(holdsRun)) return;
        this.board.setIdle({ sinceMs: Date.now() });
    }

    // ─── tick ─────────────────────────────────────────────────

    /**
     * 毎秒の tick。走っているタイマーの end を書き足し、ポモドーロの区間を送る
     * （音）。周の終わりは満ちた時刻で記録して閉じる。ウィジェットの countdown は
     * 0 を割っても鳴らさない（記録が続いている）。
     */
    tick(nowMs = Date.now()): void {
        const lastMs = this.runtime.lastTickMs || nowMs;
        this.runtime.lastTickMs = nowMs;
        for (const timer of this.board.values()) {
            if (timer.session.kind !== 'running') continue;
            this.maybeExtendSessionEnd(timer, nowMs);
            if (timer.measure.type !== 'interval') continue;

            const tick = tickOf(timer, nowMs, lastMs);
            if (tick.segmentsMoved > 0 || tick.finishedAtMs !== null) {
                this.board.dispatch(timer, { type: 'ticked', measure: tick.measure });
            }
            if (tick.finishedAtMs !== null) {
                void this.stop(timer, 'close', tick.finishedAtMs);
                continue;
            }
            if (tick.segmentsMoved > 0) AudioUtils.playTransitionConfirm();
            if (tick.warn) AudioUtils.playWarningBeep();
        }
        this.deps.renderTimes();
    }

    /**
     * 走行中の行の end を書き足す門。実効 end を過ぎるまでは何もしない — 毎秒の
     * tick で索引を引かないための門で、判断は recorder が持つ。門は「次にいつ
     * 見直すか」の予定で、end の真の値は見直すたびにファイルから読み直す。
     */
    private maybeExtendSessionEnd(timer: TimerState, nowMs: number): void {
        const floor = this.runtime.lazyEndFloorMs.get(timer.id);
        if (floor !== undefined && nowMs < floor) return;
        if (this.runtime.extending.has(timer.id)) return;

        this.runtime.extending.add(timer.id);
        void this.recorder.extendRunningSession(timer)
            .then((nextFloorMs) => {
                // 行を引けなかったときだけ門を開けたままにして、次の tick で見直す。
                if (nextFloorMs !== undefined) this.runtime.lazyEndFloorMs.set(timer.id, nextFloorMs);
            })
            .finally(() => this.runtime.extending.delete(timer.id));
    }

    // ─── 1 つずつ ─────────────────────────────────────────────

    /**
     * `op` を、そのタイマーの往復中の操作が無いときだけ走らせる。往復中に押された
     * 出口や再開は捨てる — 通すと同じ走行を二度記録し、通知も二度出る。
     */
    private async exclusive(timer: TimerState, op: () => Promise<void>): Promise<void> {
        if (this.runtime.busy.has(timer.id)) return;
        this.runtime.busy.add(timer.id);
        try {
            await op();
        } finally {
            this.runtime.busy.delete(timer.id);
        }
    }
}
