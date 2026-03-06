import { ItemView, Menu, WorkspaceLeaf, setIcon } from 'obsidian';
import { TaskIndex } from '../../services/core/TaskIndex';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { TaskDetailModal } from '../../modals/TaskDetailModal';
import TaskViewerPlugin from '../../main';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { SortMenuComponent } from '../customMenus/SortMenuComponent';
import { ViewSettingsMenu } from '../sharedUI/ViewToolbar';
import { FilterSerializer } from '../../services/filter/FilterSerializer';
import { createEmptyFilterState, hasConditions } from '../../services/filter/FilterTypes';
import type { FilterState } from '../../services/filter/FilterTypes';
import { createEmptySortState, hasSortRules } from '../../services/sort/SortTypes';
import { TaskFilterEngine } from '../../services/filter/TaskFilterEngine';
import { TaskSorter } from '../../services/sort/TaskSorter';
import { TaskStyling } from '../sharedUI/TaskStyling';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { VIEW_META_KANBAN } from '../../constants/viewRegistry';
import type { PinnedListDefinition } from '../../types';

export const VIEW_TYPE_KANBAN = VIEW_META_KANBAN.type;

export class KanbanView extends ItemView {
    private readonly taskIndex: TaskIndex;
    private readonly plugin: TaskViewerPlugin;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly menuHandler: MenuHandler;
    private readonly filterMenu = new FilterMenuComponent();
    private readonly sortMenu = new SortMenuComponent();
    private readonly viewFilterMenu = new FilterMenuComponent();

    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private customName: string | undefined;
    private viewFilterState: FilterState | undefined;
    private grid: PinnedListDefinition[][] = [];
    private gridCollapsed: Record<string, boolean> = {};

    constructor(leaf: WorkspaceLeaf, taskIndex: TaskIndex, plugin: TaskViewerPlugin) {
        super(leaf);
        this.taskIndex = taskIndex;
        this.plugin = plugin;
        this.taskRenderer = new TaskCardRenderer(this.app, this.taskIndex, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.leaf,
        }, () => this.plugin.settings);
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app, () => this.plugin.settings);
        this.menuHandler = new MenuHandler(this.app, this.taskIndex, this.plugin);
        this.taskRenderer.setChildMenuCallback((taskId, x, y) => this.menuHandler.showMenuForTask(taskId, x, y));
        this.taskRenderer.setDetailCallback((task) => {
            new TaskDetailModal(this.app, task, this.taskRenderer, this.menuHandler, this.plugin.settings, this.taskIndex).open();
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

    async setState(state: any, result: any): Promise<void> {
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

        this.unsubscribe = this.taskIndex.onChange(() => {
            this.render();
        });
    }

    async onClose(): Promise<void> {
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
        this.container.empty();

        // Toolbar
        const toolbarHost = this.container.createDiv('kanban-view__toolbar-host');
        this.renderToolbar(toolbarHost);

        // Grid host
        const gridHost = this.container.createDiv('kanban-view__grid-host');
        const cols = this.grid[0]?.length ?? 1;
        const gridEl = gridHost.createDiv('kanban-view__grid');
        gridEl.style.gridTemplateColumns = `repeat(${cols}, minmax(250px, 1fr))`;

        for (let r = 0; r < this.grid.length; r++) {
            for (let c = 0; c < this.grid[r].length; c++) {
                this.renderCell(gridEl, this.grid[r][c], r, c);
            }
        }

    }

    private renderToolbar(host: HTMLElement): void {
        const toolbar = host.createDiv('view-toolbar');

        toolbar.createDiv('view-toolbar__spacer');

        // View-level filter button
        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', 'Filter');
        filterBtn.classList.toggle('is-filtered', this.viewFilterMenu.hasActiveFilters());
        filterBtn.onclick = (e) => {
            this.viewFilterMenu.showMenu(e as MouseEvent, {
                onFilterChange: () => {
                    this.persistViewFilterState();
                    this.render();
                    filterBtn.classList.toggle('is-filtered', this.viewFilterMenu.hasActiveFilters());
                },
                getTasks: () => this.taskIndex.getTasks(),
                getStartHour: () => this.plugin.settings.startHour,
            });
        };

        ViewSettingsMenu.renderButton(toolbar, {
            app: this.app,
            leaf: this.leaf,
            getCustomName: () => this.customName,
            getDefaultName: () => VIEW_META_KANBAN.displayText,
            onRename: (newName) => {
                this.customName = newName;
                (this.leaf as any).updateHeader();
                this.app.workspace.requestSaveLayout();
            },
            buildUri: () => ({
                grid: this.grid,
                filterState: this.viewFilterMenu.getFilterState(),
            }),
            viewType: VIEW_META_KANBAN.type,
            getViewTemplateFolder: () => this.plugin.settings.viewTemplateFolder,
            getViewTemplate: () => ({
                filePath: '',
                name: this.customName || VIEW_META_KANBAN.displayText,
                viewType: 'kanban',
                grid: this.grid,
                filterState: this.viewFilterMenu.getFilterState(),
            }),
            onApplyTemplate: (template) => {
                if (template.grid && template.grid.length > 0) {
                    this.grid = template.grid;
                    this.gridCollapsed = {};
                }
                if (template.filterState) {
                    this.viewFilterState = template.filterState;
                    this.viewFilterMenu.setFilterState(template.filterState);
                }
                this.requestSaveLayout();
                this.render();
            },
            onReset: () => {
                this.grid = [[this.createDefaultList()]];
                this.gridCollapsed = {};
                this.customName = undefined;
                this.viewFilterState = undefined;
                this.viewFilterMenu.setFilterState(createEmptyFilterState());
                this.requestSaveLayout();
                this.render();
            },
        });
    }

    private renderCell(gridEl: HTMLElement, listDef: PinnedListDefinition, row: number, col: number): void {
        const isCollapsed = this.gridCollapsed[listDef.id] ?? false;

        const cell = gridEl.createDiv('kanban-view__cell');
        if (isCollapsed) cell.addClass('kanban-view__cell--collapsed');

        // ─── Header ─────────────────────────
        const header = cell.createDiv('kanban-view__cell-header');

        // Get task count for this cell
        const allTasks = this.taskIndex.getTasks();
        const filterContext = { startHour: this.plugin.settings.startHour };
        const tasks = allTasks.filter(t => {
            if (!TaskFilterEngine.evaluate(t, listDef.filterState, filterContext)) return false;
            if (listDef.applyViewFilter && this.viewFilterState && hasConditions(this.viewFilterState)) {
                if (!TaskFilterEngine.evaluate(t, this.viewFilterState, filterContext)) return false;
            }
            return true;
        });
        TaskSorter.sort(tasks, listDef.sortState);

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
                getTasks: () => this.taskIndex.getTasks(),
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
                    this.renderTaskCards(body, tasks);
                }
            }

            this.requestSaveLayout();
        });

        // ─── Body ───────────────────────────
        const body = cell.createDiv('kanban-view__cell-body');
        if (!isCollapsed) {
            this.renderTaskCards(body, tasks);
        }
    }

    private renderTaskCards(body: HTMLElement, tasks: import('../../types').Task[]): void {
        const settings = this.plugin.settings;
        for (const task of tasks) {
            const card = body.createDiv('task-card');
            TaskStyling.applyTaskColor(card, task.color ?? null);
            TaskStyling.applyTaskLinestyle(card, task.linestyle ?? null);
            this.taskRenderer.render(card, task, this, settings);
            this.menuHandler.addTaskContextMenu(card, task);
        }
    }

    // ─── Cell Context Menu ────────────────────────────────────

    private showCellMenu(e: MouseEvent, listDef: PinnedListDefinition, nameEl: HTMLElement, row: number, col: number): void {
        const menu = new Menu();

        menu.addItem(item => {
            item.setTitle('Rename')
                .setIcon('pencil')
                .onClick(() => this.startCellRename(nameEl, listDef));
        });

        menu.addItem(item => {
            item.setTitle('Duplicate')
                .setIcon('copy')
                .onClick(() => this.duplicateCell(listDef, row, col));
        });

        menu.addItem(item => {
            (item as any)
                .setTitle('Apply view filter')
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
            item.setTitle('Insert Row Above')
                .setIcon('arrow-up')
                .onClick(() => this.insertRow(row));
        });

        menu.addItem(item => {
            item.setTitle('Insert Row Below')
                .setIcon('arrow-down')
                .onClick(() => this.insertRow(row + 1));
        });

        menu.addItem(item => {
            item.setTitle('Insert Column Left')
                .setIcon('arrow-left')
                .onClick(() => this.insertColumn(col));
        });

        menu.addItem(item => {
            item.setTitle('Insert Column Right')
                .setIcon('arrow-right')
                .onClick(() => this.insertColumn(col + 1));
        });

        menu.addSeparator();

        if (this.grid.length > 1) {
            menu.addItem(item => {
                item.setTitle('Remove Row')
                    .setIcon('trash')
                    .onClick(() => this.removeRow(row));
            });
        }

        const cols = this.grid[0]?.length ?? 1;
        if (cols > 1) {
            menu.addItem(item => {
                item.setTitle('Remove Column')
                    .setIcon('trash')
                    .onClick(() => this.removeColumn(col));
            });
        }

        menu.showAtMouseEvent(e);
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
            name: 'New List',
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
            filterState: JSON.parse(JSON.stringify(listDef.filterState)),
            sortState: listDef.sortState ? JSON.parse(JSON.stringify(listDef.sortState)) : undefined,
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
