/**
 * Timer Recorder
 *
 * Handles saving timer records to tasks or daily notes.
 */

import { App, Notice } from 'obsidian';
import { t } from '../i18n';
import TaskViewerPlugin from '../main';
import { TimerInstance, getTimerElapsedSeconds } from './TimerInstance';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { TaskParser } from '../services/parsing/TaskParser';
import { Task, isFrontmatterTask } from '../types';
import { TimeFormatter } from '../utils/TimeFormatter';
import { TimerTaskResolver } from './TimerTaskResolver';
import { TimerStorageUtils } from './TimerStorageUtils';

export class TimerRecorder {
    private resolver: TimerTaskResolver;
    private storageUtils: TimerStorageUtils;

    constructor(
        private app: App,
        private plugin: TaskViewerPlugin,
        storageUtils: TimerStorageUtils
    ) {
        this.resolver = new TimerTaskResolver(plugin);
        this.storageUtils = storageUtils;
    }

    /**
     * Record a completed Countup timer session.
     */
    async addCountupRecord(timer: TimerInstance): Promise<void> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const taskObj = this.createTaskObject(
            timer.customLabel.trim() ? `⏱️ ${timer.customLabel.trim()}` : '⏱️',
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        const formattedLine = TaskParser.format(taskObj);

        await this.insertChildRecord(timer, formattedLine);
        new Notice(t('notice.timerRecorded', { icon: '⏱️', duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * Record a completed Countdown timer session.
     */
    async addCountdownRecord(timer: TimerInstance): Promise<void> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const taskObj = this.createTaskObject(
            timer.customLabel.trim() ? `⏲️ ${timer.customLabel.trim()}` : '⏲️',
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        const formattedLine = TaskParser.format(taskObj);

        await this.insertChildRecord(timer, formattedLine);
        new Notice(t('notice.countdownRecorded', { icon: '⏲️', duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * Record a completed Interval timer session.
     * Pomodoro-origin intervals are recorded with 🍅 label.
     */
    async addIntervalRecord(timer: TimerInstance): Promise<void> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const isPomodoroSource = timer.timerType === 'interval' && timer.intervalSource === 'pomodoro';
        const icon = isPomodoroSource ? '🍅' : '🔁';
        const custom = timer.customLabel.trim();
        const label = custom ? `${icon} ${custom}` : icon;

        const taskObj = this.createTaskObject(
            label,
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        const formattedLine = TaskParser.format(taskObj);

        await this.insertChildRecord(timer, formattedLine);
        const kind = isPomodoroSource ? 'Pomodoro' : 'Interval';
        new Notice(t('notice.kindRecorded', { icon, kind, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * Record for stopwatch-style modes; idle is intentionally ignored.
     * If a child task was created at start (recordedChildTaskId), update it instead.
     */
    async addSessionRecord(timer: TimerInstance): Promise<void> {
        if (timer.recordedChildTaskId) {
            await this.updateChildAtEnd(timer);
            return;
        }
        switch (timer.timerType) {
            case 'countup':
                await this.addCountupRecord(timer);
                break;
            case 'countdown':
                await this.addCountdownRecord(timer);
                break;
            case 'interval':
                await this.addIntervalRecord(timer);
                break;
            case 'idle':
                // No record for idle yet.
                break;
            default:
                break;
        }
    }

    /**
     * Write startDate/startTime to the task at timer start (for 'self' recordMode).
     * - Timeline tasks (has startTime): parallel translation — preserve duration
     * - Allday tasks (no startTime): discard endDate/endTime, convert to S-Timed
     */
    async updateTaskStartTime(timer: TimerInstance): Promise<void> {
        const now = new Date();
        const taskIndex = this.plugin.getTaskIndex();
        const task = isFrontmatterTask(timer)
            ? this.resolver.resolveFrontmatterTask(timer)
            : this.resolver.resolveInlineTask(timer);

        if (!task) return;

        const updates: Record<string, string | undefined> = {
            startDate: this.formatDate(now),
            startTime: this.formatTime(now),
        };

        if (task.startTime) {
            // Timeline task (has time): parallel translation — preserve duration
            // Resolve implicit endDate for same-day notation (e.g., @dateThh:mm>hh:mm)
            const effectiveEndDate = task.endDate ?? (task.endTime ? task.startDate : undefined);

            if (task.startDate && effectiveEndDate && task.endTime) {
                const oldStart = new Date(`${task.startDate}T${task.startTime}`);
                const oldEnd = new Date(`${effectiveEndDate}T${task.endTime}`);
                const durationMs = oldEnd.getTime() - oldStart.getTime();
                const newEnd = new Date(now.getTime() + durationMs);
                updates.endDate = this.formatDate(newEnd);
                updates.endTime = this.formatTime(newEnd);
            }
        } else {
            // Allday task (no time): discard endDate, convert to S-Timed
            if (task.endDate) {
                updates.endDate = undefined;
            }
            if (task.endTime) {
                updates.endTime = undefined;
            }
        }

        await taskIndex.updateTask(task.id, updates);
    }

    /**
     * Create a child task at timer start (for 'child' recordMode).
     * Inserts a placeholder child with startDate/startTime and a blockId for tracking.
     * Returns the child task ID, or undefined if insertion failed.
     */
    async createChildAtStart(timer: TimerInstance): Promise<string | undefined> {
        if (timer.taskId.startsWith('daily-')) return undefined;

        const now = new Date();
        const blockId = this.storageUtils.generateTimerTargetId();
        const label = timer.customLabel.trim();

        const taskObj = this.createTaskObject(
            label,
            this.formatDate(now),
            this.formatTime(now),
            '', ''
        );
        taskObj.statusChar = ' ';
        taskObj.blockId = blockId;

        const formattedLine = TaskParser.format(taskObj);
        await this.insertChildRecord(timer, formattedLine);

        // Wait for scan to pick up the new child, then find it by blockId
        const parentTask = isFrontmatterTask(timer)
            ? this.resolver.resolveFrontmatterTask(timer)
            : this.resolver.resolveInlineTask(timer);
        if (!parentTask) return undefined;

        const taskIndex = this.plugin.getTaskIndex();
        await taskIndex.waitForScan(parentTask.file);

        const child = taskIndex.getTasks().find(t =>
            t.file === parentTask.file && t.blockId === blockId
        );
        return child?.id;
    }

    /**
     * Update the child task created at timer start with end time and completion.
     */
    private async updateChildAtEnd(timer: TimerInstance): Promise<void> {
        const taskIndex = this.plugin.getTaskIndex();
        const child = taskIndex.getTask(timer.recordedChildTaskId!);

        if (!child) {
            // Fallback: child was deleted, create a new record
            new Notice(t('notice.childTaskNotFound'));
            timer.recordedChildTaskId = undefined;
            switch (timer.timerType) {
                case 'countup': await this.addCountupRecord(timer); break;
                case 'countdown': await this.addCountdownRecord(timer); break;
                case 'interval': await this.addIntervalRecord(timer); break;
                default: break;
            }
            return;
        }

        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = new Date();

        const icon = this.getTimerIcon(timer);
        const existingContent = child.content.trim();
        const content = existingContent ? `${icon} ${existingContent}` : icon;

        await taskIndex.updateTask(child.id, {
            content,
            endDate: this.formatDate(endTime),
            endTime: this.formatTime(endTime),
            statusChar: 'x',
            blockId: undefined,
        });

        const kind = this.getTimerKind(timer);
        new Notice(t('notice.kindRecorded', { icon, kind, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * Get the emoji icon for a timer type.
     */
    private getTimerIcon(timer: TimerInstance): string {
        if (timer.timerType === 'interval') {
            return timer.intervalSource === 'pomodoro' ? '🍅' : '🔁';
        }
        if (timer.timerType === 'countdown') return '⏳';
        return '⏱️';
    }

    /**
     * Get the display kind name for a timer type.
     */
    private getTimerKind(timer: TimerInstance): string {
        if (timer.timerType === 'interval') {
            return timer.intervalSource === 'pomodoro' ? 'Pomodoro' : 'Interval';
        }
        if (timer.timerType === 'countdown') return 'Countdown';
        return 'Timer';
    }

    /**
     * Update the task's start/end times directly (for 'self' recordMode).
     * This converts the task to SE-Timed type.
     */
    async updateTaskDirectly(timer: TimerInstance): Promise<void> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const startDateStr = this.formatDate(startTime);
        const startTimeStr = this.formatTime(startTime);
        const endDateStr = this.formatDate(endTime);
        const endTimeStr = this.formatTime(endTime);

        if (timer.taskId) {
            const taskIndex = this.plugin.getTaskIndex();
            const task = isFrontmatterTask(timer)
                ? this.resolver.resolveFrontmatterTask(timer)
                : this.resolver.resolveInlineTask(timer);

            if (!task) {
                new Notice(t('notice.timerTargetNotFound'));
                return;
            }

            const icon = this.getTimerIcon(timer);
            const existingContent = task.content.trim();

            const updates: Partial<Task> = {
                startDate: startDateStr,
                startTime: startTimeStr,
                endDate: endDateStr,
                endTime: endTimeStr,
                statusChar: 'x',
                // 自動生成IDのみクリア、ユーザーの手動blockIdは保持
                blockId: timer.autoGeneratedTargetId ? undefined : task.blockId,
                content: existingContent.startsWith(icon)
                    ? existingContent
                    : existingContent
                        ? `${icon} ${existingContent}`
                        : icon,
            };

            await taskIndex.updateTask(task.id, updates);
        }

        const icon = this.getTimerIcon(timer);
        new Notice(t('notice.taskUpdated', { icon, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * Insert a child record line for the given timer.
     * Frontmatter/inline both resolve target with timerTargetId first.
     */
    private async insertChildRecord(timer: TimerInstance, formattedLine: string): Promise<void> {
        if (timer.taskId.startsWith('daily-')) {
            const dailyDate = timer.taskId.replace('daily-', '');
            await this.addTimerRecordToDailyNote(dailyDate, formattedLine);
            return;
        }

        const resolvedTask = isFrontmatterTask(timer)
            ? this.resolver.resolveFrontmatterTask(timer)
            : this.resolver.resolveInlineTask(timer);

        if (!resolvedTask) {
            new Notice(t('notice.timerTargetNotFound'));
            return;
        }

        await this.plugin.getTaskWriteService().insertChildTask(resolvedTask.id, formattedLine);
    }

    /**
     * Add timer record directly to daily note (completed task format).
     */
    private async addTimerRecordToDailyNote(dateStr: string, taskLine: string): Promise<void> {
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date();
        date.setFullYear(y, m - 1, d);
        date.setHours(0, 0, 0, 0);

        await DailyNoteUtils.appendLineToDailyNote(
            this.app,
            date,
            taskLine,
            this.plugin.settings.dailyNoteHeader,
            this.plugin.settings.dailyNoteHeaderLevel
        );
    }

    /**
     * Create a minimal Task object for formatting.
     */
    private createTaskObject(
        label: string,
        startDate: string,
        startTime: string,
        endDate: string,
        endTime: string
    ): Task {
        return {
            id: 'timer-temp',
            file: '',
            line: 0,
            indent: 0,
            content: label,
            statusChar: 'x',
            parentId: undefined,
            childIds: [],
            startDate,
            startTime,
            endDate: endDate || undefined,
            endTime: endTime || undefined,
            due: undefined,
            commands: [],
            originalText: '',
            childLines: [],
            childLineBodyOffsets: [],
            tags: [],
            parserId: 'tv-inline',
            properties: {},
        };
    }

    private formatDate(d: Date): string {
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private formatTime(d: Date): string {
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }

}
