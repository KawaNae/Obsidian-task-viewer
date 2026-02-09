/**
 * Timer Recorder
 *
 * Handles saving timer records to tasks or daily notes.
 */

import { App, Notice } from 'obsidian';
import TaskViewerPlugin from '../main';
import { TimerInstance } from './TimerInstance';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { TaskParser } from '../services/parsing/TaskParser';
import { Task } from '../types';

export class TimerRecorder {
    constructor(
        private app: App,
        private plugin: TaskViewerPlugin
    ) { }

    /**
     * Record a completed Pomodoro session
     */
    async addPomodoroRecord(timer: TimerInstance): Promise<void> {
        const endTime = new Date();
        const workMinutes = this.plugin.settings.pomodoroWorkMinutes;
        const startTime = new Date(endTime.getTime() - workMinutes * 60 * 1000);

        const startDateStr = this.formatDate(startTime);
        const startTimeStr = this.formatTime(startTime);
        const endDateStr = this.formatDate(endTime);
        const endTimeStr = this.formatTime(endTime);

        const customText = timer.customLabel.trim();
        const label = customText ? `🍅 ${customText}` : '🍅';

        const taskObj = this.createTaskObject(label, startDateStr, startTimeStr, endDateStr, endTimeStr);
        const formattedLine = TaskParser.format(taskObj);

        await this.insertChildRecord(timer, formattedLine);

        new Notice('🍅 Pomodoro recorded!');
    }

    /**
     * Record a completed Countup timer session
     */
    async addCountupRecord(timer: TimerInstance): Promise<void> {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - timer.elapsedTime * 1000);

        const startDateStr = this.formatDate(startTime);
        const startTimeStr = this.formatTime(startTime);
        const endDateStr = this.formatDate(endTime);
        const endTimeStr = this.formatTime(endTime);

        const customText = timer.customLabel.trim();
        const label = customText ? `⏱️ ${customText}` : '⏱️';

        const taskObj = this.createTaskObject(label, startDateStr, startTimeStr, endDateStr, endTimeStr);
        const formattedLine = TaskParser.format(taskObj);

        await this.insertChildRecord(timer, formattedLine);

        new Notice(`⏱️ Timer recorded! (${this.formatElapsedTime(timer.elapsedTime)})`);
    }

    /**
     * Update the task's start/end times directly (for 'self' recordMode)
     * This converts the task to SE-Timed type.
     */
    async updateTaskDirectly(timer: TimerInstance): Promise<void> {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - timer.elapsedTime * 1000);

        const startDateStr = this.formatDate(startTime);
        const startTimeStr = this.formatTime(startTime);
        const endDateStr = this.formatDate(endTime);
        const endTimeStr = this.formatTime(endTime);

        if (timer.taskId) {
            const taskIndex = this.plugin.getTaskIndex();
            const task = timer.parserId === 'frontmatter'
                ? this.resolveFrontmatterTask(timer)
                : this.resolveInlineTask(timer);

            if (!task) {
                new Notice('Timer target task was not found. It may have been deleted, moved, or renamed.');
                return;
            }

            const content = task.content.startsWith('⏱️') ? task.content : `⏱️ ${task.content}`;
            await taskIndex.updateTask(task.id, {
                content,
                startDate: startDateStr,
                startTime: startTimeStr,
                endDate: endDateStr,
                endTime: endTimeStr,
                statusChar: 'x'
            });
        }

        new Notice(`⏱️ Task updated! (${this.formatElapsedTime(timer.elapsedTime)})`);
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
            const frontmatterTask = this.resolveFrontmatterTask(timer);
            if (!frontmatterTask) {
                new Notice('Timer target task was not found. It may have been deleted, moved, or renamed.');
                return;
            }

            const taskRepository = this.plugin.getTaskRepository();
            await taskRepository.insertLineAfterFrontmatter(
                frontmatterTask.file,
                formattedLine,
                this.plugin.settings.frontmatterTaskHeader,
                this.plugin.settings.frontmatterTaskHeaderLevel
            );
            return;
        }

        const inlineTask = this.resolveInlineTask(timer);
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
     * Add timer record directly to daily note (completed task format)
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
     * Create a minimal Task object for formatting
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

    private formatElapsedTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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

    private resolveInlineTask(timer: TimerInstance): Task | undefined {
        const taskIndex = this.plugin.getTaskIndex();
        const allTasks = taskIndex.getTasks();

        if (timer.timerTargetId) {
            const byTargetInFile = timer.taskFile
                ? allTasks.find((task) =>
                    task.parserId === 'at-notation'
                    && task.file === timer.taskFile
                    && (task.timerTargetId === timer.timerTargetId || task.blockId === timer.timerTargetId)
                )
                : undefined;
            if (byTargetInFile) {
                return byTargetInFile;
            }

            const byTarget = allTasks.find((task) =>
                task.parserId === 'at-notation'
                && (task.timerTargetId === timer.timerTargetId || task.blockId === timer.timerTargetId)
            );
            if (byTarget) {
                return byTarget;
            }
        }

        const byId = taskIndex.getTask(timer.taskId);
        if (byId && byId.parserId === 'at-notation') {
            if (!timer.taskFile || byId.file === timer.taskFile) {
                return byId;
            }
        }

        if (timer.taskOriginalText && timer.taskFile) {
            const byOriginalText = allTasks.find((task) =>
                task.parserId === 'at-notation'
                && task.file === timer.taskFile
                && task.originalText === timer.taskOriginalText
            );
            if (byOriginalText) {
                return byOriginalText;
            }
        }

        return undefined;
    }

    private resolveFrontmatterTask(timer: TimerInstance): Task | undefined {
        const taskIndex = this.plugin.getTaskIndex();
        const allTasks = taskIndex.getTasks();

        if (timer.timerTargetId) {
            const byTargetInFile = timer.taskFile
                ? allTasks.find((task) =>
                    task.parserId === 'frontmatter'
                    && task.file === timer.taskFile
                    && task.timerTargetId === timer.timerTargetId
                )
                : undefined;
            if (byTargetInFile) {
                return byTargetInFile;
            }

            const byTarget = allTasks.find((task) =>
                task.parserId === 'frontmatter'
                && task.timerTargetId === timer.timerTargetId
            );
            if (byTarget) {
                return byTarget;
            }
        }

        const byId = taskIndex.getTask(timer.taskId);
        if (byId && byId.parserId === 'frontmatter') {
            return byId;
        }

        if (!timer.taskFile) {
            return undefined;
        }

        return allTasks.find((task) => task.parserId === 'frontmatter' && task.file === timer.taskFile);
    }
}
