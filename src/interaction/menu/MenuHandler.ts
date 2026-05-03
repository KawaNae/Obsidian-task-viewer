import { App, Notice } from 'obsidian';
import { Task } from '../../types';
import { TaskReadService } from '../../services/data/TaskReadService';
import { TaskWriteService } from '../../services/data/TaskWriteService';
import TaskViewerPlugin from '../../main';
import { TouchLongPressBinder } from './TouchLongPressBinder';
import { PropertyCalculator } from './PropertyCalculator';
import { PropertyFormatter } from './PropertyFormatter';
import { PropertiesMenuBuilder } from './builders/PropertiesMenuBuilder';
import { TimerMenuBuilder } from './builders/TimerMenuBuilder';
import { TaskActionsMenuBuilder } from './builders/TaskActionsMenuBuilder';
import { ValidationMenuBuilder } from './builders/ValidationMenuBuilder';
import { toDisplayTask, getOriginalTaskId } from '../../services/display/DisplayTaskConverter';

export type TaskMenuHooks = {
    /** Invoked after a destructive action (open in editor / convert to file / delete). */
    onDestructiveAction?: () => void;
};

/**
 * MenuHandler - タスクコンテキストメニューの統括ファサード
 * 各種ビルダーに処理を委譲
 */
export class MenuHandler {
    private propertyCalculator: PropertyCalculator;
    private propertyFormatter: PropertyFormatter;
    private propertiesMenuBuilder: PropertiesMenuBuilder;
    private timerMenuBuilder: TimerMenuBuilder;
    private taskActionsMenuBuilder: TaskActionsMenuBuilder;
    private validationMenuBuilder: ValidationMenuBuilder;

    private viewStartDate: string | null = null;

    constructor(
        private app: App,
        private readService: TaskReadService,
        private writeService: TaskWriteService,
        private plugin: TaskViewerPlugin
    ) {
        // Initialize services
        this.propertyCalculator = new PropertyCalculator();
        this.propertyFormatter = new PropertyFormatter();

        // Initialize builders
        this.propertiesMenuBuilder = new PropertiesMenuBuilder(
            app,
            writeService,
            plugin,
            this.propertyCalculator,
            this.propertyFormatter
        );
        this.timerMenuBuilder = new TimerMenuBuilder(plugin);
        this.taskActionsMenuBuilder = new TaskActionsMenuBuilder(app, writeService, plugin);
        this.validationMenuBuilder = new ValidationMenuBuilder();
    }

    /**
     * Set the view's left edge date for implicit start date calculation
     */
    setViewStartDate(date: string | null) {
        this.viewStartDate = date;
    }

    /**
     * Add context menu to task element
     */
    addTaskContextMenu(el: HTMLElement, task: Task, hooks?: TaskMenuHooks) {
        TouchLongPressBinder.bind(el, {
            getThreshold: () => this.plugin.settings.longPressThreshold,
            onLongPress: (x, y) => this.showContextMenu(x, y, task, hooks),
            onContextMenu: (e) => {
                e.stopPropagation();
                this.showContextMenu(e.clientX, e.clientY, task, hooks);
            },
        });
    }

    /**
     * Show context menu for a task by its ID at the given position.
     */
    showMenuForTask(taskId: string, x: number, y: number): void {
        const task = this.readService.getTask(taskId);
        if (!task) return;
        this.showContextMenu(x, y, task);
    }

    /**
     * Show context menu
     */
    private showContextMenu(x: number, y: number, taskInput: Task, hooks?: TaskMenuHooks) {
        // Resolve the real task from the index
        const originalId = getOriginalTaskId(taskInput);
        const task = this.readService.getTask(originalId);

        if (!task) {
            new Notice('Task not found in index');
            return;
        }
        if (task.isReadOnly) return;

        // Convert to DisplayTask for property display (implicit/explicit flags)
        const displayTask = toDisplayTask(task, this.plugin.settings.startHour, (id) => this.readService.getTask(id));

        this.plugin.menuPresenter.present((menu) => {
            // 0. Validation warning (if any)
            this.validationMenuBuilder.addValidationWarning(menu, task);

            // G1: 自身のデータ操作 — status / switch to / properties
            this.propertiesMenuBuilder.addStatusSubmenu(menu, task);
            this.taskActionsMenuBuilder.addOwnDataActions(menu, task);
            this.propertiesMenuBuilder.buildPropertiesSubmenu(menu, displayTask, this.viewStartDate);
            menu.addSeparator();

            // G2: 自身を記録 — countup / pomodoro / countdown
            this.timerMenuBuilder.addTrackSelfItems(menu, task);
            menu.addSeparator();

            // G3: 子のデータ操作 — record as child / add child task
            this.taskActionsMenuBuilder.addChildActions(menu, task);
            menu.addSeparator();

            // G4: 複製 — duplicate
            this.taskActionsMenuBuilder.addDuplicateActions(menu, task);
            menu.addSeparator();

            // G5: 破壊的変更 — open in editor / convert to file / delete (closes detail-modal)
            this.taskActionsMenuBuilder.addDestructiveActions(menu, task, hooks?.onDestructiveAction);
        }, { kind: 'position', x, y });
    }
}
