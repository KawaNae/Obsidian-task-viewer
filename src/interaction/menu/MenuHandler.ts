import { type App, Notice } from 'obsidian';
import type { Task } from '../../types';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';
import type TaskViewerPlugin from '../../main';
import { TouchLongPressBinder } from './TouchLongPressBinder';
import { PropertyCalculator } from './PropertyCalculator';
import { PropertyFormatter } from './PropertyFormatter';
import { PropertiesMenuBuilder } from './builders/PropertiesMenuBuilder';
import { TimerMenuBuilder } from './builders/TimerMenuBuilder';
import { TaskActionsMenuBuilder } from './builders/TaskActionsMenuBuilder';
import { ValidationMenuBuilder } from './builders/ValidationMenuBuilder';
import { toDisplayTask, getOriginalTaskId } from '../../services/display/DisplayTaskConverter';
import type { TaskHubFocusField } from '../../modals/hub/TaskHubForm';

export type TaskMenuHooks = {
    /** Invoked after a destructive action (open in editor / convert to file / delete). */
    onDestructiveAction?: () => void;
    /**
     * Properties 項目の行き先の差し替え。タスクハブモーダル内のカードから
     * 開いたメニューでは、新しいモーダルを積まず自フォームの該当フィールド
     * へ focus する（modal on modal の解消）。
     */
    onOpenPropertiesFocus?: (field: TaskHubFocusField) => void;
};

export type TaskHubOpener = (taskId: string, options?: { focusField?: TaskHubFocusField }) => void;

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
    private taskHubOpener: TaskHubOpener | null = null;

    // 同じ要素に二度 bind しない (TouchLongPressBinder は dispose を返すが
    // call site が 1-shot 想定で受け取らないため、reconcile で要素を再利用
    // するときに listener 二重化が起きる)。要素 reuse 時は context menu の
    // 振る舞いが変わらないので最初の bind だけ生かせば十分。
    private boundCards: WeakSet<HTMLElement> = new WeakSet();

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
     * メニューの Properties 項目からタスクハブモーダルを開くための opener を
     * 登録する（ビューが自分のモーダル生成関数を束ねる — setDetailCallback と
     * 同型の配線）。
     */
    setTaskHubOpener(opener: TaskHubOpener) {
        this.taskHubOpener = opener;
    }

    /**
     * Add context menu to task element
     */
    addTaskContextMenu(el: HTMLElement, task: Task, hooks?: TaskMenuHooks) {
        if (this.boundCards.has(el)) return;
        this.boundCards.add(el);
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
     * Show context menu for a task by its ID. Used by child-task menus where
     * only the (always-original) task ID is available.
     */
    showMenuForTask(taskId: string, x: number, y: number): void {
        const task = this.readService.getTask(taskId);
        if (!task) return;
        this.showContextMenu(x, y, task);
    }

    /**
     * Show context menu for a task object. Resolves split → original
     * internally via getOriginalTaskId, so callers can pass DisplayTask
     * (including split segments) directly.
     */
    showTaskContextMenu(task: Task, x: number, y: number): void {
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

        // Properties 項目の行き先: hub 内メニューなら自フォームへ focus、
        // それ以外はビュー登録の opener でタスクハブモーダルを開く。
        const openHub = (field: TaskHubFocusField) => {
            if (hooks?.onOpenPropertiesFocus) {
                hooks.onOpenPropertiesFocus(field);
                return;
            }
            this.taskHubOpener?.(task.id, { focusField: field });
        };

        this.plugin.menuPresenter.present((menu) => {
            // 0. Validation warning (if any)
            this.validationMenuBuilder.addValidationWarning(menu, task);

            // G1: 自身のデータ操作 — status / switch to / properties
            this.propertiesMenuBuilder.addStatusSubmenu(menu, task);
            this.taskActionsMenuBuilder.addOwnDataActions(menu, task);
            this.propertiesMenuBuilder.buildPropertiesSubmenu(menu, displayTask, this.viewStartDate, openHub);
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

            // G5: 破壊的変更 — open in editor / convert to file / delete (closes hub panel)
            this.taskActionsMenuBuilder.addDestructiveActions(menu, task, hooks?.onDestructiveAction);
        }, { kind: 'position', x, y });
    }
}
