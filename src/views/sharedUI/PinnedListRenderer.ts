/**
 * Renders pinned lists in the sidebar. Each list has its own FilterState
 * and appears as a collapsible group with task cards.
 */

import { Component, Menu, setIcon } from 'obsidian';
import type { Task, PinnedListDefinition } from '../../types';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { TaskFilterEngine } from '../../services/filter/TaskFilterEngine';
import { hasConditions } from '../../services/filter/FilterTypes';
import { TaskIndex } from '../../services/core/TaskIndex';
import { TaskSorter } from '../../services/sort/TaskSorter';
import { hasSortRules } from '../../services/sort/SortTypes';
import TaskViewerPlugin from '../../main';
import { TaskStyling } from './TaskStyling';

export interface PinnedListCallbacks {
    onCollapsedChange: (listId: string, collapsed: boolean) => void;
    onSortEdit: (listDef: PinnedListDefinition, anchorEl: HTMLElement) => void;
    onFilterEdit: (listDef: PinnedListDefinition, anchorEl: HTMLElement) => void;
    onDuplicate: (listDef: PinnedListDefinition) => void;
    onRemove: (listDef: PinnedListDefinition) => void;
}

export class PinnedListRenderer {
    // Preserve collapse state across re-renders (instance lifetime only)
    private collapsedGroups = new Set<string>();
    // ID of list to start renaming immediately after render
    private pendingRenameId: string | null = null;

    constructor(
        private taskRenderer: TaskCardRenderer,
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private taskIndex: TaskIndex,
    ) {}

    /** Schedule inline rename for a list on the next render. */
    scheduleRename(listId: string): void {
        this.pendingRenameId = listId;
    }

    render(
        container: HTMLElement,
        owner: Component,
        lists: PinnedListDefinition[],
        isTaskVisible: (task: Task) => boolean,
        collapsedState: Record<string, boolean>,
        callbacks: PinnedListCallbacks,
    ): void {
        container.empty();
        container.addClass('pinned-lists-container');
        if (lists.length === 0) {
            container.createDiv('pinned-lists-container__empty')
                .setText('No pinned lists.');
            return;
        }

        const allTasks = this.taskIndex.getTasks();

        for (const listDef of lists) {
            // Apply pinned list filter, then main toolbar filter
            const tasks = allTasks.filter(task =>
                TaskFilterEngine.evaluate(task, listDef.filterState) && isTaskVisible(task)
            );

            TaskSorter.sort(tasks, listDef.sortState);

            this.renderList(container, listDef, tasks, owner, collapsedState, callbacks);
        }
    }

    private renderList(
        container: HTMLElement,
        listDef: PinnedListDefinition,
        tasks: Task[],
        owner: Component,
        collapsedState: Record<string, boolean>,
        callbacks: PinnedListCallbacks,
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
            this.showMoreMenu(e as MouseEvent, listDef, nameEl, callbacks);
        });

        // Task list body
        const body = listEl.createDiv('pinned-list__body');
        if (!isCollapsed) {
            this.renderTaskCards(body, tasks, owner);
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
                // Lazy render on expand
                if (body.childElementCount === 0 && tasks.length > 0) {
                    this.renderTaskCards(body, tasks, owner);
                }
            }

            callbacks.onCollapsedChange(listDef.id, nextCollapsed);
        });

        // Auto-start rename for newly added lists
        if (this.pendingRenameId === listDef.id) {
            this.pendingRenameId = null;
            // Defer enough for Obsidian's layout/focus to settle
            setTimeout(() => {
                this.startRename(nameEl, listDef);
            }, 50);
        }
    }

    private showMoreMenu(
        e: MouseEvent,
        listDef: PinnedListDefinition,
        nameEl: HTMLElement,
        callbacks: PinnedListCallbacks,
    ): void {
        const menu = new Menu();

        menu.addItem(item => {
            item.setTitle('Rename')
                .setIcon('pencil')
                .onClick(() => this.startRename(nameEl, listDef));
        });

        menu.addItem(item => {
            item.setTitle('Duplicate')
                .setIcon('copy')
                .onClick(() => callbacks.onDuplicate(listDef));
        });

        menu.addSeparator();

        menu.addItem(item => {
            item.setTitle('Remove')
                .setIcon('trash')
                .onClick(() => callbacks.onRemove(listDef));
            (item as any).dom?.addClass('is-danger');
        });

        menu.showAtMouseEvent(e);
    }

    private startRename(
        nameEl: HTMLElement,
        listDef: PinnedListDefinition,
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
            this.plugin.saveData(this.plugin.settings);
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

    private renderTaskCards(body: HTMLElement, tasks: Task[], owner: Component): void {
        const settings = this.plugin.settings;
        tasks.forEach(task => {
            const card = body.createDiv('task-card');

            TaskStyling.applyTaskColor(card, task.color ?? null);
            TaskStyling.applyTaskLinestyle(card, task.linestyle ?? null);

            this.taskRenderer.render(card, task, owner, settings);
            this.menuHandler.addTaskContextMenu(card, task);
        });
    }
}
