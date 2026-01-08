/**
 * Timer Recorder
 * 
 * Handles saving timer records to tasks or daily notes.
 */

import { App, Notice } from 'obsidian';
import TaskViewerPlugin from '../main';
import { TimerInstance } from './TimerInstance';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';

export class TimerRecorder {
    constructor(
        private app: App,
        private plugin: TaskViewerPlugin
    ) { }

    /**
     * Record a completed Pomodoro session
     */
    async addPomodoroRecord(timer: TimerInstance): Promise<void> {
        const taskIndex = this.plugin.getTaskIndex();
        const parentTask = taskIndex.getTask(timer.taskId);

        const endTime = new Date();
        const workMinutes = this.plugin.settings.pomodoroWorkMinutes;
        const startTime = new Date(endTime.getTime() - workMinutes * 60 * 1000);

        const dateStr = this.formatDate(startTime);
        const startTimeStr = this.formatTime(startTime);
        const endTimeStr = this.formatTime(endTime);

        // Use 🍅 + custom label if provided
        const customText = timer.customLabel.trim();
        const label = customText ? `🍅 ${customText}` : '🍅';

        if (parentTask) {
            // Record as child task under parent
            const childLine = `    - [x] ${label} @${dateStr}T${startTimeStr}>${endTimeStr}`;
            const taskRepository = this.plugin.getTaskRepository();
            await taskRepository.insertLineAfterTask(parentTask, childLine);
        } else if (timer.taskId.startsWith('daily-')) {
            // Daily note timer - add completed task directly to daily note
            const dailyDate = timer.taskId.replace('daily-', '');
            const taskLine = `- [x] ${label} @${dateStr}T${startTimeStr}>${endTimeStr}`;
            await this.addTimerRecordToDailyNote(dailyDate, taskLine);
        }

        new Notice('🍅 Pomodoro recorded!');
    }

    /**
     * Record a completed Countup timer session
     */
    async addCountupRecord(timer: TimerInstance): Promise<void> {
        const taskIndex = this.plugin.getTaskIndex();
        const parentTask = taskIndex.getTask(timer.taskId);

        // Calculate start and end times based on elapsed time
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - timer.elapsedTime * 1000);

        const dateStr = this.formatDate(startTime);
        const startTimeStr = this.formatTime(startTime);
        const endTimeStr = this.formatTime(endTime);

        // Use ⏱️ + custom label if provided
        const customText = timer.customLabel.trim();
        const label = customText ? `⏱️ ${customText}` : '⏱️';

        if (parentTask) {
            // Record as child task under parent
            const childLine = `    - [x] ${label} @${dateStr}T${startTimeStr}>${endTimeStr}`;
            const taskRepository = this.plugin.getTaskRepository();
            await taskRepository.insertLineAfterTask(parentTask, childLine);
        } else if (timer.taskId.startsWith('daily-')) {
            // Daily note timer - add completed task directly to daily note
            const dailyDate = timer.taskId.replace('daily-', '');
            const taskLine = `- [x] ${label} @${dateStr}T${startTimeStr}>${endTimeStr}`;
            await this.addTimerRecordToDailyNote(dailyDate, taskLine);
        }

        new Notice(`⏱️ Timer recorded! (${this.formatElapsedTime(timer.elapsedTime)})`);
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
}
