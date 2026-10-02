/**
 * 開いているタイマーの表と、次のタスクの提案（idle）。状態を変える口は
 * {@link TimerBoard.dispatch} と表の出し入れだけで、どれも保存と描画を microtask で
 * 1回だけ予約する。保存（`TimerPersistence.persist`）を呼ぶのはその予約だけ。
 *
 * 行を書く前に `opening` を保存する規則は、この予約で保たれる: 書き込みの往復が
 * 返るより先に microtask が走る。
 */

import { step, type TimerEvent } from './TimerTransitions';
import type { TimerState } from './TimerState';

/**
 * 次のタスクの提案。走っているタイマーが無いときのウィジェットの表示で、
 * タイマーではない。`sinceMs` は提案を出した時刻で、経過の表示と誤打の守りが読む。
 */
export interface IdleBoard {
    sinceMs: number;
}

/** 組み直さずに済む出来事。入力欄を組み直すと、打っている名前とフォーカスを失う。 */
const QUIET: ReadonlySet<TimerEvent['type']> = new Set(['drafted', 'synced', 'opening', 'landed', 'followed']);

export interface BoardOutlet {
    /** 表と提案を保存する。 */
    persist(): void;
    /** ウィジェットを組み直す。 */
    render(): void;
}

export class TimerBoard {
    private readonly timers = new Map<string, TimerState>();
    private idleState: IdleBoard | null = null;
    private scheduled: { render: boolean } | null = null;

    constructor(private outlet: BoardOutlet) {}

    get(id: string): TimerState | undefined {
        return this.timers.get(id);
    }

    has(timer: TimerState): boolean {
        return this.timers.get(timer.id) === timer;
    }

    values(): TimerState[] {
        return [...this.timers.values()];
    }

    get size(): number {
        return this.timers.size;
    }

    get idle(): IdleBoard | null {
        return this.idleState;
    }

    /** 出来事を当てる。同じオブジェクトへ上書きするので、描画の閉包が持つ参照は生きたまま残る。 */
    dispatch(timer: TimerState, event: TimerEvent, nowMs = Date.now()): void {
        Object.assign(timer, step(timer, event, nowMs));
        this.schedule(!QUIET.has(event.type));
    }

    add(timer: TimerState): void {
        this.timers.set(timer.id, timer);
        this.schedule(true);
    }

    remove(timer: TimerState): void {
        if (!this.timers.delete(timer.id)) return;
        this.schedule(true);
    }

    /** 提案を出すか消す。 */
    setIdle(idle: IdleBoard | null): void {
        if (idle === null && this.idleState === null) return;
        this.idleState = idle;
        this.schedule(true);
    }

    /** 保存した姿から組み直す（`TimerPersistence.restore`）。保存し直さない。 */
    restore(timers: TimerState[], idle: IdleBoard | null): void {
        for (const timer of timers) this.timers.set(timer.id, timer);
        this.idleState = idle;
    }

    clear(): void {
        this.timers.clear();
        this.idleState = null;
        this.scheduled = null;
    }

    /** 予約した保存と描画を今すぐ走らせる（テストと、ウィジェットを畳む前）。 */
    flush(): void {
        const scheduled = this.scheduled;
        if (!scheduled) return;
        this.scheduled = null;
        this.outlet.persist();
        if (scheduled.render) this.outlet.render();
    }

    private schedule(render: boolean): void {
        if (this.scheduled) {
            this.scheduled.render ||= render;
            return;
        }
        this.scheduled = { render };
        queueMicrotask(() => this.flush());
    }
}
