import { Menu } from 'obsidian';
import { Task } from '../../../types';
import TaskViewerPlugin from '../../../main';
import { getTaskDisplayName } from '../../../utils/TaskContent';

/**
 * Builder for timer-related menu items.
 */
export class TimerMenuBuilder {
    constructor(private plugin: TaskViewerPlugin) { }

    /**
     * Adds a "Track" submenu with Countup, Pomodoro, and Countdown options.
     */
    addTimerSubmenu(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            const subMenu = (item as any)
                .setTitle('Track Self')
                .setIcon('play')
                .setSubmenu() as Menu;

            const displayName = getTaskDisplayName(task);
            const baseParams = {
                taskId: task.id,
                taskName: displayName,
                taskOriginalText: task.originalText,
                taskFile: task.file,
                recordMode: 'self' as const,
                parserId: task.parserId,
                timerTargetId: task.timerTargetId ?? task.blockId,
                autoStart: true,
            };

            // Countup
            subMenu.addItem((sub) => {
                sub.setTitle('⏱️ Start Countup')
                    .setIcon('play')
                    .onClick(() => {
                        const widget = this.plugin.getTimerWidget();
                        widget.startTimer({ ...baseParams, timerType: 'countup' });
                    });
            });

            // Pomodoro
            subMenu.addItem((sub) => {
                sub.setTitle('🍅 Start Pomodoro')
                    .setIcon('timer')
                    .onClick(() => {
                        const widget = this.plugin.getTimerWidget();
                        widget.startTimer({ ...baseParams, timerType: 'pomodoro' });
                    });
            });

            // Countdown (conditional)
            const countdownSeconds = this.calculateCountdownSeconds(task);
            if (countdownSeconds !== null) {
                subMenu.addItem((sub) => {
                    sub.setTitle('⏳ Start Countdown')
                        .setIcon('timer')
                        .onClick(() => {
                            const widget = this.plugin.getTimerWidget();
                            widget.startTimer({ ...baseParams, timerType: 'countdown', countdownSeconds });
                        });
                });
            }
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
