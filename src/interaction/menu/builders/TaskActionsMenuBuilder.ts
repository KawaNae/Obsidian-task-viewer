import { App, Menu } from 'obsidian';
import { Task } from '../../../types';
import { TaskIndex } from '../../../services/core/TaskIndex';
import TaskViewerPlugin from '../../../main';
import { CreateTaskModal, formatTaskLine } from '../../../modals/CreateTaskModal';
import { ConfirmModal } from '../../../modals/ConfirmModal';
import { getTaskDisplayName } from '../../../utils/TaskContent';

/**
 * Task操作メニューの構築
 */
export class TaskActionsMenuBuilder {
    constructor(
        private app: App,
        private taskIndex: TaskIndex,
        private plugin: TaskViewerPlugin
    ) { }

    /**
     * Task操作メニューを追加
     */
    addTaskActions(menu: Menu, task: Task): void {
        // Record as Child (timer submenu)
        this.addRecordAsChildSubmenu(menu, task);
        // Add Child Task (standalone)
        this.addChildTaskItem(menu, task);
        menu.addSeparator();

        // File operations
        this.addOpenInEditorItem(menu, task);
        this.addDuplicateSubmenu(menu, task);
        this.addConvertSubmenu(menu, task);
        this.addDeleteItem(menu, task);
    }

    /**
     * "Record as Child" サブメニュー（タイマー系のみ）
     */
    private addRecordAsChildSubmenu(menu: Menu, task: Task): void {
        const displayName = getTaskDisplayName(task);

        menu.addItem((item) => {
            const subMenu = (item as any)
                .setTitle('Track as Child')
                .setIcon('clock')
                .setSubmenu() as Menu;

            const baseParams = {
                taskId: task.id,
                taskName: displayName,
                taskOriginalText: task.originalText,
                taskFile: task.file,
                recordMode: 'child' as const,
                parserId: task.parserId,
                timerTargetId: task.timerTargetId ?? task.blockId,
                autoStart: false,
            };

            // Countup
            subMenu.addItem((sub) => {
                sub.setTitle('⏱️ Open Countup')
                    .setIcon('play')
                    .onClick(() => {
                        const widget = this.plugin.getTimerWidget();
                        widget.startTimer({ ...baseParams, timerType: 'countup' });
                    });
            });

            // Pomodoro
            subMenu.addItem((sub) => {
                sub.setTitle('🍅 Open Pomodoro')
                    .setIcon('timer')
                    .onClick(() => {
                        const widget = this.plugin.getTimerWidget();
                        widget.startTimer({ ...baseParams, timerType: 'pomodoro' });
                    });
            });
        });
    }

    /**
     * "Add Child Task" 単独項目（CreateTaskModal）
     */
    private addChildTaskItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            item.setTitle('Add Child Task')
                .setIcon('plus')
                .onClick(() => {
                    menu.close();
                    new CreateTaskModal(this.app, async (result) => {
                        const taskLine = formatTaskLine(result);
                        const repository = this.plugin.getTaskRepository();

                        if (task.parserId === 'frontmatter') {
                            await repository.insertLineAfterFrontmatter(
                                task.file, taskLine,
                                this.plugin.settings.frontmatterTaskHeader,
                                this.plugin.settings.frontmatterTaskHeaderLevel
                            );
                            return;
                        }

                        const match = task.originalText.match(/^(\s*)/);
                        const parentIndent = match ? match[1] : '';
                        const childIndent = parentIndent.includes('\t') ? parentIndent + '\t' : parentIndent + '    ';
                        const childLine = childIndent + taskLine;
                        await repository.insertLineAsFirstChild(task, childLine);
                    }).open();
                });
        });
    }

    /**
     * "Open in Editor"項目を追加
     */
    private addOpenInEditorItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            item.setTitle('Open in Editor')
                .setIcon('document')
                .onClick(async () => {
                    await this.app.workspace.openLinkText(task.file, '', true);
                });
        });
    }

    /**
     * "Duplicate"サブメニューを追加
     */
    private addDuplicateSubmenu(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            const subMenu = (item as any)
                .setTitle('Duplicate')
                .setIcon('copy')
                .setSubmenu() as Menu;

            subMenu.addItem((sub) => {
                sub.setTitle('In Place')
                    .setIcon('copy')
                    .onClick(async () => {
                        await this.taskIndex.duplicateTask(task.id);
                    });
            });

            subMenu.addItem((sub) => {
                sub.setTitle('For Tomorrow')
                    .setIcon('calendar-plus')
                    .onClick(async () => {
                        await this.taskIndex.duplicateTaskForTomorrow(task.id);
                    });
            });

            subMenu.addItem((sub) => {
                sub.setTitle('For Week (7 days)')
                    .setIcon('calendar-range')
                    .onClick(async () => {
                        await this.taskIndex.duplicateTaskForWeek(task.id);
                    });
            });
        });
    }

    /**
     * "Convert to" サブメニュー（Move + Convert 統合）
     */
    private addConvertSubmenu(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            const subMenu = (item as any)
                .setTitle('Convert to')
                .setIcon('arrow-right-left')
                .setSubmenu() as Menu;

            const isTime = !!task.startTime;

            if (isTime) {
                subMenu.addItem((sub) => {
                    sub.setTitle('All Day')
                        .setIcon('calendar-with-checkmark')
                        .onClick(async () => {
                            await this.taskIndex.updateTask(task.id, {
                                startTime: undefined,
                                endTime: undefined
                            });
                        });
                });

                if (task.deadline) {
                    subMenu.addItem((sub) => {
                        sub.setTitle('All Day (Deadline only)')
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
            } else {
                subMenu.addItem((sub) => {
                    sub.setTitle('Timeline')
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

            if (task.parserId === 'at-notation') {
                subMenu.addItem((sub) => {
                    sub.setTitle('Frontmatter Task')
                        .setIcon('file-plus')
                        .onClick(async () => {
                            await this.taskIndex.convertToFrontmatterTask(task.id);
                        });
                });
            }
        });
    }

    /**
     * "Delete"項目を追加
     */
    private addDeleteItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            item.setTitle('Delete')
                .setIcon('trash')
                .setWarning(true)
                .onClick(async () => {
                    menu.close();
                    new ConfirmModal(
                        this.app,
                        'Delete Task',
                        'Are you sure you want to delete this task?',
                        async () => {
                            await this.taskIndex.deleteTask(task.id);
                        }
                    ).open();
                });
        });
    }
}
