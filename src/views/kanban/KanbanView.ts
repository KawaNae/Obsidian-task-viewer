import { ItemView, WorkspaceLeaf, setIcon, type ViewStateResult } from 'obsidian';
import { logDebug } from '../../log/log';
import { t } from '../../i18n';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { TaskHubModal, type TaskHubModalOptions } from '../../modals/hub/TaskHubModal';
import TaskViewerPlugin from '../../main';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { SortMenuComponent } from '../customMenus/SortMenuComponent';
import { KanbanToolbar } from './KanbanToolbar';
import { FilterSerializer } from '../../services/filter/FilterSerializer';
import { combineFilterStates, createEmptyFilterState, hasConditions } from '../../services/filter/FilterTypes';
import type { FilterState } from '../../services/filter/FilterTypes';
import { createEmptySortState, hasSortRules } from '../../services/sort/SortTypes';
import { TaskStyling } from '../sharedUI/TaskStyling';
import { getEffectiveColor, getEffectiveLinestyle } from '../../services/data/EffectiveProperties';
import { TaskPagingController } from '../sharedUI/TaskPagingController';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { shouldRenderForChanges } from '../sharedUI/RenderScheduler';

import { openTaskInEditor } from '../sharedLogic/NavigationUtils';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { ChildLineMenuBuilder } from '../../interaction/menu/builders/ChildLineMenuBuilder';
import { VIEW_META_KANBAN } from '../../constants/viewRegistry';
import type { PinnedListDefinition, DisplayTask, Task } from '../../types';
import { codecFor, type ViewConfigCodec } from '../../services/viewConfig';
import { KanbanSchema, type KanbanConfig, type KanbanTransient } from './KanbanSchema';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { TaskWriteService } from '../../services/data/TaskWriteService';

export const VIEW_TYPE_KANBAN = VIEW_META_KANBAN.type;

type KanbanViewState = Partial<KanbanConfig> & Partial<KanbanTransient>;

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
    private maskMode: boolean = false;
    private readonly hoverParent = new TaskViewHoverParent();
    private readonly paging: TaskPagingController;
    /**
     * Reconciler for the in-flight `render()` call. Set at the top of
     * `render()` and consumed by `renderTaskCards` (which is called both
     * directly and via `paging.render`'s callback). Null between renders.
     */
    private currentReconciler: CardReconciler | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: TaskViewerPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.readService = this.plugin.getTaskReadService();
        this.writeService = this.plugin.getTaskWriteService();
        this.taskRenderer = new TaskCardRenderer(this.app, this.readService, this.writeService, this.plugin.menuPresenter, {
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            getHoverParent: () => this.hoverParent,
        }, () => this.plugin.settings, () => this.maskMode);
        this.addChild(this.taskRenderer);
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app, () => this.plugin.settings);
        this.menuHandler = new MenuHandler(this.app, this.readService, this.writeService, this.plugin);
        this.taskRenderer.setChildMenuCallback((taskId, x, y) => this.menuHandler.showMenuForTask(taskId, x, y));
        const childLineMenuBuilder = new ChildLineMenuBuilder(this.app, this.writeService, this.plugin);
        this.taskRenderer.setChildLineEditCallback((parentTask, line, bodyLine, x, y) => {
            childLineMenuBuilder.showMenu(parentTask, line, bodyLine, x, y);
        });
        const openTaskHub = (task: Task, opts?: TaskHubModalOptions) => {
            new TaskHubModal(this.app, task, {
                taskRenderer: this.taskRenderer,
                menuHandler: this.menuHandler,
                readService: this.readService,
                writeService: this.writeService,
                plugin: this.plugin,
            }, opts).open();
        };
        this.taskRenderer.setDetailCallback((task) => openTaskHub(task));
        this.taskRenderer.setContextMenuCallback((task, x, y) => this.menuHandler.showTaskContextMenu(task, x, y));
        this.taskRenderer.setOpenInEditorCallback((task) => openTaskInEditor(this.app, task, this.plugin.settings.reuseExistingTab));
        this.taskRenderer.setDoubleTapActionGetter(() => this.plugin.settings.doubleTapAction);
        this.menuHandler.setTaskHubOpener((taskId, opts) => {
            const task = this.readService.getTask(taskId);
            if (task) openTaskHub(task, opts);
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
            getCurrentConfig: () => this.getCurrentConfig(),
            applyConfig: (cfg) => this.applyConfig(cfg),
            onConfigApplied: () => {
                this.leaf.updateHeader();
                this.requestSaveLayout();
                this.render();
            },
            getMaskMode: () => this.maskMode,
            setMaskMode: (next) => {
                this.maskMode = next;
                this.requestSaveLayout();
                this.render();
                this.toolbar.update();
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

    private get codec(): ViewConfigCodec<KanbanConfig, KanbanTransient> {
        return codecFor(VIEW_TYPE_KANBAN) as ViewConfigCodec<KanbanConfig, KanbanTransient>;
    }

    applyConfig(cfg: Partial<KanbanConfig>): void {
        const next: Partial<KanbanConfig> = { ...KanbanSchema.defaults, ...cfg };
        if (next.grid && next.grid.length > 0) {
            this.grid = next.grid;
            this.gridCollapsed = {};
        } else {
            this.grid = [[this.createDefaultList()]];
            this.gridCollapsed = {};
        }
        this.customName = next.customName;
        this.maskMode = next.maskMode === true;
        const fs = next.filterState;
        this.viewFilterState = fs;
        this.viewFilterMenu.setFilterState(fs ?? createEmptyFilterState());
    }

    getCurrentConfig(): Partial<KanbanConfig> {
        return {
            customName: this.customName,
            filterState: this.viewFilterState && hasConditions(this.viewFilterState)
                ? this.viewFilterState : undefined,
            maskMode: this.maskMode,
            grid: this.grid.length > 0 ? this.grid : undefined,
        };
    }

    async setState(state: KanbanViewState, result: ViewStateResult): Promise<void> {
        const stateDict = (state ?? {}) as Record<string, unknown>;
        const config = this.codec.parseConfig(stateDict);
        const transient = this.codec.parseTransient(stateDict);

        this.applyConfig(config);

        if (transient.gridCollapsed) {
            this.gridCollapsed = transient.gridCollapsed;
        }

        await super.setState(state, result);

        if (this.container) {
            this.render();
        }
    }

    getState(): Record<string, unknown> {
        return {
            ...this.codec.serializeConfig(this.getCurrentConfig()),
            ...this.codec.serializeTransient({ gridCollapsed: this.gridCollapsed }),
        };
    }

    async onOpen(): Promise<void> {
        logDebug(`[${this.getViewType()}] opened`);
        this.container = this.contentEl;
        this.container.addClass('kanban-view');

        if (this.grid.length === 0) {
            this.grid = [[this.createDefaultList()]];
        }

        this.render();

        this.unsubscribe = this.readService.onChange((_taskId, changes) => {
            if (!shouldRenderForChanges(changes)) return;
            this.render();
        });
    }

    async onClose(): Promise<void> {
        logDebug(`[${this.getViewType()}] closed`);
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

        // Keyed reconciliation: lift surviving cards before tearing down the
        // grid. They will be re-parented + re-decorated as their
        // cardInstanceId turns up in the new render; unmatched ones (filter
        // dropped, deleted, etc.) are disposed at the end.
        const reconciler = new CardReconciler();
        reconciler.detach(this.container);
        this.currentReconciler = reconciler;

        this.container.empty();
        // paging.clear() is intentionally not called: page positions outlive
        // a render now that cards are reconciled rather than reconstructed.
        // pruneRemovedLists() handles list deletions further down.

        // Toolbar
        const toolbarHost = this.container.createDiv('kanban-view__toolbar-host');
        this.toolbar.mount(toolbarHost);

        // Grid host
        const gridHost = this.container.createDiv('kanban-view__grid-host');
        const cols = this.grid[0]?.length ?? 1;
        const gridEl = gridHost.createDiv('kanban-view__grid');
        gridEl.style.gridTemplateColumns = `repeat(${cols}, minmax(250px, 1fr))`;

        const currentListIds = new Set<string>();
        for (let r = 0; r < this.grid.length; r++) {
            for (let c = 0; c < this.grid[r].length; c++) {
                const listDef = this.grid[r][c];
                currentListIds.add(listDef.id);
                this.renderCell(gridEl, listDef, r, c);
            }
        }
        this.paging.pruneRemovedLists(currentListIds);

        // Dispose any cards that did not turn up in the new render.
        reconciler.forEachStale(card => this.taskRenderer.dispose(card));
        this.currentReconciler = null;
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
        const reconciler = this.currentReconciler;
        for (const task of tasks) {
            const cardInstanceId = `kanban::cell-${listId}::${task.id}`;
            const reused = reconciler?.acquire(cardInstanceId);
            const card = reused ?? body.createDiv('task-card');
            if (reused) body.appendChild(reused);

            this.decorateKanbanCard(card, task);
            this.taskRenderer.render(card, task, settings, {
                cardInstanceId,
            });
            if (!reused) this.menuHandler.addTaskContextMenu(card, task);
        }
    }

    /**
     * Idempotent decoration for kanban cards (color / linestyle / readonly).
     * Kanban tasks are never split in this path, so no split variants apply.
     */
    private decorateKanbanCard(card: HTMLElement, task: import('../../types').DisplayTask): void {
        card.dataset.id = task.id;

        TaskStyling.applyTaskColor(card, getEffectiveColor(task) ?? null);
        TaskStyling.applyTaskLinestyle(card, getEffectiveLinestyle(task) ?? null);
        TaskStyling.applyReadOnly(card, task);
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
            ...listDef,
            id: this.generateId(),
            name: listDef.name + ' (copy)',
            filterState: structuredClone(listDef.filterState),
            sortState: listDef.sortState ? structuredClone(listDef.sortState) : undefined,
        };

        // Insert the duplicate to the right in its row; keep the grid
        // rectangular by inserting a default cell at the same column in every
        // other row. splice tolerates col+1 past a shorter row's length (it
        // appends), so a non-rectangular grid no longer silently no-ops.
        for (let r = 0; r < this.grid.length; r++) {
            this.grid[r].splice(col + 1, 0, r === row ? dup : this.createDefaultList());
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
