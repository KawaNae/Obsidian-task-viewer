/**
 * The saved lists of a view, drawn from their definitions: the pinned lists
 * of Timeline and Calendar (`PinnedListPanel`) and the cells of Kanban.
 *
 * One list is one section (`ListSectionRenderer`): which tasks it shows
 * (`PinnedListQuery`), its pages, its cards, its sort and filter popovers,
 * its rename, the top-right editor and the items its ⋯ menu shares. What
 * differs is only where the lists sit, and that is the placement's: it holds
 * the lists, writes them, and adds its own menu items (reorder and remove in
 * the sidebar, rows and columns on the board).
 */

import type { Menu } from 'obsidian';
import { t } from '../../i18n';
import type { DisplayTask, PinnedListDefinition } from '../../types';
import type { PluginContext } from '../../PluginContext';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { IndexReads } from '../../services/core/TaskIndex';
import { createDefaultListFilterState, type FilterState } from '../../services/filter/FilterTypes';
import { PinnedListQuery } from '../../services/filter/PinnedListQuery';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';
import { createEmptySortState } from '../../services/sort/SortTypes';
import { newListId } from '../../services/viewConfig/ListIds';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { SortMenuComponent } from '../customMenus/SortMenuComponent';
import { TopRightConfigEditor } from '../customMenus/TopRightConfigEditor';
import { renderListSection, startListSectionRename, type ListSectionClasses } from './ListSectionRenderer';
import { TaskPagingController } from './TaskPagingController';
import type { CardReconciler } from './CardReconciler';

/** What the lists read and draw with: the view's card renderer, the tasks, the plugin's menus and settings. */
export interface ListSectionDeps {
    plugin: PluginContext;
    readService: TaskReadService;
    index: IndexReads;
    taskRenderer: TaskCardRenderer;
}

/** Where the lists sit, and what only that place does. */
export interface ListPlacement {
    /** The look of a section in this place. */
    classes: ListSectionClasses;
    /** Each list is a place of its own for its cards (`CardKey.scope`): `<scopePrefix>-<list id>`. */
    scopePrefix: string;
    /** Write the list `id` with `patch`. The placement holds the lists. */
    replaceList(id: string, patch: Partial<PinnedListDefinition>): void;
    /** Write whether the list `id` is collapsed; the section already shows it. */
    setCollapsed(id: string, collapsed: boolean): void;
    /** Put `copy`, a duplicate of `list`, in. */
    insertCopy(list: PinnedListDefinition, copy: PinnedListDefinition): void;
    /** The ⋯ menu's items of this place, below the shared ones. */
    appendMenuItems(menu: Menu, list: PinnedListDefinition): void;
}

/** What one draw of the lists reads. */
export interface ListDrawContext {
    /** The draw's reconciler: a card already shown is kept. */
    reconciler: CardReconciler;
    /** Which lists are collapsed, by id. */
    collapsed: Readonly<Record<string, boolean>>;
    /** The view's filter, which narrows a list that applies it. */
    viewFilter: FilterState | undefined;
}

/** A new list: every task that is not a child (`createDefaultListFilterState`), the view's filter not applied. */
export function newList(): PinnedListDefinition {
    return {
        id: newListId(),
        name: t('pinnedList.newList'),
        filterState: createDefaultListFilterState(),
        applyViewFilter: false,
    };
}

/**
 * A copy of `list` under a new id and a name marked as a copy. Its filter,
 * sort and top-right fields are values that are never changed in place
 * (an edit makes a new one), so the copy can share them.
 */
export function copyOfList(list: PinnedListDefinition): PinnedListDefinition {
    return { ...list, id: newListId(), name: list.name + ' (copy)' };
}

export class TaskListSections {
    private readonly paging: TaskPagingController;
    private readonly sortMenu: SortMenuComponent;
    private readonly filterMenu: FilterMenuComponent;
    private readonly topRightEditor: TopRightConfigEditor;
    /** The list whose name is edited once it is drawn (a list just added). */
    private pendingRenameId: string | null = null;

    constructor(
        private readonly deps: ListSectionDeps,
        private readonly placement: ListPlacement,
    ) {
        this.paging = new TaskPagingController(() => this.deps.plugin.settings.pinnedListPageSize);
        const app = deps.plugin.app;
        this.sortMenu = new SortMenuComponent(app.keymap);
        this.filterMenu = new FilterMenuComponent(app);
        this.topRightEditor = new TopRightConfigEditor(app);
        this.filterMenu.setStatusDefinitions(this.deps.plugin.settings.statusDefinitions);
    }

    /** Start editing the name of the list `id` when it is next drawn. */
    scheduleRename(id: string): void {
        this.pendingRenameId = id;
    }

    /**
     * Draw `lists` into `container`, in order, one section each. The page a
     * list was paged to is kept while the list is there.
     */
    draw(container: HTMLElement, lists: readonly PinnedListDefinition[], ctx: ListDrawContext): void {
        this.paging.pruneRemovedLists(new Set(lists.map(l => l.id)));
        for (const list of lists) this.drawList(container, list, ctx);
    }

    /** Close the popovers the lists opened. */
    close(): void {
        this.sortMenu.close();
        this.filterMenu.close();
    }

    private drawList(container: HTMLElement, list: PinnedListDefinition, ctx: ListDrawContext): void {
        const { classes } = this.placement;
        const query = PinnedListQuery.resolve(list, ctx.viewFilter);
        const tasks = this.deps.readService.getFilteredTasks(query.filter, query.sort);
        const drawCards = (body: HTMLElement, batch: DisplayTask[], reconciler: CardReconciler | null) =>
            this.drawCards(body, batch, list, reconciler);

        const section = renderListSection(container, {
            classes,
            name: list.name,
            taskCount: tasks.length,
            collapsed: ctx.collapsed[list.id] ?? false,
            sortState: list.sortState,
            filterState: list.filterState,
            onSortClick: (anchorEl) => this.openSort(list, anchorEl),
            onFilterClick: (anchorEl) => this.openFilter(list, anchorEl),
            onMoreClick: (anchorEl, event) => this.showMenu(event, list, anchorEl, nameEl()),
            onCollapsedChange: (collapsed) => this.placement.setCollapsed(list.id, collapsed),
            // A body painted after the draw (the list opened by hand) has no
            // cards to keep, and starts at page one.
            renderBody: (body, opts) => {
                if (opts.resetPaging) this.paging.resetOne(list.id);
                this.paging.render(body, tasks, list.id, opts.resetPaging ? null : ctx.reconciler, drawCards);
            },
        });
        section.root.dataset.listId = list.id;
        // The name element now: a rename puts a new one in its place.
        const nameEl = () => section.root.querySelector<HTMLElement>(`.${classes.name}`);

        if (this.pendingRenameId === list.id) {
            this.pendingRenameId = null;
            // Wait for Obsidian's layout and focus to settle.
            setTimeout(() => {
                const el = nameEl();
                if (el) this.startRename(el, list);
            }, 50);
        }
    }

    private drawCards(
        body: HTMLElement,
        tasks: DisplayTask[],
        list: PinnedListDefinition,
        reconciler: CardReconciler | null,
    ): void {
        const settings = this.deps.plugin.settings;
        const topRight = list.topRight
            ? { mode: 'fields' as const, config: list.topRight }
            : { mode: 'none' as const };
        // Each list is its own place, so a task in several lists, or in a
        // list and on the view's grid, is opened apart in each.
        const scope = `${this.placement.scopePrefix}-${list.id}`;
        for (const task of tasks) {
            const key = { scope, name: task.id };
            const reused = reconciler?.acquire(key, task);
            const card = reused ?? body.createDiv('task-card');
            if (reused) body.appendChild(reused);
            this.deps.taskRenderer.render(card, task, settings, { key, topRight });
        }
    }

    private openSort(list: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.sortMenu.setSortState(list.sortState ?? createEmptySortState());
        this.sortMenu.showMenuAtElement(anchorEl, {
            onSortChange: () => this.placement.replaceList(list.id, { sortState: this.sortMenu.getSortState() }),
        });
    }

    private openFilter(list: PinnedListDefinition, anchorEl: HTMLElement): void {
        this.filterMenu.showMenuAtElement(anchorEl, {
            value: list.filterState,
            onChange: (next) => this.placement.replaceList(list.id, { filterState: next }),
            getTasks: () => this.deps.index.getTasks(),
        });
    }

    private openTopRight(list: PinnedListDefinition, anchorEl: HTMLElement): void {
        const propertyKeys = FilterValueCollector.collectPropertyKeys(this.deps.index.getTasks());
        this.topRightEditor.open(anchorEl, {
            config: list.topRight,
            propertyKeys,
            onChange: (config) => this.placement.replaceList(list.id, { topRight: config }),
        });
    }

    /** The ⋯ menu: the items every list has, then the placement's. */
    private showMenu(event: MouseEvent, list: PinnedListDefinition, anchorEl: HTMLElement, nameEl: HTMLElement | null): void {
        this.deps.plugin.menuPresenter.present((menu) => {
            menu.addItem(item => item
                .setTitle(t('menu.rename'))
                .setIcon('pencil')
                .onClick(() => { if (nameEl) this.startRename(nameEl, list); }));
            menu.addItem(item => item
                .setTitle(t('menu.duplicate'))
                .setIcon('copy')
                .onClick(() => this.placement.insertCopy(list, copyOfList(list))));
            menu.addItem(item => item
                .setTitle(t('pinnedList.topRightLabel'))
                .setIcon('tag')
                .onClick(() => this.openTopRight(list, anchorEl)));
            menu.addItem(item => item
                .setTitle(t('menu.applyViewFilter'))
                .setIcon('filter')
                .setChecked(list.applyViewFilter)
                .onClick(() => this.placement.replaceList(list.id, { applyViewFilter: !list.applyViewFilter })));
            this.placement.appendMenuItems(menu, list);
        }, { kind: 'mouseEvent', event });
    }

    /** Edit the name in place; a new name is written, and the list is drawn with it. */
    private startRename(nameEl: HTMLElement, list: PinnedListDefinition): void {
        startListSectionRename(nameEl, this.placement.classes, list.name, (name) => {
            if (name !== list.name) this.placement.replaceList(list.id, { name });
        });
    }
}
