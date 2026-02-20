import { Menu } from 'obsidian';
import { Task } from '../../../types';
import TaskViewerPlugin from '../../../main';
import { getTaskDisplayName } from '../../../utils/TaskContent';
import { IntervalParser } from '../../../widgets/IntervalParser';

/**
 * Timerメニューの構築
 */
export class TimerMenuBuilder {
    constructor(private plugin: TaskViewerPlugin) { }

    /**
     * Timerメニュー項目を追加
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
     * Countdownメニュー項目を追加（start/end time があるタスクのみ）
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
     * Intervalメニュー項目を追加（子行から interval セグメントが抽出できる場合のみ）
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

        const startTotalMinutes = startHour * 60 + startMinute;
        const endTotalMinutes = endHour * 60 + endMinute;
        const diffMinutes = endTotalMinutes - startTotalMinutes;
        if (diffMinutes <= 0) {
            return null;
        }

        return diffMinutes * 60;
    }
}
