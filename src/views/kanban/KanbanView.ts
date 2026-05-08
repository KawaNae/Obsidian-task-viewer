import { ItemView, WorkspaceLeaf, setIcon, type ViewStateResult } from 'obsidian';
import { t } from '../../i18n';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { TaskDetailModal } from '../../modals/TaskDetailModal';
import TaskViewerPlugin from '../../main';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { SortMenuComponent } from '../customMenus/SortMenuComponent';
import { KanbanToolbar } from './KanbanToolbar';
import { FilterSerializer } from '../../services/filter/FilterSerializer';
import { combineFilterStates, createEmptyFilterState, hasConditions } from '../../services/filter/FilterTypes';
import type { FilterState } from '../../services/filter/FilterTypes';
import { createEmptySortState, hasSortRules } from '../../services/sort/SortTypes';
import { TaskStyling } from '../sharedUI/TaskStyling';
import { TaskPagingController } from '../sharedUI/TaskPagingController';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { ChildLineMenuBuilder } from '../../interaction/menu/builders/ChildLineMenuBuilder';
import { VIEW_META_KANBAN } from '../../constants/viewRegistry';
import type { PinnedListDefinition, DisplayTask } from '../../types';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';

export const VIEW_TYPE_KANBAN = VIEW_META_KANBAN.type;

interface KanbanViewState {
    grid?: PinnedListDefinition[][];
    gridCollapsed?: Record<string, boolean>;
    customName?: string;
    filterState?: FilterState;
}

export class KanbanView extends ItemView {
    private readonly plugin: TaskViewerPlugin;
    private readonly readService: TaskReadService;
    private readonly writeService: TaskWriteService;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly menuHandler: MenuHandler;
    private readonly filterMenu = new FilterMenuComponent();
    private readonly sortMenu = new SortMenuComponent();
    private readonly viewFilterMenu = new FilterMenuComponent();
    private readonly toolbar: KanbanToolbar;

    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private customName: string | undefined;
    private viewFilterState: FilterState | undefined;
    private grid: PinnedListDefinition[][] = [];
    private gridCollapsed: Record<string, boolean> = {};
    private readonly hoverParent = new TaskViewHoverParent();
    private readonly paging: TaskPagingController;

    constructor(leaf: WorkspaceLeaf, plugin: TaskViewerPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.readService = this.plugin.getTaskReadService();
        this.writeService = this.plugin.getTaskWriteService();
        this.taskRenderer = new TaskCardRenderer(this.app, this.readService, this.writeService, this.plugin.menuPresenter, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.hoverParent,
        }, () => this.plugin.settings);
        this.addChild(this.taskRenderer);
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app, () => this.plugin.settings);
        this.menuHandler = new MenuHandler(this.app, this.readService, this.writeService, this.plugin);
        this.taskRenderer.setChildMenuCallback((taskId, x, y) => this.menuHandler.showMenuForTask(taskId, x, y));
        const childLineMenuBuilder = new ChildLineMenuBuilder(this.app, this.writeService, this.plugin);
        this.taskRenderer.setChildLineEditCallback((parentTask, line, bodyLine, x, y) => {
            childLineMenuBuilder.showMenu(parentTask, line, bodyLine, x, y);
        });
        this.taskRenderer.setDetailCallback((task) => {
            new TaskDetailModal(this.app, task, this.taskRenderer, this.menuHandler, this.plugin.settings, this.readService).open();
        });
        this.filterMenu.setStartHourProvider(() => this.plugin.settings.startHour);
        this.filterMenu.setTaskLookupProvider((id) => this.readService.getTask(id));
        this.filterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);
        this.viewFilterMenu.setStartHourProvider(() => this.plugin.settings.startHour);
        this.viewFilterMenu.setTaskLookupProvider((id) => this.readService.getTask(id));
        this.viewFilterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);
        this.paging = new TaskPagingController(
            () => this.plugin.settings.pinnedListPageSize,
            (container, tasks, listId) => this.renderTaskCards(container, tasks, listId),
        );

        this.toolbar = new KanbanToolbar({
            app: this.app,
            leaf: this.leaf,
            plugin: this.plugin,
            readService: this.readService,
            filterMenu: this.viewFilterMenu,
            container: this.containerEl,
            onFilterChange: () => {
                this.persistViewFilterState();
                this.render();
            },
            getCustomName: () => this.customName,
            onRename: (newName) => {
                this.customName = newName;
                this.leaf.updateHeader();
                this.app.workspace.requestSaveLayout();
            },
            getGrid: () => this.grid,
            onApplyTemplate: (template) => {
                if (template.grid && template.grid.length > 0) {
                    this.grid = template.grid;
                    this.gridCollapsed = {};
                }
                if (template.filterState) {
                    this.viewFilterState = template.filterState;
                }
                this.requestSaveLayout();
                this.render();
            },
            onReset: () => {
                this.grid = [[this.createDefaultList()]];
                this.gridCollapsed = {};
                this.customName = undefined;
                this.viewFilterState = undefined;
                this.requestSaveLayout();
                this.render();
            },
        });
    }

    getViewType(): string {
        return VIEW_TYPE_KANBAN;
    }

    getDisplayText(): string {
        return this.customName || VIEW_META_KANBAN.displayText;
    }

    getIcon(): string {
        return VIEW_META_KANBAN.icon;
    }

    async setState(state: KanbanViewState, result: ViewStateResult): Promise<void> {
        if (state?.grid && Array.isArray(state.grid)) {
            this.grid = state.grid;
        }
        if (state?.gridCollapsed && typeof state.gridCollapsed === 'object') {
            this.gridCollapsed = state.gridCollapsed;
        }
        if (typeof state?.customName === 'string' && state.customName.trim()) {
            this.customName = state.customName;
        }
        if (state?.filterState) {
            const fs = FilterSerializer.fromJSON(state.filterState);
            this.viewFilterState = fs;
            this.viewFilterMenu.setFilterState(fs);
        }

        await super.setState(state, result);

        if (this.container) {
            this.render();
        }
    }

    getState(): Record<string, unknown> {
        const result: Record<string, unknown> = {};

        if (this.grid.length > 0) {
            result.grid = this.grid;
        }

        // Only persist collapse states that are true
        const collapsed: Record<string, boolean> = {};
        for (const [id, val] of Object.entries(this.gridCollapsed)) {
            if (val) collapsed[id] = true;
        }
        if (Object.keys(collapsed).length > 0) {
            result.gridCollapsed = collapsed;
        }

        if (this.customName) {
            result.customName = this.customName;
        }

        if (this.viewFilterState && hasConditions(this.viewFilterState)) {
            result.filterState = FilterSerializer.toJSON(this.viewFilterState);
        }

        return result;
    }

    async onOpen(): Promise<void> {
        this.container = this.contentEl;
        this.container.addClass('kanban-view');

        if (this.grid.length === 0) {
            this.grid = [[this.createDefaultList()]];
        }

        this.render();

        this.unsubscribe = this.readService.onChange(() => {
            this.render();
        });
    }

    async onClose(): Promise<void> {
        this.hoverParent.dispose();
        this.filterMenu.close();
        this.sortMenu.close();
        this.viewFilterMenu.close();
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    refresh(): void {
        this.render();
    }

    // ─── Render ───────────────────────────────────────────────

    private render(): void {
        this.toolbar.detach();
        this.taskRenderer.disposeInside(this.container);
        this.container.empty();
        this.paging.clear();

        // Toolbar
        const toolbarHost = this.container.createDiv('kanban-view__toolbar-host');
        this.toolbar.mount(toolbarHost);

        // Grid host
        const gridHost = this.container.createDiv('kanban-view__grid-host');
        const cols = this.grid[0]?.length ?? 1;
        const gridEl = gridHost.createDiv('kanban-view__grid');
        gridEl.style.gridTemplateColumns = `repeat(${cols}, minmax(250px, 1fr))`;

        for (let r = 0; r < this.grid.length; r++) {
            for (let c = 0; c < this.grid[r].length; c++) {
                const listDef = this.grid[r][c];
                this.renderCell(gridEl, listDef, r, c);
            }
        }

    }

    private renderCell(gridEl: HTMLElement, listDef: PinnedListDefinition, row: number, col: number): void {
        const isCollapsed = this.gridCollapsed[listDef.id] ?? false;

        const cell = gridEl.createDiv('kanban-view__cell');
        if (isCollapsed) cell.addClass('kanban-view__cell--collapsed');

        // ─── Header ─────────────────────────
        const header = cell.createDiv('kanban-view__cell-header');

        const combinedFilter = (this.viewFilterState && hasConditions(this.viewFilterState) && listDef.applyViewFilter)
            ? combineFilterStates(listDef.filterState, this.viewFilterState)
            : listDef.filterState;
        const tasks = this.readService.getFilteredTasks(combinedFilter, listDef.sortState);

        const toggle = header.createSpan({ text: isCollapsed ? '▶' : '▼', cls: 'kanban-view__cell-toggle' });
        const nameEl = header.createSpan({ text: listDef.name, cls: 'kanban-view__cell-name' });
        header.createSpan({ text: `(${tasks.length})`, cls: 'kanban-view__cell-count' });

        // Sort button
        const sortBtn = header.createEl('button', { cls: 'kanban-view__cell-btn' });
        setIcon(sortBtn.createSpan(), 'arrow-up-down');
        if (listDef.sortState && hasSortRules(listDef.sortState)) {
            sortBtn.addClass('is-sorted');
        }
        sortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.sortMenu.setSortState(listDef.sortState ?? createEmptySortState());
            this.sortMenu.showMenuAtElement(sortBtn, {
                onSortChange: () => {
                    listDef.sortState = this.sortMenu.getSortState();
                    this.requestSaveLayout();
                    this.render();
                },
            });
        });

        // Filter button
        const filterBtn = header.createEl('button', { cls: 'kanban-view__cell-btn' });
        setIcon(filterBtn.createSpan(), 'filter');
        if (hasConditions(listDef.filterState)) {
            filterBtn.addClass('is-filtered');
        }
        filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.filterMenu.setFilterState(listDef.filterState);
            this.filterMenu.showMenuAtElement(filterBtn, {
                onFilterChange: () => {
                    listDef.filterState = this.filterMenu.getFilterState();
                    this.requestSaveLayout();
                    this.render();
                },
                getTasks: () => this.readService.getTasks(),
                getStartHour: () => this.plugin.settings.startHour,
            });
        });

        // More button
        const moreBtn = header.createEl('button', { cls: 'kanban-view__cell-btn' });
        setIcon(moreBtn.createSpan(), 'more-horizontal');
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showCellMenu(e as MouseEvent, listDef, nameEl, row, col);
        });

        // Collapse toggle
        header.addEventListener('click', () => {
            const nextCollapsed = !this.gridCollapsed[listDef.id];
            this.gridCollapsed[listDef.id] = nextCollapsed;

            if (nextCollapsed) {
                cell.addClass('kanban-view__cell--collapsed');
                toggle.textContent = '▶';
            } else {
                cell.removeClass('kanban-view__cell--collapsed');
                toggle.textContent = '▼';
                // Lazy render on expand
                const body = cell.querySelector('.kanban-view__cell-body') as HTMLElement | null;
                if (body && body.childElementCount === 0 && tasks.length > 0) {
                    this.paging.resetOne(listDef.id);
                    this.paging.render(body, tasks, listDef.id);
                }
            }

            this.requestSaveLayout();
        });

        // ─── Body ───────────────────────────
        const body = cell.createDiv('kanban-view__cell-body');
        if (!isCollapsed) {
            this.paging.render(body, tasks, listDef.id);
        }
    }

    private renderTaskCards(body: HTMLElement, tasks: import('../../types').DisplayTask[], listId: string): void {
        const settings = this.plugin.settings;
        for (const task of tasks) {
            const card = body.createDiv('task-card');
            card.dataset.id = task.id;
            TaskStyling.applyTaskColor(card, task.color ?? null);
            TaskStyling.applyTaskLinestyle(card, task.linestyle ?? null);
            TaskStyling.applyReadOnly(card, task);
            this.taskRenderer.render(card, task, settings, {
                cardInstanceId: `kanban::cell-${listId}::${task.id}`,
            });
            this.menuHandler.addTaskContextMenu(card, task);
        }
    }

    // ─── Cell Context Menu ────────────────────────────────────

    private showCellMenu(e: MouseEvent, listDef: PinnedListDefinition, nameEl: HTMLElement, row: number, col: number): void {
        this.plugin.menuPresenter.present((menu) => {
        menu.addItem(item => {
            item.setTitle(t('menu.rename'))
                .setIcon('pencil')
                .onClick(() => this.startCellRename(nameEl, listDef));
        });

        menu.addItem(item => {
            item.setTitle(t('menu.duplicate'))
                .setIcon('copy')
                .onClick(() => this.duplicateCell(listDef, row, col));
        });

        menu.addItem(item => {
            item
                .setTitle(t('menu.applyViewFilter'))
                .setIcon('filter')
                .setChecked(!!listDef.applyViewFilter)
                .onClick(() => {
                    listDef.applyViewFilter = !listDef.applyViewFilter;
                    this.requestSaveLayout();
                    this.render();
                });
        });

        menu.addSeparator();

        menu.addItem(item => {
            item.setTitle(t('menu.insertRowAbove'))
                .setIcon('arrow-up')
                .onClick(() => this.insertRow(row));
        });

        menu.addItem(item => {
            item.setTitle(t('menu.insertRowBelow'))
                .setIcon('arrow-down')
                .onClick(() => this.insertRow(row + 1));
        });

        menu.addItem(item => {
            item.setTitle(t('menu.insertColumnLeft'))
                .setIcon('arrow-left')
                .onClick(() => this.insertColumn(col));
        });

        menu.addItem(item => {
            item.setTitle(t('menu.insertColumnRight'))
                .setIcon('arrow-right')
                .onClick(() => this.insertColumn(col + 1));
        });

        menu.addSeparator();

        if (this.grid.length > 1) {
            menu.addItem(item => {
                item.setTitle(t('menu.removeRow'))
                    .setIcon('trash')
                    .onClick(() => this.removeRow(row));
            });
        }

        const cols = this.grid[0]?.length ?? 1;
        if (cols > 1) {
            menu.addItem(item => {
                item.setTitle(t('menu.removeColumn'))
                    .setIcon('trash')
                    .onClick(() => this.removeColumn(col));
            });
        }
        }, { kind: 'mouseEvent', event: e });
    }

    private startCellRename(nameEl: HTMLElement, listDef: PinnedListDefinition): void {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = listDef.name;
        input.className = 'kanban-view__cell-name-input';
        nameEl.replaceWith(input);
        input.focus();
        input.select();

        let committed = false;
        const commit = (newName: string) => {
            if (committed) return;
            committed = true;
            listDef.name = newName;
            this.requestSaveLayout();

            const span = document.createElement('span');
            span.className = 'kanban-view__cell-name';
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
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    // ─── Grid Operations ──────────────────────────────────────

    private createDefaultList(): PinnedListDefinition {
        return {
            id: this.generateId(),
            name: t('pinnedList.newList'),
            filterState: createEmptyFilterState(),
        };
    }

    private generateId(): string {
        return 'kb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    }

    private addRow(): void {
        const cols = this.grid[0]?.length ?? 1;
        const newRow: PinnedListDefinition[] = [];
        for (let c = 0; c < cols; c++) {
            newRow.push(this.createDefaultList());
        }
        this.grid.push(newRow);
        this.requestSaveLayout();
        this.render();
    }

    private addColumn(): void {
        for (const row of this.grid) {
            row.push(this.createDefaultList());
        }
        this.requestSaveLayout();
        this.render();
    }

    private insertRow(atIndex: number): void {
        const cols = this.grid[0]?.length ?? 1;
        const newRow: PinnedListDefinition[] = [];
        for (let c = 0; c < cols; c++) {
            newRow.push(this.createDefaultList());
        }
        this.grid.splice(atIndex, 0, newRow);
        this.requestSaveLayout();
        this.render();
    }

    private insertColumn(atIndex: number): void {
        for (const row of this.grid) {
            row.splice(atIndex, 0, this.createDefaultList());
        }
        this.requestSaveLayout();
        this.render();
    }

    private removeRow(index: number): void {
        if (this.grid.length <= 1) return;
        this.grid.splice(index, 1);
        this.requestSaveLayout();
        this.render();
    }

    private removeColumn(index: number): void {
        const cols = this.grid[0]?.length ?? 1;
        if (cols <= 1) return;
        for (const row of this.grid) {
            row.splice(index, 1);
        }
        this.requestSaveLayout();
        this.render();
    }

    private duplicateCell(listDef: PinnedListDefinition, row: number, col: number): void {
        const dup: PinnedListDefinition = {
            id: this.generateId(),
            name: listDef.name + ' (copy)',
            filterState: structuredClone(listDef.filterState),
            sortState: listDef.sortState ? structuredClone(listDef.sortState) : undefined,
        };

        // Insert duplicated cell to the right in the same row, and add a new cell to all other rows
        if (this.grid[0].length === this.grid[row].length) {
            // Rectangular: insert column at col+1
            for (let r = 0; r < this.grid.length; r++) {
                if (r === row) {
                    this.grid[r].splice(col + 1, 0, dup);
                } else {
                    this.grid[r].splice(col + 1, 0, this.createDefaultList());
                }
            }
        }

        this.requestSaveLayout();
        this.render();
    }

    private requestSaveLayout(): void {
        this.app.workspace.requestSaveLayout();
    }

    private persistViewFilterState(): void {
        const state = this.viewFilterMenu.getFilterState();
        this.viewFilterState = hasConditions(state)
            ? FilterSerializer.fromJSON(FilterSerializer.toJSON(state))
            : undefined;
        this.requestSaveLayout();
    }
}
