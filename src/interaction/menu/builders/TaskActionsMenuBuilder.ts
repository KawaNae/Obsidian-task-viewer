import { type App, MarkdownView, type Menu, Notice } from 'obsidian';
import { type Task, isTvInline, hasBodyLine } from '../../../types';
import type { TaskWriteService } from '../../../services/data/TaskWriteService';
import type { PluginContext } from '../../../PluginContext';
import type { TimerHost } from '../../../timer/TimerWidget';
import { CreateTaskModal, formatTaskLine } from '../../../modals/CreateTaskModal';
import { ConfirmModal } from '../../../modals/ConfirmModal';
import { FlowDeleteChoiceModal } from '../../../modals/FlowDeleteChoiceModal';
import type { FlowDeleteOutlook } from '../../../services/flow/FlowDeletion';
import { runtimeText } from '../../../services/flow/runtimeText';
import { getTaskDisplayName } from '../../../services/parsing/utils/TaskContent';
import { openFileInExistingOrNewTab } from '../../../utils/NavigationUtils';
import { DateUtils } from '../../../utils/DateUtils';
import { t } from '../../../i18n';
import { getEffectiveColor } from '../../../services/data/EffectiveProperties';

/**
 * Task操作メニューの構築
 */
export class TaskActionsMenuBuilder {
    constructor(
        private app: App,
        private writeService: TaskWriteService,
        private plugin: PluginContext & TimerHost
    ) { }

    /**
     * G1 残部: 自身のデータ操作 — Switch to (allday/timeline/undated)
     * ※ status / properties / track-self は他のビルダー側で追加。本ビルダーは G1 のうち switch-to のみ担当
     */
    addOwnDataActions(menu: Menu, task: Task): void {
        this.addSwitchToSubmenu(menu, task);
    }

    /**
     * G3: 子のデータ操作 — Record as Child / Add Child Task
     */
    addChildActions(menu: Menu, task: Task): void {
        this.addRecordAsChildSubmenu(menu, task);
        this.addChildTaskItem(menu, task);
    }

    /**
     * G4: 複製 — Duplicate
     */
    addDuplicateActions(menu: Menu, task: Task): void {
        this.addDuplicateSubmenu(menu, task);
    }

    /**
     * G5: 破壊的変更 — Open in Editor / Convert to File / Delete
     * onDestructive が渡されているとき各アクション実行後に invoke する。
     */
    addDestructiveActions(menu: Menu, task: Task, onDestructive?: () => void): void {
        this.addOpenInEditorItem(menu, task, onDestructive);
        this.addConvertToFileItem(menu, task, onDestructive);
        this.addDeleteItem(menu, task, onDestructive);
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
                taskColor: getEffectiveColor(task) ?? '',
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
    private addOpenInEditorItem(menu: Menu, task: Task, onDestructive?: () => void): void {
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
                    onDestructive?.();
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
    private addConvertToFileItem(menu: Menu, task: Task, onDestructive?: () => void): void {
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
                                onDestructive?.();
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
                    this.addSwitchToItem(subMenu, menu, task.id, t('menu.allDayKeepDate'), 'calendar-with-checkmark', {
                        startTime: undefined, endDate: undefined, endTime: undefined,
                    });
                    this.addSwitchToItem(subMenu, menu, task.id, t('menu.allDayToday'), 'calendar-with-checkmark', {
                        startDate: today, startTime: undefined, endDate: undefined, endTime: undefined,
                    });
                } else {
                    this.addSwitchToItem(subMenu, menu, task.id, t('menu.allDay'), 'calendar-with-checkmark', {
                        startDate: hasDate ? task.startDate : today, startTime: undefined, endDate: undefined, endTime: undefined,
                    });
                }
            } else {
                // → Timeline
                const now = new Date();
                const hh = now.getHours().toString().padStart(2, '0');
                const mm = now.getMinutes().toString().padStart(2, '0');
                const nowTime = `${hh}:${mm}`;

                if (showBothVariants) {
                    this.addSwitchToItem(subMenu, menu, task.id, t('menu.timelineModeKeepDate'), 'clock', {
                        startTime: nowTime, endDate: undefined, endTime: undefined,
                    });
                    this.addSwitchToItem(subMenu, menu, task.id, t('menu.timelineModeToday'), 'clock', {
                        startDate: today, startTime: nowTime, endDate: undefined, endTime: undefined,
                    });
                } else {
                    this.addSwitchToItem(subMenu, menu, task.id, t('menu.timelineMode'), 'clock', {
                        startDate: hasDate ? task.startDate : today, startTime: nowTime, endDate: undefined, endTime: undefined,
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

    /** switch-to サブメニューの1項目: クリックで menu を閉じて updates を書き戻す。 */
    private addSwitchToItem(subMenu: Menu, menu: Menu, taskId: string, title: string, icon: string, updates: Partial<Task>): void {
        subMenu.addItem((sub) => {
            sub.setTitle(title)
                .setIcon(icon)
                .onClick(async () => {
                    menu.close();
                    await this.writeService.updateTask(taskId, updates);
                });
        });
    }

    /**
     * "Delete"項目を追加
     *
     * フローコマンドを持つタスクは、削除がその系列の終わりになる。発火が実際に
     * 次のインスタンスを書く場合だけ 3 択を出し、それ以外（コマンドなし、until
     * 切れ、テロメア尽き、move 単独、発火不能）は通常の確認ダイアログのまま。
     * 答えが常に同じ選択肢を毎回聞かないため。
     */
    private addDeleteItem(menu: Menu, task: Task, onDestructive?: () => void): void {
        menu.addItem((item) => {
            item.setTitle(t('menu.deleteTask'))
                .setIcon('trash')
                .setWarning(true)
                .onClick(async () => {
                    menu.close();
                    const { outlook, descendantFlows } = this.writeService.assessFlowDelete(task.id);

                    // 発火に失敗すると削除も中止される。そのときタスクはまだ
                    // ページ上にあるので、パネルを閉じる・選択を外すといった
                    // 「消えた前提」の後始末は走らせない。
                    const remove = async (fireFlow: boolean) => {
                        if (await this.writeService.deleteTask(task.id, { fireFlow })) {
                            onDestructive?.();
                        }
                    };

                    if (outlook.kind === 'creates') {
                        new FlowDeleteChoiceModal(
                            this.app,
                            { previewLine: outlook.previewLine, descendantFlows },
                            (choice) => {
                                if (choice === 'cancel') return;
                                void remove(choice === 'fireAndDelete');
                            }
                        ).open();
                        return;
                    }

                    new ConfirmModal(
                        this.app,
                        t('menu.deleteTaskTitle'),
                        this.deleteMessage(outlook, descendantFlows),
                        () => void remove(false),
                        { confirmLabel: t('modal.delete'), warning: true }
                    ).open();
                });
        });
    }

    /**
     * 確認ダイアログの本文。削除がフローに与える影響を、分かっている分だけ足す。
     *
     * 発火不能だった場合に理由を出すのは、コマンドを書いた本人が「なぜ発火して
     * 削除を選べないのか」をその場で知れる唯一の機会だから。
     */
    private deleteMessage(outlook: FlowDeleteOutlook, descendantFlows: number): string[] {
        const lines = [t('menu.deleteTaskMessage')];
        if (outlook.kind === 'failed') {
            lines.push(t('flowDelete.cannotFire', { reason: runtimeText(outlook.error) }));
        }
        if (descendantFlows > 0) {
            lines.push(t('flowDelete.descendants', { count: String(descendantFlows) }));
        }
        return lines;
    }
}
