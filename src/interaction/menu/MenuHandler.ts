import { App, Menu, Notice } from 'obsidian';
import { Task } from '../../types';
import { TaskReadService } from '../../services/data/TaskReadService';
import { TaskWriteService } from '../../services/data/TaskWriteService';
import TaskViewerPlugin from '../../main';
import { TouchEventHandler } from './TouchEventHandler';
import { PropertyCalculator } from './PropertyCalculator';
import { PropertyFormatter } from './PropertyFormatter';
import { PropertiesMenuBuilder } from './builders/PropertiesMenuBuilder';
import { TimerMenuBuilder } from './builders/TimerMenuBuilder';
import { TaskActionsMenuBuilder } from './builders/TaskActionsMenuBuilder';
import { ValidationMenuBuilder } from './builders/ValidationMenuBuilder';
import { toDisplayTask, getOriginalTaskId } from '../../services/display/DisplayTaskConverter';

/**
 * MenuHandler - タスクコンテキストメニューの統括ファサード
 * 各種ビルダーに処理を委譲
 */
export class MenuHandler {
    private touchEventHandler: TouchEventHandler;
    private propertyCalculator: PropertyCalculator;
    private propertyFormatter: PropertyFormatter;
    private propertiesMenuBuilder: PropertiesMenuBuilder;
    private timerMenuBuilder: TimerMenuBuilder;
    private taskActionsMenuBuilder: TaskActionsMenuBuilder;
    private validationMenuBuilder: ValidationMenuBuilder;

    private viewStartDate: string | null = null;
    private currentMenu: Menu | null = null;

    constructor(
        private app: App,
        private readService: TaskReadService,
        private writeService: TaskWriteService,
        private plugin: TaskViewerPlugin
    ) {
        // Initialize services
        this.touchEventHandler = new TouchEventHandler(() => this.plugin.settings.longPressThreshold);
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
    addTaskContextMenu(el: HTMLElement, task: Task) {
        this.touchEventHandler.addTaskContextMenu(el, task, (x, y, t) => {
            this.showContextMenu(x, y, t);
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
    private showContextMenu(x: number, y: number, taskInput: Task) {
        // Resolve the real task from the index
        const originalId = getOriginalTaskId(taskInput);
        const task = this.readService.getTask(originalId);

        if (!task) {
            new Notice('Task not found in index');
            return;
        }
        if (task.isReadOnly) return;

        // Convert to DisplayTask for property display (implicit/explicit flags)
        const displayTask = toDisplayTask(task, this.plugin.settings.startHour);

        // Touch 長押しでは Obsidian Menu の outside-click による自動 close が発火しないため、
        // 前のメニューが残ったまま重なる。明示的に閉じてから新しい menu を表示する。
        this.currentMenu?.hide();

        const menu = new Menu();
        this.currentMenu = menu;
        menu.onHide(() => {
            if (this.currentMenu === menu) this.currentMenu = null;
        });

        // 0. Validation warning (if any)
        this.validationMenuBuilder.addValidationWarning(menu, task);

        // 1. Status (root level)
        this.propertiesMenuBuilder.addStatusSubmenu(menu, task);

        // 2. Properties Submenu (uses DisplayTask for correct implicit flags)
        this.propertiesMenuBuilder.buildPropertiesSubmenu(menu, displayTask, this.viewStartDate);
        menu.addSeparator();

        // 3. Start Timer (submenu)
        this.timerMenuBuilder.addTimerSubmenu(menu, task);
        menu.addSeparator();

        // 4. Task Actions (child tasks, editor, duplicate, convert, switch, delete)
        this.taskActionsMenuBuilder.addTaskActions(menu, task);

        menu.showAtPosition({ x, y });
    }
}
