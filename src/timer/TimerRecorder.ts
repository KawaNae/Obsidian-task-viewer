/**
 * Timer Recorder
 *
 * Handles saving timer records to tasks or daily notes.
 */

import { App, Notice } from 'obsidian';
import TaskViewerPlugin from '../main';
import { TimerInstance, getTimerElapsedSeconds } from './TimerInstance';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { TaskParser } from '../services/parsing/TaskParser';
import { Task } from '../types';
import { getTaskDisplayName } from '../utils/TaskContent';
import { TimeFormatter } from '../utils/TimeFormatter';
import { TimerTaskResolver } from './TimerTaskResolver';

export class TimerRecorder {
    private resolver: TimerTaskResolver;

    constructor(
        private app: App,
        private plugin: TaskViewerPlugin
    ) {
        this.resolver = new TimerTaskResolver(plugin);
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
        new Notice(`⏱️ Timer recorded! (${TimeFormatter.formatSeconds(elapsedSeconds)})`);
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
        new Notice(`⏲️ Countdown recorded! (${TimeFormatter.formatSeconds(elapsedSeconds)})`);
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
        new Notice(`${icon} ${kind} recorded! (${TimeFormatter.formatSeconds(elapsedSeconds)})`);
    }

    /**
     * Record for stopwatch-style modes; idle is intentionally ignored.
     */
    async addSessionRecord(timer: TimerInstance): Promise<void> {
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
            const task = timer.parserId === 'frontmatter'
                ? this.resolver.resolveFrontmatterTask(timer)
                : this.resolver.resolveInlineTask(timer);

            if (!task) {
                new Notice('Timer target task was not found. It may have been deleted, moved, or renamed.');
                return;
            }

            const displayName = getTaskDisplayName(task);
            const content = displayName.startsWith('⏱️ ') ? displayName : `⏱️ ${displayName}`;
            await taskIndex.updateTask(task.id, {
                content,
                startDate: startDateStr,
                startTime: startTimeStr,
                endDate: endDateStr,
                endTime: endTimeStr,
                statusChar: 'x'
            });
        }

        new Notice(`⏱️ Task updated! (${TimeFormatter.formatSeconds(elapsedSeconds)})`);
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

        if (timer.parserId === 'frontmatter') {
            const resolvedFrontmatterTask = this.resolver.resolveFrontmatterTask(timer);
            if (!resolvedFrontmatterTask) {
                new Notice('Timer target task was not found. It may have been deleted, moved, or renamed.');
                return;
            }

            const taskRepository = this.plugin.getTaskRepository();
            await taskRepository.insertLineAfterFrontmatter(
                resolvedFrontmatterTask.file,
                formattedLine,
                this.plugin.settings.frontmatterTaskHeader,
                this.plugin.settings.frontmatterTaskHeaderLevel
            );
            return;
        }

        const inlineTask = this.resolver.resolveInlineTask(timer);
        if (!inlineTask) {
            new Notice('Timer target task was not found. It may have been deleted, moved, or renamed.');
            return;
        }

        const childIndent = this.getChildIndent(inlineTask.originalText);
        const childLine = childIndent + formattedLine;
        const taskRepository = this.plugin.getTaskRepository();
        await taskRepository.insertLineAsFirstChild(inlineTask, childLine);
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
            endDate,
            endTime,
            deadline: undefined,
            explicitStartDate: true,
            explicitStartTime: true,
            explicitEndDate: true,
            explicitEndTime: true,
            commands: [],
            originalText: '',
            childLines: [],
            childLineBodyOffsets: [],
            tags: [],
            parserId: 'at-notation'
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

    /**
     * Get proper child indentation based on parent's actual indentation style.
     * Detects whether tabs or spaces are used and adds one level.
     */
    private getChildIndent(originalText: string): string {
        const match = originalText.match(/^(\s*)/);
        const parentIndent = match ? match[1] : '';

        if (parentIndent.includes('\t')) {
            return parentIndent + '\t';
        }

        const listMatch = originalText.match(/^(\s*)-/);
        if (listMatch) {
            const existingIndent = listMatch[1];
            if (existingIndent.length === 0) {
                return '    ';
            }
            return parentIndent + (existingIndent.substring(0, Math.max(2, existingIndent.length)) || '    ');
        }

        return parentIndent + '    ';
    }
}
