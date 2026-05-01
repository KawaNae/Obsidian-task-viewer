import { App, MarkdownView, Menu, Notice } from 'obsidian';
import { Task, isTvInline, hasBodyLine } from '../../../types';
import { TaskWriteService } from '../../../services/data/TaskWriteService';
import TaskViewerPlugin from '../../../main';
import { CreateTaskModal, formatTaskLine } from '../../../modals/CreateTaskModal';
import { ConfirmModal } from '../../../modals/ConfirmModal';
import { getTaskDisplayName } from '../../../services/parsing/utils/TaskContent';
import { openFileInExistingOrNewTab } from '../../../views/sharedLogic/NavigationUtils';
import { DateUtils } from '../../../utils/DateUtils';
import { t } from '../../../i18n';

/**
 * Task操作メニューの構築
 */
export class TaskActionsMenuBuilder {
    constructor(
        private app: App,
        private writeService: TaskWriteService,
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
        this.addConvertToFileItem(menu, task);
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
                        menu.close();
                        const widget = this.plugin.getTimerWidget();
                        widget.startTimer({ ...baseParams, timerType: 'countup' });
                    });
            });

            // Pomodoro
            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.openPomodoro'))
                    .setIcon('timer')
                    .onClick(() => {
                        menu.close();
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
                        await this.writeService.insertChildTask(task.id, taskLine);
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
                    menu.close();
                    if (this.plugin.settings.reuseExistingTab) {
                        openFileInExistingOrNewTab(this.app, task.file);
                    } else {
                        await this.app.workspace.openLinkText(task.file, '', true);
                    }
                    if (hasBodyLine(task)) {
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
                        menu.close();
                        await this.writeService.duplicateTask(task.id);
                    });
            });

            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.forTomorrow'))
                    .setIcon('calendar-plus')
                    .onClick(async () => {
                        menu.close();
                        await this.writeService.duplicateTask(task.id, { dayOffset: 1 });
                    });
            });

            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.forWeek'))
                    .setIcon('calendar-range')
                    .onClick(async () => {
                        menu.close();
                        await this.writeService.duplicateTask(task.id, { dayOffset: 1, count: 7 });
                    });
            });
        });
    }

    /**
     * "Convert to File" 単独項目 — tvInline → tvFile（ConfirmModal）
     */
    private addConvertToFileItem(menu: Menu, task: Task): void {
        // tvFile tasks have no convert options (reverse conversion is too complex)
        if (!isTvInline(task)) return;

        menu.addItem((item) => {
            item.setTitle(t('menu.convertToFile'))
                .setIcon('file-plus')
                .onClick(() => {
                    menu.close();
                    new ConfirmModal(
                        this.app,
                        t('menu.convertToFile'),
                        t('menu.convertToFileMessage'),
                        async () => {
                            try {
                                await this.writeService.convertToTvFile(task.id);
                                new Notice(t('notice.taskConverted'));
                            } catch (e) {
                                new Notice(t('notice.taskConvertFailed') + ': ' + (e as Error).message);
                            }
                        },
                        { confirmLabel: t('modal.convert') }
                    ).open();
                });
        });
    }

    /**
     * "Switch to" サブメニュー — 時刻属性の切替（確認なし）
     *
     * 出し分け:
     *  - dated かつ startDate≠今日: 「(日付維持)」「(今日)」の 2 項目
     *  - dated かつ startDate==今日: 1 項目（維持と今日が同じため）
     *  - undated: 「(今日)」相当の 1 項目（日付なしから移動）
     */
    private addSwitchToSubmenu(menu: Menu, task: Task): void {
        const isTimed = !!task.startTime;
        const today = DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
        const hasDate = !!task.startDate;
        const showBothVariants = hasDate && task.startDate !== today;

        menu.addItem((item) => {
            const subMenu = item
                .setTitle(t('menu.switchTo'))
                .setIcon('repeat')
                .setSubmenu();

            if (isTimed) {
                // → All-day
                if (showBothVariants) {
                    subMenu.addItem((sub) => {
                        sub.setTitle(t('menu.allDayKeepDate'))
                            .setIcon('calendar-with-checkmark')
                            .onClick(async () => {
                                menu.close();
                                await this.writeService.updateTask(task.id, {
                                    startTime: undefined,
                                    endDate: undefined,
                                    endTime: undefined,
                                });
                            });
                    });
                    subMenu.addItem((sub) => {
                        sub.setTitle(t('menu.allDayToday'))
                            .setIcon('calendar-with-checkmark')
                            .onClick(async () => {
                                menu.close();
                                await this.writeService.updateTask(task.id, {
                                    startDate: today,
                                    startTime: undefined,
                                    endDate: undefined,
                                    endTime: undefined,
                                });
                            });
                    });
                } else {
                    subMenu.addItem((sub) => {
                        sub.setTitle(t('menu.allDay'))
                            .setIcon('calendar-with-checkmark')
                            .onClick(async () => {
                                menu.close();
                                await this.writeService.updateTask(task.id, {
                                    startDate: hasDate ? task.startDate : today,
                                    startTime: undefined,
                                    endDate: undefined,
                                    endTime: undefined,
                                });
                            });
                    });
                }
            } else {
                // → Timeline
                const now = new Date();
                const hh = now.getHours().toString().padStart(2, '0');
                const mm = now.getMinutes().toString().padStart(2, '0');
                const nowTime = `${hh}:${mm}`;

                if (showBothVariants) {
                    subMenu.addItem((sub) => {
                        sub.setTitle(t('menu.timelineModeKeepDate'))
                            .setIcon('clock')
                            .onClick(async () => {
                                menu.close();
                                await this.writeService.updateTask(task.id, {
                                    startTime: nowTime,
                                    endDate: undefined,
                                    endTime: undefined,
                                });
                            });
                    });
                    subMenu.addItem((sub) => {
                        sub.setTitle(t('menu.timelineModeToday'))
                            .setIcon('clock')
                            .onClick(async () => {
                                menu.close();
                                await this.writeService.updateTask(task.id, {
                                    startDate: today,
                                    startTime: nowTime,
                                    endDate: undefined,
                                    endTime: undefined,
                                });
                            });
                    });
                } else {
                    subMenu.addItem((sub) => {
                        sub.setTitle(t('menu.timelineMode'))
                            .setIcon('clock')
                            .onClick(async () => {
                                menu.close();
                                await this.writeService.updateTask(task.id, {
                                    startDate: hasDate ? task.startDate : today,
                                    startTime: nowTime,
                                    endDate: undefined,
                                    endTime: undefined,
                                });
                            });
                    });
                }
            }

            // → Undated (dated タスクのみ表示)
            if (hasDate) {
                subMenu.addItem((sub) => {
                    sub.setTitle(t('menu.undated'))
                        .setIcon('calendar-x')
                        .onClick(() => {
                            menu.close();
                            new ConfirmModal(
                                this.app,
                                t('menu.switchToUndated'),
                                t('menu.switchToUndatedMessage'),
                                async () => {
                                    await this.writeService.updateTask(task.id, {
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
                            await this.writeService.deleteTask(task.id);
                        },
                        { confirmLabel: t('modal.delete'), warning: true }
                    ).open();
                });
        });
    }
}
