/**
 * Timer lifecycle: tick, pause, resume, close, idle management.
 */

import { AudioUtils } from '../utils/AudioUtils';
import {
    CountdownTimer,
    CountupTimer,
    IdleTimer,
    IntervalTimer,
    TimerInstance,
} from './TimerInstance';
import { TimerContext, IDLE_TIMER_ID } from './TimerContext';
import { TimerCreator } from './TimerCreator';

export class TimerLifecycle {
    constructor(
        private ctx: TimerContext,
        private creator: TimerCreator,
    ) {}

    // ─── Tick ─────────────────────────────────────────────────

    startTimerTicker(taskId: string): void {
        const timer = this.ctx.timers.get(taskId);
        if (!timer) return;
        if (timer.intervalId !== null) {
            window.clearInterval(timer.intervalId);
            timer.intervalId = null;
        }

        timer.intervalId = window.setInterval(() => {
            this.tick(taskId);
        }, 1000);
    }

    stopTimerTick(taskId: string): void {
        const timer = this.ctx.timers.get(taskId);
        if (!timer || timer.intervalId === null) return;

        window.clearInterval(timer.intervalId);
        timer.intervalId = null;
    }

    private tick(taskId: string): void {
        const timer = this.ctx.timers.get(taskId);
        if (!timer || !timer.isRunning) return;

        const now = Date.now();
        const currentSessionElapsed = Math.floor((now - timer.startTimeMs) / 1000);
        const totalElapsed = Math.max(0, timer.pausedElapsedTime + currentSessionElapsed);

        switch (timer.timerType) {
            case 'countup':
            case 'idle':
                timer.elapsedTime = totalElapsed;
                this.ctx.renderTimerItem(taskId);
                return;
            case 'countdown':
                timer.elapsedTime = totalElapsed;
                timer.timeRemaining = timer.totalTime - totalElapsed;
                timer.phase = timer.timeRemaining < 0 ? 'idle' : 'work';
                this.ctx.renderTimerItem(taskId);
                return;
            case 'interval': {
                if (timer.phase === 'prepare') {
                    const baseElapsed = this.ctx.intervalPrepareBaseElapsed.get(taskId) ?? timer.totalElapsedTime;
                    timer.totalElapsedTime = baseElapsed + Math.max(0, currentSessionElapsed);
                    this.ctx.renderTimerItem(taskId);
                    return;
                }

                const segment = this.creator.getCurrentIntervalSegment(timer);
                if (!segment) {
                    void this.finishIntervalTimer(taskId, timer);
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
                    this.ctx.renderTimerItem(taskId);
                } else {
                    void this.handleIntervalSegmentComplete(taskId, timer);
                }
                return;
            }
            default:
                return;
        }
    }

    async handleIntervalSegmentComplete(taskId: string, timer: IntervalTimer): Promise<void> {
        this.stopTimerTick(taskId);
        const currentSegment = this.creator.getCurrentIntervalSegment(timer);
        if (!currentSegment) {
            await this.finishIntervalTimer(taskId, timer);
            return;
        }

        timer.totalElapsedTime = this.creator.clampToTotalDuration(
            timer,
            this.creator.computeIntervalCompletedDuration(timer) + currentSegment.durationSeconds
        );

        if (currentSegment.type === 'work') {
            AudioUtils.playWorkCompleteChime();
        } else if (currentSegment.type === 'break') {
            AudioUtils.playBreakCompleteChime();
        }

        const moved = this.creator.advanceIntervalSegment(timer);
        if (!moved) {
            await this.finishIntervalTimer(taskId, timer);
            return;
        }

        const nextSegment = this.creator.getCurrentIntervalSegment(timer);
        if (!nextSegment) {
            await this.finishIntervalTimer(taskId, timer);
            return;
        }

        timer.segmentTimeRemaining = nextSegment.durationSeconds;
        timer.phase = nextSegment.type;
        timer.startTimeMs = Date.now();
        timer.pausedElapsedTime = 0;
        timer.isRunning = true;
        this.startTimerTicker(taskId);
        this.ctx.render();
        this.ctx.persistTimersToStorage();
    }

    private async finishIntervalTimer(taskId: string, timer: IntervalTimer): Promise<void> {
        this.ctx.intervalPrepareBaseElapsed.delete(taskId);
        if (timer.totalDuration > 0) {
            timer.totalElapsedTime = timer.totalDuration;
        }
        timer.segmentTimeRemaining = 0;
        timer.phase = 'idle';
        timer.isRunning = false;
        timer.startTimeMs = 0;
        timer.pausedElapsedTime = timer.totalElapsedTime;
        this.stopTimerTick(taskId);

        AudioUtils.playWorkCompleteChime();
        if (timer.recordMode === 'self') {
            await this.ctx.recorder.updateTaskDirectly(timer);
        } else {
            await this.ctx.recorder.addIntervalRecord(timer);
        }
        this.closeTimer(taskId);
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

    closeTimer(taskId: string): void {
        const timer = this.ctx.timers.get(taskId);
        if (!timer) return;
        const closingIdleTimer = this.isIdleTimer(taskId);

        this.ctx.intervalPrepareBaseElapsed.delete(taskId);
        this.stopTimerTick(taskId);
        this.ctx.timers.delete(taskId);

        if (!closingIdleTimer && !this.hasNonIdleTimers()) {
            this.startIdleTimer();
        }

        this.ctx.render();
        this.ctx.persistTimersToStorage();

        if (!closingIdleTimer) {
            this.ctx.onTimerClosed(timer);
        }
    }

    // ─── Idle Timer ───────────────────────────────────────────

    isIdleTimer(taskId: string): boolean {
        return taskId === IDLE_TIMER_ID;
    }

    hasNonIdleTimers(): boolean {
        for (const taskId of this.ctx.timers.keys()) {
            if (!this.isIdleTimer(taskId)) {
                return true;
            }
        }
        return false;
    }

    hasActiveTimerForTask(taskId: string, timerTargetId?: string): boolean {
        if (this.isIdleTimer(taskId)) {
            return this.ctx.timers.has(taskId);
        }

        if (this.ctx.timers.has(taskId)) {
            return true;
        }

        if (!timerTargetId) {
            return false;
        }

        for (const timer of this.ctx.timers.values()) {
            if (timer.timerTargetId === timerTargetId) {
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
            isExpanded: true,
            intervalId: null,
            customLabel: '',
            timerType: 'idle',
            elapsedTime: 0,
            recordMode: 'child',
            parserId: 'at-notation',
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
