import { Menu } from 'obsidian';
import { Task } from '../../../types';
import { TaskIndex } from '../../../services/TaskIndex';
import TaskViewerPlugin from '../../../main';

/**
 * Move操作メニューの構築
 */
export class MoveMenuBuilder {
    constructor(
        private taskIndex: TaskIndex,
        private plugin: TaskViewerPlugin
    ) { }

    /**
     * Move操作メニューを追加
     */
    addMoveItems(menu: Menu, task: Task): void {
        const isTime = !!task.startTime;

        if (isTime) {
            // S-Timed, SE-Timed, SED-Timed
            this.addMoveToAllDayItem(menu, task);

            if (task.deadline) {
                this.addMoveToDeadlineOnlyItem(menu, task);
            }
        } else {
            // All-Day / Long-Term
            this.addMoveToTimelineItem(menu, task);
        }
    }

    /**
     * "Move to All Day"項目を追加
     */
    private addMoveToAllDayItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            item.setTitle('Move to All Day')
                .setIcon('calendar-with-checkmark')
                .onClick(async () => {
                    await this.taskIndex.updateTask(task.id, {
                        startTime: undefined,
                        endTime: undefined
                    });
                });
        });
    }

    /**
     * "Move to All Day (Deadline only)"項目を追加
     */
    private addMoveToDeadlineOnlyItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            item.setTitle('Move to All Day (Deadline only)')
                .setIcon('calendar-clock')
                .onClick(async () => {
                    await this.taskIndex.updateTask(task.id, {
                        startDate: undefined,
                        startTime: undefined,
                        endDate: undefined,
                        endTime: undefined
                    });
                });
        });
    }

    /**
     * "Move to Timeline"項目を追加
     */
    private addMoveToTimelineItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            item.setTitle('Move to Timeline')
                .setIcon('clock')
                .onClick(async () => {
                    const startHour = this.plugin.settings.startHour;
                    const h = startHour.toString().padStart(2, '0');

                    await this.taskIndex.updateTask(task.id, {
                        startTime: `${h}:00`,
                        endTime: undefined
                    });
                });
        });
    }
}
