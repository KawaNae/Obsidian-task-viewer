/**
 * Timer lifecycle: tick, pause, resume, close, idle management.
 */

import { AudioUtils } from './AudioUtils';
import type {
    CountdownTimer,
    CountupTimer,
    IdleTimer,
    IntervalTimer,
    TimerInstance,
} from './TimerInstance';
import { getTimerElapsedSeconds } from './TimerInstance';
import { type TimerContext, IDLE_TIMER_ID } from './TimerContext';
import type { TimerCreator } from './TimerCreator';

export class TimerLifecycle {
    /** end の書き足しが飛んでいるタイマー。1 秒 tick の二重発行を防ぐ。 */
    private extending = new Set<string>();

    constructor(
        private ctx: TimerContext,
        private creator: TimerCreator,
    ) {}

    // ─── Tick ─────────────────────────────────────────────────

    startTimerTicker(timerId: string): void {
        const timer = this.ctx.timers.get(timerId);
        if (!timer) return;
        if (timer.intervalId !== null) {
            window.clearInterval(timer.intervalId);
            timer.intervalId = null;
        }

        timer.intervalId = window.setInterval(() => {
            this.tick(timerId);
        }, 1000);
    }

    stopTimerTick(timerId: string): void {
        const timer = this.ctx.timers.get(timerId);
        if (!timer || timer.intervalId === null) return;

        window.clearInterval(timer.intervalId);
        timer.intervalId = null;
    }

    /**
     * 走行中の行の end を書き足す門。
     *
     * 実効 end を過ぎるまでは何もしない — 毎秒の tick でインデックスを引かない
     * ための門で、判断そのものは recorder が持つ。書き込みは非同期なので、
     * 返る前の tick が二重に走らないよう実行中の id を握っておく。
     */
    private maybeExtendSessionEnd(timer: TimerInstance): void {
        if (timer.timerType === 'idle') return;
        if (timer.runState !== 'running') return;

        const floor = timer.lazyEndFloorMs;
        if (floor !== undefined && Date.now() < floor) return;
        if (this.extending.has(timer.id)) return;

        this.extending.add(timer.id);
        void this.ctx.recorder.extendRunningSession(timer)
            .then((nextFloorMs) => {
                // 引けなかったときは門を開けたままにして次の tick で再試行する。
                if (nextFloorMs !== undefined) timer.lazyEndFloorMs = nextFloorMs;
            })
            .finally(() => this.extending.delete(timer.id));
    }

    private tick(timerId: string): void {
        const timer = this.ctx.timers.get(timerId);
        if (!timer || !timer.isRunning) return;

        this.maybeExtendSessionEnd(timer);

        const now = Date.now();
        const currentSessionElapsed = Math.floor((now - timer.startTimeMs) / 1000);
        const totalElapsed = Math.max(0, timer.pausedElapsedTime + currentSessionElapsed);

        switch (timer.timerType) {
            case 'countup':
            case 'idle':
                timer.elapsedTime = totalElapsed;
                this.ctx.renderTimerItem(timerId);
                return;
            case 'countdown':
                timer.elapsedTime = totalElapsed;
                timer.timeRemaining = timer.totalTime - totalElapsed;
                timer.phase = timer.timeRemaining < 0 ? 'idle' : 'work';
                this.ctx.renderTimerItem(timerId);
                return;
            case 'interval': {
                if (timer.phase === 'prepare') {
                    const baseElapsed = this.ctx.intervalPrepareBaseElapsed.get(timerId) ?? timer.totalElapsedTime;
                    timer.totalElapsedTime = baseElapsed + Math.max(0, currentSessionElapsed);
                    this.ctx.renderTimerItem(timerId);
                    return;
                }

                const segment = this.creator.getCurrentIntervalSegment(timer);
                if (!segment) {
                    void this.finishIntervalTimer(timerId, timer);
                    return;
                }
                const segmentElapsed = Math.max(0, timer.pausedElapsedTime + currentSessionElapsed);
                timer.segmentTimeRemaining = Math.max(0, segment.durationSeconds - segmentElapsed);
                const completedBefore = this.creator.computeIntervalCompletedDuration(timer);
                timer.totalElapsedTime = this.creator.clampToTotalDuration(
                    timer,
                    completedBefore + Math.min(segment.durationSeconds, segmentElapsed)
                );

                if (timer.segmentTimeRemaining > 0) {
                    if (timer.segmentTimeRemaining <= 3) {
                        AudioUtils.playWarningBeep();
                    }
                    this.ctx.renderTimerItem(timerId);
                } else {
                    void this.handleIntervalSegmentComplete(timerId, timer);
                }
                return;
            }
            default:
                return;
        }
    }

    async handleIntervalSegmentComplete(timerId: string, timer: IntervalTimer): Promise<void> {
        this.stopTimerTick(timerId);
        const currentSegment = this.creator.getCurrentIntervalSegment(timer);
        if (!currentSegment) {
            await this.finishIntervalTimer(timerId, timer);
            return;
        }

        timer.totalElapsedTime = this.creator.clampToTotalDuration(
            timer,
            this.creator.computeIntervalCompletedDuration(timer) + currentSegment.durationSeconds
        );

        const moved = this.creator.advanceIntervalSegment(timer);
        if (!moved) {
            await this.finishIntervalTimer(timerId, timer);
            return;
        }

        AudioUtils.playTransitionConfirm();

        const nextSegment = this.creator.getCurrentIntervalSegment(timer);
        if (!nextSegment) {
            await this.finishIntervalTimer(timerId, timer);
            return;
        }

        timer.segmentTimeRemaining = nextSegment.durationSeconds;
        timer.phase = nextSegment.type;
        timer.startTimeMs = Date.now();
        timer.pausedElapsedTime = 0;
        timer.isRunning = true;
        this.startTimerTicker(timerId);
        this.ctx.render();
        this.ctx.persistTimersToStorage();
    }

    private async finishIntervalTimer(timerId: string, timer: IntervalTimer): Promise<void> {
        this.ctx.intervalPrepareBaseElapsed.delete(timerId);
        if (timer.totalDuration > 0) {
            timer.totalElapsedTime = timer.totalDuration;
        }
        timer.segmentTimeRemaining = 0;
        timer.phase = 'idle';
        timer.isRunning = false;
        timer.startTimeMs = 0;
        timer.pausedElapsedTime = timer.totalElapsedTime;
        this.stopTimerTick(timerId);

        AudioUtils.playFinishSound();
        await this.flushAndRecord(timer);
        this.closeTimer(timerId);
    }

    // ─── 記録 ─────────────────────────────────────────────────

    /**
     * セッションを 1 本書く。**記録の唯一の入口**で、`recordSessionEnd` を呼ぶのは
     * ここだけ。
     *
     * 記録は走行中の行の content を読むので、未書き込みの入力を先に流し込まないと
     * 打った名前が 1 セッション繰り越される。2 行を並べて書くと片方だけに手が入り、
     * 実際に interval の停止でそうなった（`TimerRenderer` の 2 つの停止ハンドラ）。
     */
    private async flushAndRecord(timer: TimerInstance): Promise<void> {
        await this.ctx.flushTimerContent(timer.id);
        await this.ctx.recorder.recordSessionEnd(timer);
    }

    // ─── Pause / Resume / Close ───────────────────────────────

    pauseTimer(timer: TimerInstance): void {
        const now = Date.now();
        if (timer.startTimeMs > 0) {
            const currentSessionElapsed = Math.floor((now - timer.startTimeMs) / 1000);
            timer.pausedElapsedTime += Math.max(0, currentSessionElapsed);
        }
        timer.isRunning = false;
        this.stopTimerTick(timer.id);

        switch (timer.timerType) {
            case 'countup':
            case 'idle':
                timer.elapsedTime = timer.pausedElapsedTime;
                break;
            case 'countdown':
                timer.elapsedTime = timer.pausedElapsedTime;
                timer.timeRemaining = timer.totalTime - timer.elapsedTime;
                timer.phase = timer.timeRemaining < 0 ? 'idle' : 'work';
                break;
            case 'interval': {
                const segment = this.creator.getCurrentIntervalSegment(timer);
                if (!segment) break;
                timer.segmentTimeRemaining = Math.max(0, segment.durationSeconds - timer.pausedElapsedTime);
                const completedBefore = this.creator.computeIntervalCompletedDuration(timer);
                timer.totalElapsedTime = this.creator.clampToTotalDuration(
                    timer,
                    completedBefore + Math.min(segment.durationSeconds, timer.pausedElapsedTime)
                );
                break;
            }
            default:
                break;
        }
    }

    // ─── Session state machine (countup / countdown) ──────────

    /**
     * ⏸ 中断: 走行分を**記録してから**ウィジェットを生かしたまま停める。
     *
     * 現行 Stop との違いは `closeTimer` を呼ばないことだけ。記録を書き終えた行は
     * そのまま**尻尾**として残す（`tailRecordBlockId` / `recordedChildTaskId` を
     * 切らない）— 次の再開はその隣に新しいレコードを並べるので、どこが最後だった
     * かを手放してはいけない。
     *
     * `recordMode` も触らない。v2 では 1 本目の書き方（self / child / sibling）
     * だけを表し、2 本目以降は常に尻尾の兄弟なので、中断時に書き換える理由が無い。
     *
     * interval / idle は 4 出口の対象外（呼ばれない想定だが安全側で弾く）。
     */
    async suspendTimer(timer: TimerInstance): Promise<void> {
        if (timer.timerType === 'interval' || timer.timerType === 'idle') return;
        if (timer.runState === 'suspended') return;

        this.pauseTimer(timer);
        const sessionSeconds = getTimerElapsedSeconds(timer);
        await this.flushAndRecord(timer);

        timer.recordedElapsedTime += Math.max(0, sessionSeconds);
        timer.sessionCount += 1;
        timer.runState = 'suspended';
        timer.isExpanded = false;

        // 中断は「手を止めた」合図。走行中が居なくなったなら次タスクの提案を出す。
        this.startIdleTimerIfNothingRunning();

        this.ctx.render();
        this.ctx.persistTimersToStorage();
    }

    /**
     * ▶ 再開: 新しいセッションを始める。
     *
     * **経過は 0 から**。セッション = レコード単位なので、前のセッションの
     * 経過を持ち越すと 1 レコードの長さが実際の作業と食い違う（現行
     * {@link resumeTimer} の累積保持と違う点）。合計は
     * `recordedElapsedTime` が持っている。
     *
     * 走行中がタイムラインに見えるよう、セッション行は開始時に書く。
     */
    resumeSession(timer: TimerInstance): void {
        if (timer.runState !== 'suspended') return;

        timer.runState = 'running';
        timer.startTimeMs = Date.now();
        timer.pausedElapsedTime = 0;
        timer.isRunning = true;
        timer.isExpanded = true;

        if (timer.timerType === 'countup') {
            timer.elapsedTime = 0;
        } else if (timer.timerType === 'countdown') {
            timer.elapsedTime = 0;
            timer.timeRemaining = timer.totalTime;
            timer.phase = 'work';
        }

        this.stopIdleTimer();
        this.startTimerTicker(timer.id);
        AudioUtils.playStartSound();

        // 書き先（尻尾の兄弟 / フォールバックの子）の判断は recorder が持つ。
        void (async () => {
            // 中断中に打たれた入力は直前のレコード宛。新しい行を挿す前に流し込む。
            await this.ctx.flushTimerContent(timer.id);
            const sessionTaskId = await this.ctx.recorder.startNextSession(timer);
            // 挿入の往復中に打たれた分は、尻尾が移った今の行が受け取る。
            await this.ctx.flushTimerContent(timer.id);
            if (sessionTaskId) this.ctx.persistTimersToStorage();
        })();

        this.ctx.render();
        this.ctx.persistTimersToStorage();
    }

    /**
     * ■ 終了: 走行中なら記録してからウィジェットを畳む。
     *
     * **タスクの状態は触らない**。タイマーは計測と記録の装置で、完了はユーザーが
     * checkbox で宣言するもの — v1 はここで対象タスクを `[x]` にしていたが、
     * 「状態を所有しようとしたこと」が複雑さの根だったので v2 で手放した。
     *
     * 尻尾に残っている `^id` は `closeTimer` → `onTimerClosed` が片付ける。
     */
    async finishTimer(timer: TimerInstance): Promise<void> {
        if (timer.runState === 'running' && timer.timerType !== 'idle') {
            this.pauseTimer(timer);
            const sessionSeconds = getTimerElapsedSeconds(timer);
            await this.flushAndRecord(timer);
            timer.recordedElapsedTime += Math.max(0, sessionSeconds);
            timer.sessionCount += 1;
        }

        this.closeTimer(timer.id);
    }

    /**
     * ✕ 破棄（走行中）: 今回の走行を記録せずに閉じる。
     *
     * 開始時に自分が書いた placeholder 行は道連れにする — 記録しないと決めた以上、
     * 開きかけの行だけがノートに残るのは事実ではなくゴミ。判断（本当に自分の行か）
     * は recorder 側。
     */
    async discardTimer(timer: TimerInstance): Promise<void> {
        // 先に tick を止める。走行中の行は end の書き足し対象でもあるので、
        // 消している最中の行に書き足しが飛ぶ経路を作らない。
        this.stopTimerTick(timer.id);
        // 走行中の行ごと消えるので、未書き込みの入力は書かずに捨てる。
        this.ctx.discardTimerContent(timer.id);
        await this.ctx.recorder.discardRunningPlaceholder(timer);
        this.closeTimer(timer.id);
    }

    pauseIntervalToPrepare(timer: IntervalTimer): void {
        this.pauseTimer(timer);
        timer.phase = 'prepare';
        timer.startTimeMs = Date.now();
        timer.isRunning = true;
        this.ctx.intervalPrepareBaseElapsed.set(timer.id, timer.totalElapsedTime);
        this.startTimerTicker(timer.id);
    }

    /**
     * ■ interval の停止: 走行分を記録して閉じる。
     *
     * countup / countdown の 4 出口（{@link suspendTimer} / {@link finishTimer} /
     * {@link discardTimer}）と同じく、遷移を 1 メソッドで持つ。以前は prepare 中と
     * 走行中で別々のハンドラが `TimerRenderer` に書かれていて、2026-08-17 に flush
     * を足したとき片方だけが直った。同じ形を 2 箇所に書ける限り、また割れる。
     */
    async stopIntervalTimer(timer: IntervalTimer): Promise<void> {
        this.pauseOrSnapshotIntervalForStop(timer);
        AudioUtils.playFinishSound();
        await this.flushAndRecord(timer);
        this.closeTimer(timer.id);
    }

    private pauseOrSnapshotIntervalForStop(timer: IntervalTimer): void {
        if (timer.phase === 'prepare' && timer.isRunning) {
            const now = Date.now();
            const prepareElapsed = Math.max(0, Math.floor((now - timer.startTimeMs) / 1000));
            const baseElapsed = this.ctx.intervalPrepareBaseElapsed.get(timer.id) ?? timer.totalElapsedTime;
            timer.totalElapsedTime = baseElapsed + prepareElapsed;
            timer.isRunning = false;
            this.stopTimerTick(timer.id);
            this.ctx.intervalPrepareBaseElapsed.delete(timer.id);
            return;
        }

        if (timer.isRunning) {
            this.pauseTimer(timer);
        }
        this.ctx.intervalPrepareBaseElapsed.delete(timer.id);
    }

    resumeTimer(timer: TimerInstance): void {
        if (timer.timerType === 'interval') {
            const segment = this.creator.getCurrentIntervalSegment(timer);
            if (segment) {
                timer.phase = segment.type;
            }
            this.ctx.intervalPrepareBaseElapsed.delete(timer.id);
        } else if (timer.timerType === 'countdown') {
            timer.phase = timer.timeRemaining < 0 ? 'idle' : 'work';
        } else if (timer.timerType !== 'idle' && timer.phase === 'idle') {
            timer.phase = 'work';
        }
        this.stopTimerTick(timer.id);
        timer.startTimeMs = Date.now();
        timer.isRunning = true;
        this.startTimerTicker(timer.id);
        AudioUtils.playStartSound();
        this.ctx.render();
        this.ctx.persistTimersToStorage();
    }

    closeTimer(timerId: string): void {
        const timer = this.ctx.timers.get(timerId);
        if (!timer) return;
        const closingIdleTimer = this.isIdleTimer(timerId);

        this.ctx.intervalPrepareBaseElapsed.delete(timerId);
        this.stopTimerTick(timerId);
        this.ctx.timers.delete(timerId);

        if (!closingIdleTimer) {
            this.startIdleTimerIfNothingRunning();
        }

        this.ctx.render();
        this.ctx.persistTimersToStorage();

        if (!closingIdleTimer) {
            this.ctx.onTimerClosed(timer);
        }
    }

    // ─── Idle Timer ───────────────────────────────────────────

    isIdleTimer(timerId: string): boolean {
        return timerId === IDLE_TIMER_ID;
    }

    hasNonIdleTimers(): boolean {
        for (const timerId of this.ctx.timers.keys()) {
            if (!this.isIdleTimer(timerId)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 実際に**走行している**非 idle タイマーがあるか。中断中は非稼働として
     * 数えない — 中断はユーザーが手を止めた合図なので、次タスクの提案（idle
     * タイマー）が出てほしい。
     */
    hasRunningNonIdleTimers(): boolean {
        for (const [timerId, timer] of this.ctx.timers) {
            if (this.isIdleTimer(timerId)) continue;
            if (timer.runState === 'running') return true;
        }
        return false;
    }

    /** 走行中が 1 本も無ければ idle を起こす。close と中断の共通後始末。 */
    startIdleTimerIfNothingRunning(): void {
        if (this.hasRunningNonIdleTimers()) return;
        this.startIdleTimer();
    }

    /**
     * Whether some timer is already tracking `taskId`. The map is keyed by
     * timer id, so this scans by task — which also keeps working after a file
     * rename rewrites `timer.taskId` (the old code asked `timers.has(taskId)`,
     * which silently allowed a second timer on the renamed task).
     */
    hasActiveTimerForTask(taskId: string, timerTargetId?: string): boolean {
        if (this.isIdleTimer(taskId)) {
            return this.ctx.timers.has(IDLE_TIMER_ID);
        }

        for (const timer of this.ctx.timers.values()) {
            if (timer.taskId === taskId) {
                return true;
            }
            if (timerTargetId && timer.timerTargetId === timerTargetId) {
                return true;
            }
        }

        return false;
    }

    startIdleTimer(): void {
        if (this.ctx.timers.has(IDLE_TIMER_ID)) {
            return;
        }

        const idleTimer: IdleTimer = {
            id: IDLE_TIMER_ID,
            taskId: IDLE_TIMER_ID,
            taskName: 'Idle',
            taskOriginalText: '',
            taskFile: '',
            timerTargetId: undefined,
            autoGeneratedTargetId: false,
            startTimeMs: Date.now(),
            pausedElapsedTime: 0,
            phase: 'idle',
            isRunning: true,
            runState: 'running',
            sessionCount: 0,
            recordedElapsedTime: 0,
            isExpanded: true,
            intervalId: null,
            timerType: 'idle',
            elapsedTime: 0,
            recordMode: 'child',
            parserId: 'tv-inline',
            taskColor: '',
        };

        this.ctx.timers.set(IDLE_TIMER_ID, idleTimer);
        this.startTimerTicker(IDLE_TIMER_ID);
        this.ctx.render();
    }

    stopIdleTimer(): void {
        const idleTimer = this.ctx.timers.get(IDLE_TIMER_ID);
        if (!idleTimer) {
            return;
        }

        this.stopTimerTick(IDLE_TIMER_ID);
        this.ctx.timers.delete(IDLE_TIMER_ID);
    }
}
