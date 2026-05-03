/**
 * Renders pinned lists in the sidebar. Each list has its own FilterState
 * and appears as a collapsible group with task cards.
 */

import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { DisplayTask, PinnedListDefinition } from '../../types';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { combineFilterStates, hasConditions, type FilterState } from '../../services/filter/FilterTypes';
import { hasSortRules } from '../../services/sort/SortTypes';
import TaskViewerPlugin from '../../main';
import { TaskStyling } from './TaskStyling';
import { TaskPagingController } from './TaskPagingController';
import type { TaskReadService } from '../../services/data/TaskReadService';

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

    // attach state — set by attach(), cleared by detach()
    private host: HTMLElement | null = null;
    private getLists: (() => PinnedListDefinition[]) | null = null;
    private getCollapsed: (() => Record<string, boolean>) | null = null;
    private getViewFilterState: (() => FilterState | undefined) | null = null;
    private callbacks: PinnedListCallbacks | null = null;
    private viewId: string | null = null;
    private unsubscribe: (() => void) | null = null;

    constructor(
        private taskRenderer: TaskCardRenderer,
        private plugin: TaskViewerPlugin,
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

        // Subscribe to data changes — refresh self-contained without view involvement.
        this.unsubscribe = this.readService.onChange(() => {
            this.refresh();
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
    }

    /**
     * Re-render into the attached host. Called by the onChange subscription
     * automatically; views may call it manually after mutating list arrays
     * (rename / duplicate / reorder / remove / filter / sort changes).
     */
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
        this.taskRenderer.disposeInside(container);
        container.empty();
        container.addClass('tv-sidebar__pinned-lists');
        // Preserve paging state across renders for lists that still exist
        // (collapsedState keys are caller-prefixed, so use list.id directly here).
        const currentListIds = new Set(lists.map(l => l.id));
        this.paging.pruneRemovedLists(currentListIds);
        if (lists.length === 0) {
            container.createDiv('tv-sidebar__pinned-lists--empty')
                .setText(t('pinnedList.noPinnedLists'));
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

        const listEl = container.createDiv('pinned-list');
        listEl.dataset.listId = listDef.id;
        if (isCollapsed) {
            listEl.addClass('pinned-list--collapsed');
        }

        // Header
        const header = listEl.createDiv('pinned-list__header');

        const toggle = header.createSpan({ text: isCollapsed ? '▶' : '▼', cls: 'pinned-list__toggle' });
        const nameEl = header.createSpan({ text: listDef.name, cls: 'pinned-list__name' });
        header.createSpan({ text: ` (${tasks.length})`, cls: 'pinned-list__count' });

        // Sort button
        const sortBtn = header.createEl('button', { cls: 'pinned-list__sort-btn' });
        setIcon(sortBtn, 'arrow-up-down');
        if (listDef.sortState && hasSortRules(listDef.sortState)) {
            sortBtn.addClass('is-sorted');
        }
        sortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.onSortEdit(listDef, sortBtn);
        });

        // Filter button
        const filterBtn = header.createEl('button', { cls: 'pinned-list__filter-btn' });
        setIcon(filterBtn, 'filter');
        if (hasConditions(listDef.filterState)) {
            filterBtn.addClass('is-filtered');
        }
        filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.onFilterEdit(listDef, filterBtn);
        });

        // More options button (...)
        const moreBtn = header.createEl('button', { cls: 'pinned-list__more-btn' });
        setIcon(moreBtn, 'more-horizontal');
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showMoreMenu(e as MouseEvent, listDef, moreBtn, callbacks, index, totalCount);
        });

        // Task list body
        const body = listEl.createDiv('pinned-list__body');
        if (!isCollapsed) {
            this.paging.render(body, tasks, listDef.id);
        }

        // Collapse toggle
        header.addEventListener('click', () => {
            const currentlyCollapsed = listEl.classList.contains('pinned-list--collapsed');
            const nextCollapsed = !currentlyCollapsed;

            if (nextCollapsed) {
                listEl.addClass('pinned-list--collapsed');
                toggle.textContent = '▶';
            } else {
                listEl.removeClass('pinned-list--collapsed');
                toggle.textContent = '▼';
                // Lazy render on expand (reset to first page)
                if (body.childElementCount === 0 && tasks.length > 0) {
                    this.paging.resetOne(listDef.id);
                    this.paging.render(body, tasks, listDef.id);
                }
            }

            callbacks.onCollapsedChange(listDef.id, nextCollapsed);
        });

        // Auto-start rename for newly added lists
        if (this.pendingRenameId === listDef.id) {
            this.pendingRenameId = null;
            // Defer enough for Obsidian's layout/focus to settle
            setTimeout(() => {
                const currentNameEl = listEl.querySelector('.pinned-list__name') as HTMLElement | null;
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
        const input = document.createElement('input');
        input.type = 'text';
        input.value = listDef.name;
        input.className = 'pinned-list__name-input';
        nameEl.replaceWith(input);
        input.focus();
        input.select();

        let committed = false;
        const commit = (newName: string) => {
            if (committed) return;
            committed = true;
            listDef.name = newName;
            callbacks.onRename?.(listDef, newName);
            // Replace input with span (no full re-render needed)
            const span = document.createElement('span');
            span.className = 'pinned-list__name';
            span.textContent = newName;
            if (input.parentElement) {
                input.replaceWith(span);
            }
        };

        input.addEventListener('blur', () => {
            commit(input.value.trim() || listDef.name);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { e.preventDefault(); commit(listDef.name); }
        });
        // Prevent header click (collapse) from triggering
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    private renderTaskCards(body: HTMLElement, tasks: DisplayTask[], listId: string): void {
        const settings = this.plugin.settings;
        const viewId = this.viewId ?? 'unknown';
        tasks.forEach(task => {
            const card = body.createDiv('task-card');
            card.createDiv('task-card__shape');
            card.dataset.id = task.id;

            TaskStyling.applyTaskColor(card, task.color ?? null);
            TaskStyling.applyTaskLinestyle(card, task.linestyle ?? null);
            TaskStyling.applyReadOnly(card, task);

            this.taskRenderer.render(card, task, settings, {
                cardInstanceId: `${viewId}::pl-${listId}::${task.id}`,
            });
            this.menuHandler.addTaskContextMenu(card, task);
        });
    }
}
