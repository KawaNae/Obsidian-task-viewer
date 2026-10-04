import type { App, Component, HoverParent } from 'obsidian';
import type { Task } from '../../types';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { MenuHandler, type TaskHubOpener } from '../../interaction/menu/MenuHandler';
import { TaskHubPanel, type TaskHubPanelOptions } from '../../modals/hub/TaskHubPanel';
import { openTaskInEditor } from '../../utils/NavigationUtils';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';

export interface CardRenderingDeps {
    app: App;
    plugin: PluginContext & TimerHost;
    /** Where a link's hover preview hangs. */
    getHoverParent: () => HoverParent;
    /** The view's mask mode, read on every draw. */
    getMaskMode: () => boolean;
    /** Run after the hub opens (a view clears its selection). */
    afterHubOpen?: () => void;
}

/** A card renderer, the menu its cards open, and the hub they open, made together. */
export interface CardRendering {
    taskRenderer: TaskCardRenderer;
    menuHandler: MenuHandler;
    openTaskHub: (task: Task, options?: TaskHubPanelOptions) => void;
}

/**
 * Make a card renderer with what its cards do (`CardActions`), the
 * `MenuHandler` they open and the hub they open. The hub draws its preview
 * with the same renderer and menu, and the menu opens the same hub, so the
 * three refer to each other; each is reached through a closure read when a
 * card is used, after all three are made.
 *
 * The caller adds the renderer to its own component (`addChild`).
 */
export function createCardRendering(deps: CardRenderingDeps): CardRendering {
    const { app, plugin } = deps;
    const index = plugin.getIndex();
    const operations = plugin.getOperations();

    const openTaskHub = (task: Task, options?: TaskHubPanelOptions): void => {
        void new TaskHubPanel(app, task, {
            taskRenderer,
            index,
            operations,
            plugin,
        }, options).open();
        deps.afterHubOpen?.();
    };

    const menuHandler = new MenuHandler(app, operations, plugin, (taskId, options) => {
        const task = index.getTask(taskId);
        if (task) openTaskHub(task, options);
    });

    const taskRenderer = new TaskCardRenderer({
        app,
        readService: plugin.getTaskReadService(),
        index,
        operations,
        menuPresenter: plugin.menuPresenter,
        linkRuntime: {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: deps.getHoverParent,
        },
        getSettings: () => plugin.settings,
        getMaskMode: deps.getMaskMode,
        actions: {
            openDetail: (task) => openTaskHub(task),
            showMenu: (task, x, y) => menuHandler.showTaskContextMenu(task, x, y),
            showChildMenu: (taskId, x, y) => menuHandler.showMenuForTask(taskId, x, y),
            openInEditor: (task) => openTaskInEditor(app, task, plugin.settings.reuseExistingTab),
            doubleTapAction: () => plugin.settings.doubleTapAction,
            bindMenu: (card, hooks) => menuHandler.addTaskContextMenu(card, hooks),
        },
    });

    return { taskRenderer, menuHandler, openTaskHub };
}

/** The task hub opened outside the views, and the cards it draws. */
export interface TaskHubOpenerHandle {
    open: TaskHubOpener;
    /** The renderer, menu and hub, made with the first open; null before it. */
    readonly cards: CardRendering | null;
}

/**
 * Open the task hub from outside the views (the editor's ··· menu). A view
 * opens it through its own `createCardRendering`; this one makes its cards
 * the same way with the first open, adds the renderer to `owner` so it
 * unloads with the plugin, and has no selection to clear or mask to apply.
 */
export function createTaskHubOpener(deps: {
    app: App;
    plugin: PluginContext & TimerHost;
    owner: Pick<Component, 'addChild'>;
}): TaskHubOpenerHandle {
    const hoverParent = new TaskViewHoverParent();
    let cards: CardRendering | null = null;

    const open: TaskHubOpener = (taskId, options) => {
        const task = deps.plugin.getIndex().getTask(taskId);
        if (!task) return;
        if (!cards) {
            cards = createCardRendering({
                app: deps.app,
                plugin: deps.plugin,
                getHoverParent: () => hoverParent,
                getMaskMode: () => false,
            });
            deps.owner.addChild(cards.taskRenderer);
        }
        cards.openTaskHub(task, options);
    };

    return {
        open,
        get cards() { return cards; },
    };
}
