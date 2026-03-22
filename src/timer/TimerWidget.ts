/**
 * Floating Timer Widget
 * 
 * フローティングウィジェットとして複数のタイマー（Pomodoro/Countup）を管理。
 * アコーディオン形式で個別にトグル可能。
 */

import { App, Notice } from 'obsidian';
import { t } from '../i18n';
import TaskViewerPlugin from '../main';
import { AudioUtils } from './AudioUtils';
import {
    TimerInstance,
    TimerStartConfig
} from './TimerInstance';
import { TimerRecorder } from './TimerRecorder';
import { TaskIdGenerator } from '../services/display/TaskIdGenerator';
import { TimerStorageUtils } from './TimerStorageUtils';
import { TimerCreator } from './TimerCreator';
import { TimerLifecycle } from './TimerLifecycle';
import { TimerRenderer } from './TimerRenderer';
import { TimerPersistence } from './TimerPersistence';
import { TimerTargetManager } from './TimerTargetManager';
import {
    TimerContext,
    IDLE_TIMER_ID,
} from './TimerContext';

export class TimerWidget implements TimerContext {
    readonly app: App;
    readonly plugin: TaskViewerPlugin;
    readonly timers: Map<string, TimerInstance> = new Map();
    readonly recorder: TimerRecorder;
    readonly intervalPrepareBaseElapsed: Map<string, number> = new Map();
    private storageUtils: TimerStorageUtils;
    private creator: TimerCreator;
    private lifecycle: TimerLifecycle;
    private renderer: TimerRenderer;
    private persistence: TimerPersistence;
    private targetManager: TimerTargetManager;

    constructor(app: App, plugin: TaskViewerPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.storageUtils = new TimerStorageUtils(app);
        this.recorder = new TimerRecorder(app, plugin, this.storageUtils);
        this.creator = new TimerCreator(this, this.storageUtils);
        this.lifecycle = new TimerLifecycle(this, this.creator);
        this.renderer = new TimerRenderer(this, this.lifecycle, this.creator);
        this.persistence = new TimerPersistence(this, this.creator, this.lifecycle, this.renderer, this.storageUtils);
        this.targetManager = new TimerTargetManager(this, this.storageUtils);
        this.persistence.restoreTimersFromStorage((timerId) => {
            if (!this.lifecycle.isIdleTimer(timerId)) {
                const timer = this.timers.get(timerId);
                if (timer && !timer.timerTargetId && !timer.taskId.startsWith('daily-')) {
                    void this.targetManager.ensureTimerTargetId(timerId);
                }
            }
        });
    }

    /**
     * Unified timer start API for all timer types.
     */
    startTimer(config: TimerStartConfig): void {
        if (!this.renderer.hasContainer()) {
            this.renderer.createContainer();
        }

        const taskId = config.timerType === 'idle' ? IDLE_TIMER_ID : config.taskId;
        const timerTargetId = config.timerTargetId;
        if (config.timerType !== 'idle' && this.lifecycle.hasActiveTimerForTask(taskId, timerTargetId)) {
            new Notice(t('timer.alreadyActive'));
            return;
        }

        if (config.timerType !== 'idle') {
            this.lifecycle.stopIdleTimer();
        } else if (this.timers.has(IDLE_TIMER_ID)) {
            return;
        }

        const timer = this.creator.createTimer(config);
        this.timers.set(timer.id, timer);

        if (timer.isRunning) {
            this.lifecycle.startTimerTicker(timer.id);
            if (timer.timerType !== 'idle') {
                AudioUtils.playStartSound();
            }
        }

        // Write start time immediately so the task moves on Timeline
        if (config.timerType !== 'idle' && !config.taskId.startsWith('daily-')) {
            if (config.recordMode === 'self') {
                void this.recorder.updateTaskStartTime(timer);
            } else {
                void this.createChildAndTrack(timer);
            }
        }

        this.render();
        this.persistTimersToStorage();
        if (!this.lifecycle.isIdleTimer(timer.id)
            && !timer.taskId.startsWith('daily-')
            && config.recordMode !== 'child') {
            void this.targetManager.ensureTimerTargetId(timer.id);
        }
    }

    private async createChildAndTrack(timer: TimerInstance): Promise<void> {
        const childTaskId = await this.recorder.createChildAtStart(timer);
        if (childTaskId) {
            timer.recordedChildTaskId = childTaskId;
            this.persistTimersToStorage();
        }
    }

    onTimerClosed(timer: TimerInstance): void {
        void this.targetManager.cleanupGeneratedTargetId(timer);
    }

    render(): void {
        this.renderer.render();
    }

    renderTimerItem(taskId: string): void {
        this.renderer.renderTimerItem(taskId);
    }

    handleFileRename(oldPath: string, newPath: string): void {
        let changed = false;

        for (const timer of this.timers.values()) {
            if (timer.taskFile === oldPath) {
                timer.taskFile = newPath;
                changed = true;
            }

            const renamedTaskId = TaskIdGenerator.renameFile(timer.taskId, oldPath, newPath);
            if (renamedTaskId !== timer.taskId) {
                timer.taskId = renamedTaskId;
                changed = true;
            }
        }

        if (changed) {
            this.persistTimersToStorage();
        }
    }

    persistTimersToStorage(): void {
        this.persistence.persistTimersToStorage();
    }

    destroy(): void {
        for (const [taskId] of this.timers) {
            this.lifecycle.stopTimerTick(taskId);
        }
        this.intervalPrepareBaseElapsed.clear();
        this.timers.clear();
        this.renderer.destroyContainer();
    }
}
