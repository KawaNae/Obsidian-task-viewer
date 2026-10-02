/**
 * ウィジェットの実行時の予定。保存しない。再読み込みのあとは空から始まり、
 * どれも状態（`TimerState`）から作り直せる。
 */

export class TimerRuntime {
    /** ウィジェットに 1 本の tick。開いているタイマーか提案がある間だけ回る。 */
    private tickId: number | null = null;
    /** 書き込みの往復中の操作を持つタイマー。1 つのタイマーの操作は 1 つずつ。 */
    readonly busy = new Set<string>();
    /** end の書き足しが飛んでいるタイマー。 */
    readonly extending = new Set<string>();
    /**
     * 走行中の行の実効 end（ミリ秒）。これを過ぎるまで end の書き足しを見送る門で、
     * 毎秒の tick が索引を引かずに済ませるためだけに持つ。無ければ次の tick で
     * 走行中の行から取り直す。
     */
    readonly lazyEndFloorMs = new Map<string, number>();
    /** ✕ の確認を見せているタイマーと、確認を下ろす予定。 */
    readonly closeConfirm = new Map<string, number>();
    /** 前の tick の時刻。区間の送りと 0 の越えは、前の tick から今までで決める。 */
    lastTickMs = 0;

    startTick(onTick: () => void): void {
        if (this.tickId !== null) return;
        this.lastTickMs = Date.now();
        this.tickId = window.setInterval(onTick, 1000);
    }

    stopTick(): void {
        if (this.tickId === null) return;
        window.clearInterval(this.tickId);
        this.tickId = null;
    }

    /** 閉じたタイマーの予定を落とす。 */
    forget(timerId: string): void {
        this.busy.delete(timerId);
        this.extending.delete(timerId);
        this.lazyEndFloorMs.delete(timerId);
        const confirm = this.closeConfirm.get(timerId);
        if (confirm !== undefined) window.clearTimeout(confirm);
        this.closeConfirm.delete(timerId);
    }

    clear(): void {
        this.stopTick();
        for (const id of this.closeConfirm.values()) window.clearTimeout(id);
        this.busy.clear();
        this.extending.clear();
        this.lazyEndFloorMs.clear();
        this.closeConfirm.clear();
    }
}
