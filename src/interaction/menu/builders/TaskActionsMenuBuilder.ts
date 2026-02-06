import { App, Menu } from 'obsidian';
import { Task } from '../../../types';
import { TaskIndex } from '../../../services/TaskIndex';
import TaskViewerPlugin from '../../../main';
import { CreateTaskModal, formatTaskLine } from '../../../modals/CreateTaskModal';
import { ConfirmModal } from '../../../modals/ConfirmModal';

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
        const displayName = task.content.trim() || task.file.replace(/\.md$/, '').split('/').pop() || 'Untitled';

        // Child task creation
        this.addCreateChildItem(menu, task);
        this.addPomodoroAsChildItem(menu, task, displayName);
        this.addTimerAsChildItem(menu, task, displayName);
        menu.addSeparator();

        // File operations
        this.addOpenInEditorItem(menu, task);
        this.addDuplicateSubmenu(menu, task);
        this.addDeleteItem(menu, task);
    }

    /**
     * "Create Child Task"項目を追加
     */
    private addCreateChildItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            item.setTitle('Create Child Task')
                .setIcon('plus')
                .onClick(() => {
                    new CreateTaskModal(this.app, async (result) => {
                        const taskLine = formatTaskLine(result);
                        const repository = this.plugin.getTaskRepository();

                        if (task.line === -1) {
                            // frontmatter task
                            await repository.insertLineAfterFrontmatter(task.file, taskLine);
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
     * "🍅 Open Pomodoro as Child"項目を追加
     */
    private addPomodoroAsChildItem(menu: Menu, task: Task, displayName: string): void {
        menu.addItem((item) => {
            item.setTitle('🍅 Open Pomodoro as Child')
                .setIcon('timer')
                .onClick(() => {
                    const widget = this.plugin.getTimerWidget();
                    widget.show(task.id, displayName, task.originalText, task.file);
                });
        });
    }

    /**
     * "⏱️ Open Timer as Child"項目を追加
     */
    private addTimerAsChildItem(menu: Menu, task: Task, displayName: string): void {
        menu.addItem((item) => {
            item.setTitle('⏱️ Open Timer as Child')
                .setIcon('clock')
                .onClick(() => {
                    const widget = this.plugin.getTimerWidget();
                    widget.showCountup(task.id, displayName, task.originalText, task.file);
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
                sub.setTitle('Once')
                    .setIcon('copy')
                    .onClick(async () => {
                        await this.taskIndex.duplicateTask(task.id);
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
     * "Delete"項目を追加
     */
    private addDeleteItem(menu: Menu, task: Task): void {
        menu.addItem((item) => {
            item.setTitle('Delete')
                .setIcon('trash')
                .setWarning(true)
                .onClick(async () => {
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
