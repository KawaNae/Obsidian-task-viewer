import type { App, Menu } from 'obsidian';
import type { Task } from '../../../types';
import type { Operations } from '../../../services/operations/Operations';
import type { PluginContext } from '../../../PluginContext';
import type { TimerHost } from '../../../timer/TimerWidget';
import { CreateTaskModal } from '../../../modals/CreateTaskModal';
import { formatTaskLine } from '../../../services/parsing/TaskLineFormat';
import { confirm } from '../../../modals/ask/askChoice';
import { askFlowDelete } from '../../../modals/ask/flowDeleteChoice';
import { SendModal } from '../../../modals/noteops/SendModal';
import type { FlowDeleteOutlook } from '../../../services/flow/FlowDeletion';
import { runtimeText } from '../../../services/flow/runtimeText';
import { openTaskInEditor } from '../../../utils/NavigationUtils';
import { DateUtils } from '../../../utils/DateUtils';
import { t } from '../../../i18n';

/**
 * Task操作メニューの構築
 */
export class TaskActionsMenuBuilder {
    constructor(
        private app: App,
        private operations: Operations,
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
     * G5: 破壊的変更 — Open in Editor / Send to Note | Delete
     * 行を消す Delete だけを、区切り線で前の2つから分ける。
     * onDestructive が渡されているとき各アクション実行後に invoke する。
     */
    addDestructiveActions(menu: Menu, task: Task, onDestructive?: () => void): void {
        this.addOpenInEditorItem(menu, task, onDestructive);
        this.addSendItem(menu, task, onDestructive);
        menu.addSeparator();
        this.addDeleteItem(menu, task, onDestructive);
    }

    /**
     * "Record as Child" サブメニュー（タイマー系のみ）
     */
    private addRecordAsChildSubmenu(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            const subMenu = item
                .setTitle(t('menu.trackAsChild'))
                .setIcon('clock')
                .setSubmenu();

            // Countup
            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.startChildCountup'))
                    .setIcon('play')
                    .onClick(() => {
                        menu.close();
                        this.plugin.getTimerWidget().startTimer(task, 'child', { kind: 'countup' });
                    });
            });

            // Pomodoro
            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.startChildPomodoro'))
                    .setIcon('timer')
                    .onClick(() => {
                        menu.close();
                        this.plugin.getTimerWidget().startTimer(task, 'child', { kind: 'pomodoro' });
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
                        const taskLine = formatTaskLine({ statusChar: ' ', ...result });
                        await this.operations.insertLine(task.id, taskLine, 'firstChild');
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
                .onClick(() => {
                    menu.close();
                    openTaskInEditor(this.app, task, this.plugin.settings.reuseExistingTab);
                    onDestructive?.();
                });
        });
    }

    /**
     * "Send to Note": the row and its subtree, sent to a note the dialog
     * names (`SendModal`). It opens on the row as the disk holds it
     * (`NoteOps.previewSend`), and not when the row is not the one there,
     * which the user is told. The row leaves where it stood once it went,
     * all of it or some (`onDestructive`); a send not made keeps the dialog
     * open.
     */
    private addSendItem(menu: Menu, task: Task, onDestructive?: () => void): void {
        menu.addItem((item) => {
            item.setTitle(t('menu.sendToNote'))
                .setIcon('send')
                .onClick(async () => {
                    menu.close();
                    const ops = this.plugin.getNoteOps();
                    const preview = await ops.previewSend([task.id]);
                    if (!preview) return;
                    new SendModal(this.app, ops, preview, () => onDestructive?.()).open();
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
                sub.setTitle(t('menu.asNext'))
                    .setIcon('copy')
                    .onClick(async () => {
                        menu.close();
                        await this.operations.duplicateTask(task.id);
                    });
            });

            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.forTomorrow'))
                    .setIcon('calendar-plus')
                    .onClick(async () => {
                        menu.close();
                        await this.operations.duplicateTask(task.id, { dayOffset: 1 });
                    });
            });

            subMenu.addItem((sub) => {
                sub.setTitle(t('menu.forWeek'))
                    .setIcon('calendar-range')
                    .onClick(async () => {
                        menu.close();
                        await this.operations.duplicateTask(task.id, { dayOffset: 1, count: 7 });
                    });
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
                const nowTime = DateUtils.formatHHMM(now.getHours(), now.getMinutes());

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
                        .onClick(async () => {
                            menu.close();
                            const confirmed = await confirm(this.app, {
                                title: t('menu.switchToUndated'),
                                body: [t('menu.switchToUndatedMessage')],
                                confirmLabel: t('modal.convert'),
                            });
                            if (!confirmed) return;
                            await this.operations.updateTask(task.id, {
                                startDate: undefined,
                                startTime: undefined,
                                endDate: undefined,
                                endTime: undefined,
                                due: undefined,
                            });
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
                    await this.operations.updateTask(taskId, updates);
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
                    const { outlook, descendantFlows } = this.operations.assessFlowDelete(task.id);

                    // 発火に失敗すると削除も中止される。そのときタスクはまだ
                    // ページ上にあるので、パネルを閉じる・選択を外すといった
                    // 「消えた前提」の後始末は走らせない。
                    const remove = async (fireFlow: boolean) => {
                        if (await this.operations.deleteTask(task.id, { fireFlow })) {
                            onDestructive?.();
                        }
                    };

                    if (outlook.kind === 'creates') {
                        const choice = await askFlowDelete(this.app, { previewLine: outlook.previewLine, descendantFlows });
                        if (choice === 'cancel') return;
                        await remove(choice === 'fireAndDelete');
                        return;
                    }

                    const confirmed = await confirm(this.app, {
                        title: t('menu.deleteTaskTitle'),
                        body: this.deleteMessage(outlook, descendantFlows),
                        confirmLabel: t('modal.delete'),
                        warning: true,
                    });
                    if (confirmed) await remove(false);
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
