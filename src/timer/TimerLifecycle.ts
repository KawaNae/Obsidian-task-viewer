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

    private tick(timerId: string): void {
        const timer = this.ctx.timers.get(timerId);
        if (!timer || !timer.isRunning) return;

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
        await this.ctx.recorder.recordSessionEnd(timer);
        this.closeTimer(timerId);
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
     * 現行 Stop との違いは `closeTimer` を呼ばないことだけ — 書き込みの種類は
     * 変えない（グループ変形はフェーズ 3）。記録を書き終えた以上、次のセッション
     * は新しいレコードになるので placeholder の紐付けは切る。
     *
     * self モードは 1 回目の記録でタスク行そのものがレコードに変形する（＝
     * `[x]` になる）。仕様上その未完了状態はフェーズ 3 で挿入するグループ
     * checkbox が持つ。ここでは 2 回目以降が親直下への追記になるよう
     * `recordMode` を child に落としておく。
     *
     * interval / idle は 4 出口の対象外（呼ばれない想定だが安全側で弾く）。
     */
    async suspendTimer(timer: TimerInstance): Promise<void> {
        if (timer.timerType === 'interval' || timer.timerType === 'idle') return;
        if (timer.runState === 'suspended') return;

        this.pauseTimer(timer);
        const sessionSeconds = getTimerElapsedSeconds(timer);
        await this.ctx.recorder.recordSessionEnd(timer);

        timer.recordedElapsedTime += Math.max(0, sessionSeconds);
        timer.sessionCount += 1;
        timer.recordedChildTaskId = undefined;
        timer.recordMode = 'child';
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
     * 走行中がタイムラインに見えるよう、child モードの慣習どおりセッション行は
     * 開始時に書く。
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

        void this.ctx.recorder.createChildAtStart(timer).then((childTaskId) => {
            if (!childTaskId) return;
            timer.recordedChildTaskId = childTaskId;
            this.ctx.persistTimersToStorage();
        });

        this.ctx.render();
        this.ctx.persistTimersToStorage();
    }

    /**
     * ✓ 完了: 走行中なら記録してから、対象タスクを完了にしてウィジェットを畳む。
     */
    async completeTimer(timer: TimerInstance): Promise<void> {
        if (timer.runState === 'running' && timer.timerType !== 'idle') {
            this.pauseTimer(timer);
            const sessionSeconds = getTimerElapsedSeconds(timer);
            await this.ctx.recorder.recordSessionEnd(timer);
            timer.recordedElapsedTime += Math.max(0, sessionSeconds);
            timer.sessionCount += 1;
            timer.recordedChildTaskId = undefined;
        }

        await this.ctx.recorder.completeTargetTask(timer);
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

    pauseOrSnapshotIntervalForStop(timer: IntervalTimer): void {
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
            customLabel: '',
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
