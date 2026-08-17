/**
 * widget の content 入力欄と、タイマーが走っている行（尻尾）の同期。
 *
 * content の正は**尻尾の行**ひとつだけで、入力欄はその編集器に徹する。widget 側に
 * 値を持つと「入力の正」と「md の正」が並び、両者を結ぶ経路が placeholder を書く
 * 一度きりになる — 入力が次のセッションへ繰り越される（v0.51.0 のバグ）のはこの形
 * から出ていた。
 *
 * 尻尾は状態によって指す行が変わる（走行中はその行、中断中は直前の完了済みレコード、
 * self の 1 本目は対象タスク行）が、解決は {@link TimerRecorder.resolveTailRecord}
 * が既に持っているのでここでは呼ぶだけでよい。
 */

import type { TimerInstance } from './TimerInstance';
import type { TimerContext } from './TimerContext';
import { splitTimerIcon, withTimerIcon } from '../utils/TimerIcons';

/** 入力が静まってから書き込むまでの待ち。1 打鍵ごとの書き込みは重すぎる。 */
export const CONTENT_WRITE_DEBOUNCE_MS = 400;

interface BindingState {
    /** 未書き込みの素の名前。無いときは書くものが無い。 */
    pending?: string;
    timeoutId?: ReturnType<typeof setTimeout>;
    /** 書き込み中。返るまで次を走らせない（行の取り違えを防ぐ）。 */
    writing: boolean;
}

export class TimerContentBinding {
    private states = new Map<string, BindingState>();

    constructor(private ctx: TimerContext) {}

    // ─── 表示 ────────────────────────────────────────────────

    /**
     * 入力欄に出す値。未書き込みの入力があればそれ、無ければ尻尾の行の素の名前。
     *
     * 下書きを先に見るのは、書き込みが返る前に widget が組み直されても打った字が
     * 消えないようにするため。
     */
    displayValue(timer: TimerInstance): string {
        if (timer.pendingContent !== undefined) return timer.pendingContent;
        return this.tailName(timer);
    }

    /**
     * 入力欄をタイマーに結ぶ。renderer が入力欄を作るたびに呼ぶ。
     */
    bind(timer: TimerInstance, inputEl: HTMLInputElement): void {
        inputEl.oninput = () => {
            const state = this.stateFor(timer.id);
            const value = inputEl.value;

            state.pending = value;
            // 未書き込みの入力は下書きにも置く。widget の組み直しやリロードを
            // またいでも打った字が消えない。
            timer.pendingContent = value;
            this.ctx.persistTimersToStorage();

            if (state.timeoutId !== undefined) clearTimeout(state.timeoutId);
            state.timeoutId = setTimeout(() => {
                state.timeoutId = undefined;
                void this.drain(timer);
            }, CONTENT_WRITE_DEBOUNCE_MS);
        };
    }

    /**
     * md 側の変化を入力欄へ返す。tick 経路から呼ぶ。
     *
     * 打鍵中（フォーカス中）と未書き込みの入力があるときは見送る — どちらも
     * ユーザーが今書いている値を、古い md の値で上書きすることになる。
     */
    syncFromFile(timer: TimerInstance, inputEl: HTMLInputElement): void {
        if (timer.pendingContent !== undefined) return;
        if (inputEl.ownerDocument.activeElement === inputEl) return;

        const name = this.tailName(timer);
        if (inputEl.value !== name) inputEl.value = name;
    }

    // ─── 書き出し ────────────────────────────────────────────

    /**
     * 未書き込みの入力を書き出す。**記録を書く前に必ず待つ** — ここを飛ばすと
     * 停止時の記録が古い content を読み、入力が 1 セッション繰り越される。
     */
    async flush(timer: TimerInstance): Promise<void> {
        const state = this.stateFor(timer.id);
        if (state.timeoutId !== undefined) {
            clearTimeout(state.timeoutId);
            state.timeoutId = undefined;
        }
        // 下書きが残っているなら、書き先の行がその後に生えた可能性がある。flush が
        // 呼ばれるのは行が動いた直後（1 本目を書いた / 再開で兄弟を挿した / 停止する）
        // なので、ここでもう一度当たる。
        if (state.pending === undefined && timer.pendingContent !== undefined) {
            state.pending = timer.pendingContent;
        }
        await this.drain(timer);
    }

    /**
     * 未書き込みの入力を捨てる。✕ 破棄の経路で使う — 走行中の行ごと消えるので、
     * 書いてから消すのは無駄な書き込みにしかならない。
     */
    discard(timer: TimerInstance): void {
        timer.pendingContent = undefined;
        this.release(timer.id);
    }

    /** タイマーが閉じたら状態を落とす。 */
    release(timerId: string): void {
        const state = this.states.get(timerId);
        if (state?.timeoutId !== undefined) clearTimeout(state.timeoutId);
        this.states.delete(timerId);
    }

    // ─── Private ─────────────────────────────────────────────

    private stateFor(timerId: string): BindingState {
        let state = this.states.get(timerId);
        if (!state) {
            state = { writing: false };
            this.states.set(timerId, state);
        }
        return state;
    }

    /** 尻尾の行の素の名前（アイコンを剥がしたもの）。 */
    private tailName(timer: TimerInstance): string {
        const tail = this.ctx.recorder.resolveTailRecord(timer);
        if (!tail) return '';
        return splitTimerIcon(tail.content).name;
    }

    /**
     * 溜まっている値を書き切る。
     *
     * 書き込み中に来た入力は `pending` に上書きされ、1 本目が返ってから続けて
     * 走る。並べて投げると、行を引き直す前のスナップショットで書くことになる。
     */
    private async drain(timer: TimerInstance): Promise<void> {
        const state = this.stateFor(timer.id);
        if (state.writing) return;

        state.writing = true;
        try {
            while (state.pending !== undefined) {
                const next = state.pending;
                state.pending = undefined;
                await this.writeOnce(timer, next);
            }
        } finally {
            state.writing = false;
        }
    }

    private async writeOnce(timer: TimerInstance, name: string): Promise<void> {
        const trimmed = name.trim();
        const tail = this.ctx.recorder.resolveTailRecord(timer);
        if (!tail) {
            // 書く相手がまだ居ない。下書きのまま置いて、行が生えたときに書き出す。
            timer.pendingContent = name;
            return;
        }

        const current = splitTimerIcon(tail.content);
        if (current.name === trimmed) {
            // 値が同じなら書かない。no-op な vault.process は modify を発火せず、
            // 自己修復も効かないまま無駄な往復だけが残る。
            timer.pendingContent = undefined;
            this.ctx.persistTimersToStorage();
            return;
        }

        // 行に付いていたアイコンはそのまま戻す（無ければ付けない）。
        const content = current.icon ? withTimerIcon(current.icon, trimmed) : trimmed;
        await this.ctx.plugin.getTaskIndex().updateTask(tail.id, { content });

        timer.pendingContent = undefined;
        this.ctx.persistTimersToStorage();
    }
}
