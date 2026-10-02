import type { Menu } from 'obsidian';
import type { Task } from '../../../types';
import type { PluginContext } from '../../../PluginContext';
import type { TimerHost } from '../../../timer/TimerWidget';
import { DateUtils } from '../../../utils/DateUtils';
import { allowsSelf } from '../../../timer/TimerStartRules';
import { t } from '../../../i18n';

/**
 * Builder for timer-related menu items.
 */
export class TimerMenuBuilder {
    constructor(private plugin: PluginContext & TimerHost) { }

    /**
     * Adds Countup / Pomodoro / Countdown items directly to the root menu (G2: 自身を記録).
     * Countdown is shown only when both startTime and endTime are set.
     */
    addTrackSelfItems(menu: Menu, task: Task): void {
        // self を使えないタスク（読み取り専用、完了でフローを起こしうる）には項目を出さない。
        if (!allowsSelf(task, this.plugin.settings.statusDefinitions)) {
            return;
        }

        // Countup
        menu.addItem((item) => {
            item.setTitle(t('menu.startCountup'))
                .setIcon('play')
                .onClick(() => {
                    menu.close();
                    const widget = this.plugin.getTimerWidget();
                    widget.startTimer(task, 'self', { kind: 'countup' });
                });
        });

        // Pomodoro
        menu.addItem((item) => {
            item.setTitle(t('menu.startPomodoro'))
                .setIcon('timer')
                .onClick(() => {
                    menu.close();
                    const widget = this.plugin.getTimerWidget();
                    widget.startTimer(task, 'self', { kind: 'pomodoro' });
                });
        });

        // Countdown (conditional)
        const countdownSeconds = this.calculateCountdownSeconds(task);
        if (countdownSeconds !== null) {
            menu.addItem((item) => {
                item.setTitle(t('menu.startCountdown'))
                    .setIcon('timer')
                    .onClick(() => {
                        menu.close();
                        const widget = this.plugin.getTimerWidget();
                        widget.startTimer(task, 'self', { kind: 'countdown', seconds: countdownSeconds });
                    });
            });
        }
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
            const dayDiff = DateUtils.getDiffDays(task.startDate, task.endDate);
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
