/**
 * Renders pinned lists in the sidebar. Each list has its own FilterState
 * and appears as a collapsible group with task cards.
 */

import { t } from '../../i18n';
import {
    renderListSection,
    startListSectionRename,
    type ListSectionClasses,
} from './ListSectionRenderer';
import type { DisplayTask, PinnedListDefinition } from '../../types';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import type { MenuHandler } from '../../interaction/menu/MenuHandler';
import { combineFilterStates, type FilterState } from '../../services/filter/FilterTypes';
import type { PluginContext } from '../../PluginContext';
import { TaskStyling } from './TaskStyling';
import { getEffectiveColor, getEffectiveLinestyle } from '../../services/data/EffectiveProperties';
import { TaskPagingController } from './TaskPagingController';
import { CardReconciler } from './CardReconciler';
import { shouldRenderForChanges } from './RenderScheduler';
import { HostFrameScheduler } from '../../utils/HostWindow';
import type { TaskReadService } from '../../services/data/TaskReadService';

/**
 * Sidebar variant of the shared list section: a compact row, no card frame.
 *
 * The sort, filter and more buttons used to carry a class each
 * (`pinned-list__sort-btn` and friends) that the stylesheet only ever grouped
 * back together; they now share `pinned-list__header-btn`, as kanban's already
 * did.
 */
const PINNED_LIST_CLASSES: ListSectionClasses = {
    root: 'pinned-list',
    collapsed: 'pinned-list--collapsed',
    header: 'pinned-list__header',
    toggle: 'pinned-list__toggle',
    name: 'pinned-list__name',
    count: 'pinned-list__count',
    button: 'pinned-list__header-btn',
    body: 'pinned-list__body',
    nameInput: 'pinned-list__name-input',
};

export interface PinnedListCallbacks {
    onCollapsedChange: (listId: string, collapsed: boolean) => void;
    onSortEdit: (listDef: PinnedListDefinition, anchorEl: HTMLElement) => void;
    onFilterEdit: (listDef: PinnedListDefinition, anchorEl: HTMLElement) => void;
    onDuplicate: (listDef: PinnedListDefinition) => void;
    onRemove: (listDef: PinnedListDefinition) => void;
    onToggleApplyViewFilter?: (listDef: PinnedListDefinition) => void;
    onRename?: (listDef: PinnedListDefinition, newName: string) => void;
    onMoveUp?: (listDef: PinnedListDefinition) => void;
    onMoveDown?: (listDef: PinnedListDefinition) => void;
    onTopRightEdit?: (listDef: PinnedListDefinition, anchorEl: HTMLElement) => void;
}

/**
 * Parameters provided once by the view at attach() time.
 *
 * `host` is a stable DOM node owned by the view that survives view-level
 * full re-renders (i.e. is NOT inside the area that gets `container.empty()`'d).
 * The renderer rebuilds children of `host` on every refresh().
 *
 * Getters (getLists / getCollapsed / getViewFilterState) are pulled lazily
 * on each refresh so the view can mutate its underlying state without
 * having to re-call attach.
 */
export interface PinnedListAttachParams {
    host: HTMLElement;
    getLists: () => PinnedListDefinition[];
    getCollapsed: () => Record<string, boolean>;
    getViewFilterState: () => FilterState | undefined;
    callbacks: PinnedListCallbacks;
    /**
     * Owning view's id (e.g. 'timeline', 'calendar'). Used to namespace the
     * cardInstanceId fed to TaskCardRenderer so a task pinned in multiple
     * places (or pinned + on the main grid) can be expanded independently.
     */
    viewId: string;
}

export class PinnedListRenderer {
    // ID of list to start renaming immediately after render
    private pendingRenameId: string | null = null;
    private readonly paging: TaskPagingController;
    /** Reconciler for the in-flight `render()` call. Consumed by `renderTaskCards`. */
    private currentReconciler: CardReconciler | null = null;
    private listDefMap = new Map<string, PinnedListDefinition>();

    // attach state — set by attach(), cleared by detach()
    private host: HTMLElement | null = null;
    private getLists: (() => PinnedListDefinition[]) | null = null;
    private getCollapsed: (() => Record<string, boolean>) | null = null;
    private getViewFilterState: (() => FilterState | undefined) | null = null;
    private callbacks: PinnedListCallbacks | null = null;
    private viewId: string | null = null;
    private unsubscribe: (() => void) | null = null;
    private pendingRaf: number | null = null;
    /** 再描画フレームは host（= attach された sidebar 要素）の window から取る。 */
    private readonly frames = new HostFrameScheduler(() => this.host);

    constructor(
        private taskRenderer: TaskCardRenderer,
        private plugin: PluginContext,
        private menuHandler: MenuHandler,
        private readService: TaskReadService,
    ) {
        this.paging = new TaskPagingController(
            () => this.plugin.settings.pinnedListPageSize,
            (container, tasks, listId) => this.renderTaskCards(container, tasks, listId),
        );
    }

    /** Schedule inline rename for a list on the next render. */
    scheduleRename(listId: string): void {
        this.pendingRenameId = listId;
    }

    /**
     * Wire the renderer to a stable host element and start auto-refreshing
     * on data changes. Idempotent against double-attach (calls detach() first).
     *
     * The host must NOT live inside the view's render-empty target — otherwise
     * its DOM (and PinnedList paging/expanded state) is lost on every full render.
     */
    attach(params: PinnedListAttachParams): void {
        if (this.host) this.detach();

        this.host = params.host;
        this.getLists = params.getLists;
        this.getCollapsed = params.getCollapsed;
        this.getViewFilterState = params.getViewFilterState;
        this.callbacks = params.callbacks;
        this.viewId = params.viewId;

        this.unsubscribe = this.readService.onChange((_taskId, changes) => {
            if (!shouldRenderForChanges(changes)) return;
            this.scheduleRefresh();
        });

        // Initial paint
        this.refresh();
    }

    /** Tear down subscription and clear host references. Safe to call multiple times. */
    detach(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.host = null;
        this.getLists = null;
        this.getCollapsed = null;
        this.getViewFilterState = null;
        this.callbacks = null;
        this.viewId = null;
        if (this.pendingRaf !== null) {
            this.frames.cancel(this.pendingRaf);
            this.pendingRaf = null;
        }
    }

    /**
     * Re-render into the attached host. Called by the onChange subscription
     * automatically; views may call it manually after mutating list arrays
     * (rename / duplicate / reorder / remove / filter / sort changes).
     */
    private scheduleRefresh(): void {
        if (this.pendingRaf !== null) return;
        this.pendingRaf = this.frames.request(() => {
            this.pendingRaf = null;
            this.refresh();
        });
    }

    refresh(): void {
        if (!this.host || !this.getLists || !this.getCollapsed || !this.callbacks) return;

        this.render(
            this.host,
            this.getLists(),
            this.getCollapsed(),
            this.callbacks,
            this.getViewFilterState?.(),
        );
    }

    private render(
        container: HTMLElement,
        lists: PinnedListDefinition[],
        collapsedState: Record<string, boolean>,
        callbacks: PinnedListCallbacks,
        viewFilterState?: FilterState,
    ): void {
        // Keyed reconciliation: lift surviving cards across all lists before
        // tearing down the container. They will be re-parented + re-decorated
        // when their cardInstanceId turns up in the new render. Lists added /
        // removed / reordered all reuse cards by key — no markdown reflow.
        const reconciler = new CardReconciler();
        reconciler.detach(container);
        this.currentReconciler = reconciler;

        container.empty();
        container.addClass('tv-sidebar__pinned-lists');
        // Preserve paging state across renders for lists that still exist
        // (collapsedState keys are caller-prefixed, so use list.id directly here).
        const currentListIds = new Set(lists.map(l => l.id));
        this.paging.pruneRemovedLists(currentListIds);
        this.listDefMap.clear();
        for (const def of lists) this.listDefMap.set(def.id, def);
        if (lists.length === 0) {
            container.createDiv('tv-sidebar__pinned-lists--empty')
                .setText(t('pinnedList.noPinnedLists'));
            reconciler.forEachStale(card => this.taskRenderer.dispose(card));
            this.currentReconciler = null;
            return;
        }

        for (let i = 0; i < lists.length; i++) {
            const listDef = lists[i];
            const combinedFilter = listDef.applyViewFilter && viewFilterState
                ? combineFilterStates(listDef.filterState, viewFilterState)
                : listDef.filterState;
            const tasks = this.readService.getFilteredTasks(combinedFilter, listDef.sortState);

            this.renderList(container, listDef, tasks, collapsedState, callbacks, i, lists.length);
        }

        // Dispose any cards that did not turn up in the new render.
        reconciler.forEachStale(card => this.taskRenderer.dispose(card));
        this.currentReconciler = null;
    }

    private renderList(
        container: HTMLElement,
        listDef: PinnedListDefinition,
        tasks: DisplayTask[],
        collapsedState: Record<string, boolean>,
        callbacks: PinnedListCallbacks,
        index: number,
        totalCount: number,
    ): void {
        // Collapsed state is owned by the caller (view). Default = expanded.
        const isCollapsed = collapsedState[listDef.id] ?? false;

        const section = renderListSection(container, {
            classes: PINNED_LIST_CLASSES,
            name: listDef.name,
            taskCount: tasks.length,
            collapsed: isCollapsed,
            sortState: listDef.sortState,
            filterState: listDef.filterState,
            onSortClick: (anchorEl) => callbacks.onSortEdit(listDef, anchorEl),
            onFilterClick: (anchorEl) => callbacks.onFilterEdit(listDef, anchorEl),
            onMoreClick: (anchorEl, event) =>
                this.showMoreMenu(event, listDef, anchorEl, callbacks, index, totalCount),
            onCollapsedChange: (collapsed) => callbacks.onCollapsedChange(listDef.id, collapsed),
            renderBody: (body, opts) => {
                if (opts.resetPaging) this.paging.resetOne(listDef.id);
                this.paging.render(body, tasks, listDef.id);
            },
        });
        section.root.dataset.listId = listDef.id;

        // Auto-start rename for newly added lists
        if (this.pendingRenameId === listDef.id) {
            this.pendingRenameId = null;
            // Defer enough for Obsidian's layout/focus to settle
            setTimeout(() => {
                const currentNameEl = section.root
                    .querySelector(`.${PINNED_LIST_CLASSES.name}`) as HTMLElement | null;
                if (currentNameEl) this.startRename(currentNameEl, listDef, callbacks);
            }, 50);
        }
    }

    private showMoreMenu(
        e: MouseEvent,
        listDef: PinnedListDefinition,
        anchorEl: HTMLElement,
        callbacks: PinnedListCallbacks,
        index: number,
        totalCount: number,
    ): void {
        this.plugin.menuPresenter.present((menu) => {
        menu.addItem(item => {
            item.setTitle(t('menu.rename'))
                .setIcon('pencil')
                .onClick(() => {
                    const listEl = anchorEl.closest('.pinned-list');
                    const nameEl = listEl?.querySelector('.pinned-list__name') as HTMLElement | null;
                    if (nameEl) this.startRename(nameEl, listDef, callbacks);
                });
        });

        if (callbacks.onMoveUp && index > 0) {
            menu.addItem(item => {
                item.setTitle(t('menu.moveUp'))
                    .setIcon('arrow-up')
                    .onClick(() => callbacks.onMoveUp!(listDef));
            });
        }

        if (callbacks.onMoveDown && index < totalCount - 1) {
            menu.addItem(item => {
                item.setTitle(t('menu.moveDown'))
                    .setIcon('arrow-down')
                    .onClick(() => callbacks.onMoveDown!(listDef));
            });
        }

        menu.addItem(item => {
            item.setTitle(t('menu.duplicate'))
                .setIcon('copy')
                .onClick(() => callbacks.onDuplicate(listDef));
        });

        if (callbacks.onTopRightEdit) {
            menu.addItem(item => {
                item.setTitle(t('pinnedList.topRightLabel'))
                    .setIcon('tag')
                    .onClick(() => callbacks.onTopRightEdit!(listDef, anchorEl));
            });
        }

        if (callbacks.onToggleApplyViewFilter) {
            menu.addItem(item => {
                item
                    .setTitle(t('menu.applyViewFilter'))
                    .setIcon('filter')
                    .setChecked(!!listDef.applyViewFilter)
                    .onClick(() => callbacks.onToggleApplyViewFilter!(listDef));
            });
        }

        menu.addSeparator();

        menu.addItem(item => {
            item.setTitle(t('menu.remove'))
                .setIcon('trash')
                .onClick(() => callbacks.onRemove(listDef));
            item.dom?.addClass('is-danger');
        });
        }, { kind: 'mouseEvent', event: e });
    }

    private startRename(
        nameEl: HTMLElement,
        listDef: PinnedListDefinition,
        callbacks: PinnedListCallbacks,
    ): void {
        startListSectionRename(nameEl, PINNED_LIST_CLASSES, listDef.name, (newName) => {
            listDef.name = newName;
            callbacks.onRename?.(listDef, newName);
        });
    }

    private renderTaskCards(body: HTMLElement, tasks: DisplayTask[], listId: string): void {
        const settings = this.plugin.settings;
        const viewId = this.viewId ?? 'unknown';
        const reconciler = this.currentReconciler;
        const listDef = this.listDefMap.get(listId);
        const topRight = listDef?.topRight
            ? { mode: 'template' as const, config: listDef.topRight }
            : { mode: 'none' as const };
        tasks.forEach(task => {
            const cardInstanceId = `${viewId}::pl-${listId}::${task.id}`;
            const reused = reconciler?.acquire(cardInstanceId);
            const card = reused ?? body.createDiv('task-card');
            if (reused) body.appendChild(reused);

            this.decoratePinnedCard(card, task);
            this.taskRenderer.render(card, task, settings, {
                cardInstanceId,
                topRight,
            });
            if (!reused) this.menuHandler.addTaskContextMenu(card, task);
        });
    }

    /**
     * Idempotent decoration for pinned-list cards (color / linestyle / readonly).
     * Pinned-list tasks are never split in this path, so no split variants apply.
     */
    private decoratePinnedCard(card: HTMLElement, task: DisplayTask): void {
        card.dataset.id = task.id;

        TaskStyling.applyTaskColor(card, getEffectiveColor(task) ?? null);
        TaskStyling.applyTaskLinestyle(card, getEffectiveLinestyle(task) ?? null);
        TaskStyling.applyReadOnly(card, task);
    }
}
