import { App, MarkdownView, Menu } from 'obsidian';
import { Task, isFrontmatterTask } from '../../../types';
import { TaskIndex } from '../../../services/core/TaskIndex';
import TaskViewerPlugin from '../../../main';
import { CreateTaskModal, formatTaskLine } from '../../../modals/CreateTaskModal';
import { ConfirmModal } from '../../../modals/ConfirmModal';
import { getTaskDisplayName } from '../../../utils/TaskContent';
import { openFileInExistingOrNewTab } from '../../../utils/NavigationUtils';
import { FileOperations } from '../../../services/persistence/utils/FileOperations';
import { t } from '../../../i18n';

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
        this.addSwitchToSubmenu(menu, task);
        this.addDeleteItem(menu, task);
    }

    /**
     * "Record as Child" サブメニュー（タイマー系のみ）
     */
    private addRecordAsChildSubmenu(menu: Menu, task: Task): void {
        const displayName = getTaskDisplayName(task);

        menu.addItem((item) => {
            const subMenu = item
                .setTitle(t('menu.trackAsChild'))
                .setIcon('clock')
                .setSubmenu();

            const baseParams = {
                taskId: task.id,
                taskName: displayName,
                taskOriginalText: task.originalText,
                taskFile: task.file,
                taskColor: task.color ?? '',
                recordMode: 'child' as const,
                parserId: task.parserId,
                timerTargetId: task.timerTargetId ?? task.blockId,
                autoStart: false,
            };

            // Countup
            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.openCountup'))
                    .setIcon('play')
                    .onClick(() => {
                        const widget = this.plugin.getTimerWidget();
                        widget.startTimer({ ...baseParams, timerType: 'countup' });
                    });
            });

            // Pomodoro
            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.openPomodoro'))
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
            item.setTitle(t('menu.addChildTask'))
                .setIcon('plus')
                .onClick(() => {
                    menu.close();
                    new CreateTaskModal(this.app, async (result) => {
                        const taskLine = formatTaskLine(result);
                        const repository = this.plugin.getTaskRepository();

                        if (isFrontmatterTask(task)) {
                            await repository.insertLineAfterFrontmatter(
                                task.file, taskLine,
                                this.plugin.settings.frontmatterTaskHeader,
                                this.plugin.settings.frontmatterTaskHeaderLevel
                            );
                            return;
                        }

                        const childIndent = FileOperations.getChildIndent(task.originalText);
                        const childLine = childIndent + taskLine;
                        await repository.insertLineAsFirstChild(task, childLine);
                    }, {}, { startHour: this.plugin.settings.startHour }).open();
                });
        });
    }

    /**
     * "Open in Editor"項目を追加
     */
    private addOpenInEditorItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            item.setTitle(t('menu.openInEditor'))
                .setIcon('document')
                .onClick(async () => {
                    if (this.plugin.settings.reuseExistingTab) {
                        openFileInExistingOrNewTab(this.app, task.file);
                    } else {
                        await this.app.workspace.openLinkText(task.file, '', true);
                    }
                    if (task.line >= 0) {
                        setTimeout(() => {
                            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                            if (view) {
                                const editor = view.editor;
                                const lineText = editor.getLine(task.line);
                                editor.setSelection(
                                    { line: task.line, ch: 0 },
                                    { line: task.line, ch: lineText.length }
                                );
                                editor.focus();
                            }
                        }, 100);
                    }
                });
        });
    }

    /**
     * "Duplicate"サブメニューを追加
     */
    private addDuplicateSubmenu(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            const subMenu = item
                .setTitle(t('menu.duplicate'))
                .setIcon('copy')
                .setSubmenu();

            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.inPlace'))
                    .setIcon('copy')
                    .onClick(async () => {
                        await this.taskIndex.duplicateTask(task.id);
                    });
            });

            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.forTomorrow'))
                    .setIcon('calendar-plus')
                    .onClick(async () => {
                        await this.taskIndex.duplicateTaskForTomorrow(task.id);
                    });
            });

            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.forWeek'))
                    .setIcon('calendar-range')
                    .onClick(async () => {
                        await this.taskIndex.duplicateTaskForWeek(task.id);
                    });
            });
        });
    }

    /**
     * "Convert to" サブメニュー — ストレージ形式変換（全操作 ConfirmModal）
     */
    private addConvertSubmenu(menu: Menu, task: Task): void {
        // Frontmatter tasks have no convert options (reverse conversion is too complex)
        if (task.parserId !== 'at-notation') return;

        menu.addItem((item) => {
            const subMenu = item
                .setTitle(t('menu.convertTo'))
                .setIcon('arrow-right-left')
                .setSubmenu();

            // Inline Task → Plain Checkbox
            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.plainCheckbox'))
                    .setIcon('square')
                    .onClick(() => {
                        menu.close();
                        new ConfirmModal(
                            this.app,
                            t('menu.convertToPlainCheckbox'),
                            t('menu.convertToPlainCheckboxMessage'),
                            async () => {
                                await this.taskIndex.updateTask(task.id, {
                                    startDate: undefined,
                                    startTime: undefined,
                                    endDate: undefined,
                                    endTime: undefined,
                                    due: undefined,
                                });
                            },
                            { confirmLabel: t('modal.convert') }
                        ).open();
                    });
            });

            // Inline Task → Frontmatter Task
            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.frontmatterTask'))
                    .setIcon('file-plus')
                    .onClick(() => {
                        menu.close();
                        new ConfirmModal(
                            this.app,
                            t('menu.convertToFrontmatterTask'),
                            t('menu.convertToFrontmatterTaskMessage'),
                            async () => {
                                await this.taskIndex.convertToFrontmatterTask(task.id);
                            },
                            { confirmLabel: t('modal.convert') }
                        ).open();
                    });
            });
        });
    }

    /**
     * "Switch to" サブメニュー — 時刻属性の切替（確認なし）
     */
    private addSwitchToSubmenu(menu: Menu, task: Task): void {
        const isTimed = !!task.startTime;

        menu.addItem((item) => {
            const subMenu = item
                .setTitle(t('menu.switchTo'))
                .setIcon('repeat')
                .setSubmenu();

            if (isTimed) {
                subMenu.addItem((sub) => {
                    sub.setTitle(t('menu.allDay'))
                        .setIcon('calendar-with-checkmark')
                        .onClick(async () => {
                            await this.taskIndex.updateTask(task.id, {
                                startTime: undefined,
                                endTime: undefined,
                            });
                        });
                });
            } else {
                subMenu.addItem((sub) => {
                    sub.setTitle(t('menu.timelineMode'))
                        .setIcon('clock')
                        .onClick(async () => {
                            const startHour = this.plugin.settings.startHour;
                            const h = startHour.toString().padStart(2, '0');
                            await this.taskIndex.updateTask(task.id, {
                                startTime: `${h}:00`,
                                endTime: undefined,
                            });
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
            item.setTitle(t('menu.deleteTask'))
                .setIcon('trash')
                .setWarning(true)
                .onClick(async () => {
                    menu.close();
                    new ConfirmModal(
                        this.app,
                        t('menu.deleteTaskTitle'),
                        t('menu.deleteTaskMessage'),
                        async () => {
                            await this.taskIndex.deleteTask(task.id);
                        },
                        { confirmLabel: t('modal.delete'), warning: true }
                    ).open();
                });
        });
    }
}
