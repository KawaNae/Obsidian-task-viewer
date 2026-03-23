/**
 * Renders pinned lists in the sidebar. Each list has its own FilterState
 * and appears as a collapsible group with task cards.
 */

import { Component, Menu, setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { DisplayTask, PinnedListDefinition } from '../../types';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { combineFilterStates, hasConditions, type FilterState } from '../../services/filter/FilterTypes';
import { hasSortRules } from '../../services/sort/SortTypes';
import TaskViewerPlugin from '../../main';
import { TaskStyling } from './TaskStyling';
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

export class PinnedListRenderer {
    // Preserve collapse state across re-renders (instance lifetime only)
    private collapsedGroups = new Set<string>();
    // ID of list to start renaming immediately after render
    private pendingRenameId: string | null = null;
    // Tracks how many tasks are currently visible per list (for "Show more")
    private visibleCounts = new Map<string, number>();

    constructor(
        private taskRenderer: TaskCardRenderer,
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private readService: TaskReadService,
    ) {}

    /** Schedule inline rename for a list on the next render. */
    scheduleRename(listId: string): void {
        this.pendingRenameId = listId;
    }

    render(
        container: HTMLElement,
        owner: Component,
        lists: PinnedListDefinition[],
        collapsedState: Record<string, boolean>,
        callbacks: PinnedListCallbacks,
        viewFilterState?: FilterState,
    ): void {
        container.empty();
        container.addClass('pinned-lists-container');
        this.visibleCounts.clear();
        if (lists.length === 0) {
            container.createDiv('pinned-lists-container__empty')
                .setText(t('pinnedList.noPinnedLists'));
            return;
        }

        for (let i = 0; i < lists.length; i++) {
            const listDef = lists[i];
            const combinedFilter = listDef.applyViewFilter && viewFilterState
                ? combineFilterStates(listDef.filterState, viewFilterState)
                : listDef.filterState;
            const tasks = this.readService.getFilteredTasks(combinedFilter, listDef.sortState);

            this.renderList(container, listDef, tasks, owner, collapsedState, callbacks, i, lists.length);
        }
    }

    private renderList(
        container: HTMLElement,
        listDef: PinnedListDefinition,
        tasks: DisplayTask[],
        owner: Component,
        collapsedState: Record<string, boolean>,
        callbacks: PinnedListCallbacks,
        index: number,
        totalCount: number,
    ): void {
        // Determine collapsed state: ViewState > instance memory > default expanded
        const isCollapsed = collapsedState[listDef.id] ?? this.collapsedGroups.has(listDef.id);

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
            this.renderPagedTasks(body, tasks, listDef.id, owner);
        }

        // Collapse toggle
        header.addEventListener('click', () => {
            const currentlyCollapsed = listEl.classList.contains('pinned-list--collapsed');
            const nextCollapsed = !currentlyCollapsed;

            if (nextCollapsed) {
                this.collapsedGroups.add(listDef.id);
                listEl.addClass('pinned-list--collapsed');
                toggle.textContent = '▶';
            } else {
                this.collapsedGroups.delete(listDef.id);
                listEl.removeClass('pinned-list--collapsed');
                toggle.textContent = '▼';
                // Lazy render on expand (reset to first page)
                if (body.childElementCount === 0 && tasks.length > 0) {
                    this.visibleCounts.delete(listDef.id);
                    this.renderPagedTasks(body, tasks, listDef.id, owner);
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
        const menu = new Menu();

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

        menu.showAtMouseEvent(e);
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

    private renderPagedTasks(
        body: HTMLElement,
        allTasks: DisplayTask[],
        listId: string,
        owner: Component,
    ): void {
        const pageSize = this.plugin.settings.pinnedListPageSize;
        const visibleCount = this.visibleCounts.get(listId) ?? pageSize;
        const tasksToShow = allTasks.slice(0, visibleCount);

        this.renderTaskCards(body, tasksToShow, owner);

        if (visibleCount < allTasks.length) {
            this.appendShowMoreButton(body, allTasks, visibleCount, listId, owner);
        }
    }

    private appendShowMoreButton(
        body: HTMLElement,
        allTasks: DisplayTask[],
        shownCount: number,
        listId: string,
        owner: Component,
    ): void {
        const pageSize = this.plugin.settings.pinnedListPageSize;
        const remaining = allTasks.length - shownCount;
        const btn = body.createDiv('pinned-list__show-more');
        btn.setText(t('pinnedList.showMore', { remaining }));
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            btn.remove();
            const newCount = Math.min(shownCount + pageSize, allTasks.length);
            this.visibleCounts.set(listId, newCount);
            const nextBatch = allTasks.slice(shownCount, newCount);
            this.renderTaskCards(body, nextBatch, owner);
            if (newCount < allTasks.length) {
                this.appendShowMoreButton(body, allTasks, newCount, listId, owner);
            }
        });
    }

    private renderTaskCards(body: HTMLElement, tasks: DisplayTask[], owner: Component): void {
        const settings = this.plugin.settings;
        tasks.forEach(task => {
            const card = body.createDiv('task-card');
            card.dataset.id = task.id;

            TaskStyling.applyTaskColor(card, task.color ?? null);
            TaskStyling.applyTaskLinestyle(card, task.linestyle ?? null);
            TaskStyling.applyReadOnly(card, task);

            this.taskRenderer.render(card, task, owner, settings);
            this.menuHandler.addTaskContextMenu(card, task);
        });
    }
}
