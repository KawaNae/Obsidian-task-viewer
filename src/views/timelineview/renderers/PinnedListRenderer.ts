/**
 * Renders pinned lists in the sidebar. Each list has its own FilterState
 * and appears as a collapsible group with task cards.
 */

import { Component } from 'obsidian';
import { setIcon } from 'obsidian';
import type { Task, PinnedListDefinition } from '../../../types';
import { TaskCardRenderer } from '../../taskcard/TaskCardRenderer';
import { MenuHandler } from '../../../interaction/menu/MenuHandler';
import { TaskFilterEngine } from '../../../services/filter/TaskFilterEngine';
import { hasConditions } from '../../../services/filter/FilterTypes';
import { TaskIndex } from '../../../services/core/TaskIndex';
import TaskViewerPlugin from '../../../main';
import { TaskStyling } from '../../utils/TaskStyling';

export class PinnedListRenderer {
    // Preserve collapse state across re-renders (instance lifetime only)
    private collapsedGroups = new Set<string>();

    constructor(
        private taskRenderer: TaskCardRenderer,
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private taskIndex: TaskIndex,
    ) {}

    render(
        container: HTMLElement,
        owner: Component,
        isTaskVisible: (task: Task) => boolean,
        collapsedState: Record<string, boolean>,
        onCollapsedChange: (listId: string, collapsed: boolean) => void,
        onFilterEdit: (listDef: PinnedListDefinition, anchorEl: HTMLElement) => void,
    ): void {
        container.empty();
        container.addClass('pinned-lists-container');

        const lists = this.plugin.settings.pinnedLists;
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

            // Sort: deadline asc → startDate asc → content asc
            tasks.sort((a, b) => {
                const da = a.deadline || '';
                const db = b.deadline || '';
                if (da !== db) return da.localeCompare(db);
                const sa = a.startDate || '';
                const sb = b.startDate || '';
                if (sa !== sb) return sa.localeCompare(sb);
                return (a.content || '').localeCompare(b.content || '');
            });

            this.renderList(container, listDef, tasks, owner, collapsedState, onCollapsedChange, onFilterEdit);
        }
    }

    private renderList(
        container: HTMLElement,
        listDef: PinnedListDefinition,
        tasks: Task[],
        owner: Component,
        collapsedState: Record<string, boolean>,
        onCollapsedChange: (listId: string, collapsed: boolean) => void,
        onFilterEdit: (listDef: PinnedListDefinition, anchorEl: HTMLElement) => void,
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
        header.createSpan({ text: listDef.name, cls: 'pinned-list__name' });
        header.createSpan({ text: ` (${tasks.length})`, cls: 'pinned-list__count' });

        // Filter edit button
        const filterBtn = header.createEl('button', { cls: 'pinned-list__filter-btn' });
        setIcon(filterBtn, 'filter');
        if (hasConditions(listDef.filterState)) {
            filterBtn.addClass('is-filtered');
        }
        filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onFilterEdit(listDef, filterBtn);
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

            onCollapsedChange(listDef.id, nextCollapsed);
        });
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
