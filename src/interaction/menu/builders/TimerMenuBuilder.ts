import { Menu } from 'obsidian';
import { Task } from '../../../types';
import TaskViewerPlugin from '../../../main';
import { getTaskDisplayName } from '../../../utils/TaskContent';
import { IntervalParser } from '../../../timer/IntervalParser';

/**
 * Builder for timer-related menu items.
 */
export class TimerMenuBuilder {
    constructor(private plugin: TaskViewerPlugin) { }

    /**
     * Countup auto-start.
     */
    addTimerItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            const displayName = getTaskDisplayName(task);

            item.setTitle('⏱️ Start Tracking')
                .setIcon('play')
                .onClick(() => {
                    const widget = this.plugin.getTimerWidget();
                    widget.startTimer({
                        taskId: task.id,
                        taskName: displayName,
                        taskOriginalText: task.originalText,
                        taskFile: task.file,
                        recordMode: 'self',
                        parserId: task.parserId,
                        timerTargetId: task.timerTargetId ?? task.blockId,
                        timerType: 'countup',
                        autoStart: true
                    });
                });
        });
    }

    /**
     * Pomodoro auto-start (implemented as intervalSource='pomodoro' in TimerWidget).
     */
    addPomodoroItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            const displayName = getTaskDisplayName(task);

            item.setTitle('🍅 Start Pomodoro')
                .setIcon('timer')
                .onClick(() => {
                    const widget = this.plugin.getTimerWidget();
                    widget.startTimer({
                        taskId: task.id,
                        taskName: displayName,
                        taskOriginalText: task.originalText,
                        taskFile: task.file,
                        recordMode: 'self',
                        parserId: task.parserId,
                        timerTargetId: task.timerTargetId ?? task.blockId,
                        timerType: 'pomodoro',
                        autoStart: true
                    });
                });
        });
    }

    /**
     * Countdown auto-start (requires both startTime and endTime).
     */
    addCountdownItem(menu: Menu, task: Task): void {
        const countdownSeconds = this.calculateCountdownSeconds(task);
        if (countdownSeconds === null) {
            return;
        }

        menu.addItem((item) => {
            const displayName = getTaskDisplayName(task);

            item.setTitle('⏲️ Start Countdown')
                .setIcon('timer')
                .onClick(() => {
                    const widget = this.plugin.getTimerWidget();
                    widget.startTimer({
                        taskId: task.id,
                        taskName: displayName,
                        taskOriginalText: task.originalText,
                        taskFile: task.file,
                        recordMode: 'self',
                        parserId: task.parserId,
                        timerTargetId: task.timerTargetId ?? task.blockId,
                        timerType: 'countdown',
                        countdownSeconds,
                        autoStart: true
                    });
                });
        });
    }

    /**
     * Interval auto-start (requires at least one parsed segment from children).
     */
    addIntervalItem(menu: Menu, task: Task): void {
        const intervalGroups = IntervalParser.parseIntervalGroups(task, this.plugin.getTaskIndex());
        if (intervalGroups.length === 0) {
            return;
        }

        menu.addItem((item) => {
            const displayName = getTaskDisplayName(task);

            item.setTitle('🔁 Start Interval')
                .setIcon('rotate-cw')
                .onClick(() => {
                    const widget = this.plugin.getTimerWidget();
                    widget.startTimer({
                        taskId: task.id,
                        taskName: displayName,
                        taskOriginalText: task.originalText,
                        taskFile: task.file,
                        recordMode: 'self',
                        parserId: task.parserId,
                        timerTargetId: task.timerTargetId ?? task.blockId,
                        timerType: 'interval',
                        intervalGroups,
                        autoStart: true
                    });
                });
        });
    }

    private calculateCountdownSeconds(task: Task): number | null {
        if (!task.startTime || !task.endTime) {
            return null;
        }

        const startParts = task.startTime.split(':').map((v) => Number(v));
        const endParts = task.endTime.split(':').map((v) => Number(v));
        if (startParts.length !== 2 || endParts.length !== 2) {
            return null;
        }

        const [startHour, startMinute] = startParts;
        const [endHour, endMinute] = endParts;
        if (
            Number.isNaN(startHour)
            || Number.isNaN(startMinute)
            || Number.isNaN(endHour)
            || Number.isNaN(endMinute)
        ) {
            return null;
        }

        let diffMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);

        // 日付跨ぎ対応: startDate と endDate が異なる場合、日数差を加算
        if (task.startDate && task.endDate && task.startDate !== task.endDate) {
            const dayDiff = Math.round(
                (new Date(task.endDate).getTime() - new Date(task.startDate).getTime()) / 86400000
            );
            if (dayDiff > 0) {
                diffMinutes += dayDiff * 24 * 60;
            }
        }

        if (diffMinutes <= 0) {
            return null;
        }

        return diffMinutes * 60;
    }
}
