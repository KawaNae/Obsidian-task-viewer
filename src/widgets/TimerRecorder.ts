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

        // Use 🍅 + custom label if provided
        const customText = timer.customLabel.trim();
        const label = customText ? `🍅 ${customText}` : '🍅';

        // Create Task object and use Parser to format
        const taskObj = this.createTaskObject(label, startDateStr, startTimeStr, endDateStr, endTimeStr);
        const formattedLine = TaskParser.format(taskObj);

        if (timer.taskOriginalText && timer.taskFile) {
            // Use stored originalText for reliable lookup (avoids stale line number issues)
            const childIndent = this.getChildIndent(timer.taskOriginalText);
            const childLine = childIndent + formattedLine;
            const taskRepository = this.plugin.getTaskRepository();

            // Create a minimal task object with the info we need
            const taskForInsert = {
                file: timer.taskFile,
                originalText: timer.taskOriginalText,
                line: -1, // Will be looked up by originalText
            };
            await taskRepository.insertLineAsFirstChild(taskForInsert as any, childLine);
        } else if (timer.taskId.startsWith('daily-')) {
            // Daily note timer - add completed task directly to daily note
            const dailyDate = timer.taskId.replace('daily-', '');
            await this.addTimerRecordToDailyNote(dailyDate, formattedLine);
        }

        new Notice('🍅 Pomodoro recorded!');
    }

    /**
     * Record a completed Countup timer session
     */
    async addCountupRecord(timer: TimerInstance): Promise<void> {
        // Calculate start and end times based on elapsed time
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - timer.elapsedTime * 1000);

        const startDateStr = this.formatDate(startTime);
        const startTimeStr = this.formatTime(startTime);
        const endDateStr = this.formatDate(endTime);
        const endTimeStr = this.formatTime(endTime);

        // Use ⏱️ + custom label if provided
        const customText = timer.customLabel.trim();
        const label = customText ? `⏱️ ${customText}` : '⏱️';

        // Create Task object and use Parser to format
        const taskObj = this.createTaskObject(label, startDateStr, startTimeStr, endDateStr, endTimeStr);
        const formattedLine = TaskParser.format(taskObj);

        if (timer.taskOriginalText && timer.taskFile) {
            // Use stored originalText for reliable lookup (avoids stale line number issues)
            const childIndent = this.getChildIndent(timer.taskOriginalText);
            const childLine = childIndent + formattedLine;
            const taskRepository = this.plugin.getTaskRepository();

            // Create a minimal task object with the info we need
            const taskForInsert = {
                file: timer.taskFile,
                originalText: timer.taskOriginalText,
                line: -1, // Will be looked up by originalText
            };
            await taskRepository.insertLineAsFirstChild(taskForInsert as any, childLine);
        } else if (timer.taskId.startsWith('daily-')) {
            // Daily note timer - add completed task directly to daily note
            const dailyDate = timer.taskId.replace('daily-', '');
            await this.addTimerRecordToDailyNote(dailyDate, formattedLine);
        }

        new Notice(`⏱️ Timer recorded! (${this.formatElapsedTime(timer.elapsedTime)})`);
    }

    /**
     * Update the task's start/end times directly (for 'self' recordMode)
     * This converts the task to SE-Timed type
     */
    async updateTaskDirectly(timer: TimerInstance): Promise<void> {
        // Calculate start and end times based on elapsed time
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - timer.elapsedTime * 1000);

        const startDateStr = this.formatDate(startTime);
        const startTimeStr = this.formatTime(startTime);
        const endDateStr = this.formatDate(endTime);
        const endTimeStr = this.formatTime(endTime);

        if (timer.taskId) {
            const taskIndex = this.plugin.getTaskIndex();

            const task = taskIndex.getTask(timer.taskId);
            if (task) {
                const content = task.content.startsWith('⏱️') ? task.content : `⏱️ ${task.content}`;
                // Always pass complete data - Parser handles abbreviation
                await taskIndex.updateTask(timer.taskId, {
                    content,
                    startDate: startDateStr,
                    startTime: startTimeStr,
                    endDate: endDateStr,
                    endTime: endTimeStr,

                    statusChar: 'x' // Auto-complete when timer stops
                });
            }
        }

        new Notice(`⏱️ Task updated! (${this.formatElapsedTime(timer.elapsedTime)})`);
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

    // Utility methods
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
        // Extract the actual leading whitespace from parent
        const match = originalText.match(/^(\s*)/);
        const parentIndent = match ? match[1] : '';

        // Detect indentation style: tabs or spaces
        if (parentIndent.includes('\t')) {
            // Tab-based: add one tab
            return parentIndent + '\t';
        } else {
            // Space-based: detect unit size (commonly 2 or 4)
            // Look for the first list marker to detect indent unit
            const listMatch = originalText.match(/^(\s*)-/);
            if (listMatch) {
                const existingIndent = listMatch[1];
                // If parent has no indent, use 4 spaces as default
                if (existingIndent.length === 0) {
                    return '    ';
                }
                // Otherwise use same unit as parent's indent
                return parentIndent + existingIndent.substring(0, Math.max(2, existingIndent.length)) || '    ';
            }
            // Default: parent indent + 4 spaces
            return parentIndent + '    ';
        }
    }
}
