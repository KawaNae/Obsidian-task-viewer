import { App, Menu, Notice } from 'obsidian';
import { Task } from '../../types';
import { TaskIndex } from '../../services/core/TaskIndex';
import TaskViewerPlugin from '../../main';
import { TouchEventHandler } from './TouchEventHandler';
import { PropertyCalculator } from './PropertyCalculator';
import { PropertyFormatter } from './PropertyFormatter';
import { PropertiesMenuBuilder } from './builders/PropertiesMenuBuilder';
import { TimerMenuBuilder } from './builders/TimerMenuBuilder';
import { MoveMenuBuilder } from './builders/MoveMenuBuilder';
import { TaskActionsMenuBuilder } from './builders/TaskActionsMenuBuilder';

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
    private moveMenuBuilder: MoveMenuBuilder;
    private taskActionsMenuBuilder: TaskActionsMenuBuilder;

    private viewStartDate: string | null = null;

    constructor(
        private app: App,
        private taskIndex: TaskIndex,
        private plugin: TaskViewerPlugin
    ) {
        // Initialize services
        this.touchEventHandler = new TouchEventHandler(() => this.plugin.settings.longPressThreshold);
        this.propertyCalculator = new PropertyCalculator();
        this.propertyFormatter = new PropertyFormatter();

        // Initialize builders
        this.propertiesMenuBuilder = new PropertiesMenuBuilder(
            app,
            taskIndex,
            plugin,
            this.propertyCalculator,
            this.propertyFormatter
        );
        this.timerMenuBuilder = new TimerMenuBuilder(plugin);
        this.moveMenuBuilder = new MoveMenuBuilder(taskIndex, plugin);
        this.taskActionsMenuBuilder = new TaskActionsMenuBuilder(app, taskIndex, plugin);
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
     * Show context menu
     */
    private showContextMenu(x: number, y: number, taskInput: Task) {
        // Resolve the real task from the index
        const originalId = (taskInput as any).originalTaskId || taskInput.id;
        const task = this.taskIndex.getTask(originalId);

        if (!task) {
            new Notice('Task not found in index');
            return;
        }

        const menu = new Menu();

        // 1. Properties Submenu
        this.propertiesMenuBuilder.buildPropertiesSubmenu(menu, task, this.viewStartDate);
        menu.addSeparator();

        // 2. Timer
        this.timerMenuBuilder.addTimerItem(menu, task);
        this.timerMenuBuilder.addPomodoroItem(menu, task);
        this.timerMenuBuilder.addCountdownItem(menu, task);
        menu.addSeparator();

        // 3. Move Operations
        this.moveMenuBuilder.addMoveItems(menu, task);
        menu.addSeparator();

        // 4. Task Actions
        this.taskActionsMenuBuilder.addTaskActions(menu, task);

        menu.showAtPosition({ x, y });
    }
}
