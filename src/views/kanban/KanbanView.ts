import type { WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { createCardRendering } from '../sharedUI/CardRendering';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { SortMenuComponent } from '../customMenus/SortMenuComponent';
import { KanbanToolbar } from './KanbanToolbar';
import { createDefaultListFilterState } from '../../services/filter/FilterTypes';
import { PinnedListQuery } from '../../services/filter/PinnedListQuery';
import { createEmptySortState } from '../../services/sort/SortTypes';
import { TaskPagingController } from '../sharedUI/TaskPagingController';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { PixelScrollRestorer } from '../sharedUI/PixelScrollRestorer';
import {
    renderListSection,
    startListSectionRename,
    type ListSectionClasses,
} from '../sharedUI/ListSectionRenderer';

import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { PinnedListDefinition, DisplayTask } from '../../types';
import { KanbanCodec, type KanbanConfig, type KanbanTransient } from './KanbanSchema';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { IndexReads } from '../../services/core/TaskIndex';
import { TopRightConfigEditor } from '../customMenus/TopRightConfigEditor';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';
import { TaskViewerView } from '../base/TaskViewerView';


/**
 * Grid variant of the shared list section: a card with its own background and
 * border, one per grid cell.
 */
const KANBAN_CELL_CLASSES: ListSectionClasses = {
    root: 'kanban-view__cell',
    collapsed: 'kanban-view__cell--collapsed',
    header: 'kanban-view__cell-header',
    toggle: 'kanban-view__cell-toggle',
    name: 'kanban-view__cell-name',
    count: 'kanban-view__cell-count',
    button: 'kanban-view__cell-btn',
    body: 'kanban-view__cell-body',
    nameInput: 'kanban-view__cell-name-input',
};

/**
 * Kanban View - a grid of task lists.
 *
 * Its state is KanbanSchema's config and transient fields, held in the
 * base's store. The grid always holds a cell: a state without one (a new
 * view, a reset, a template without a grid) is given a default list.
 */
export class KanbanView extends TaskViewerView<KanbanConfig, KanbanTransient> {
    private readonly readService: TaskReadService;
    /** The index's copies and changes (`PluginContext.getIndex`). */
    private readonly index: IndexReads;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly linkInteractionManager: TaskLinkInteractionManager;
    private readonly listFilterMenu = new FilterMenuComponent();
    private readonly listSortMenu = new SortMenuComponent();
    private readonly toolbar: KanbanToolbar;

    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    /**
     * Scroll position across full re-renders, on both axes. The element is
     * re-queried each time because `render()` builds a fresh grid host.
     */
    private readonly scrollRestorer = new PixelScrollRestorer(
        () => this.container?.querySelector('.kanban-view__grid-host') as HTMLElement | null,
        { axis: 'both' },
    );
    private readonly hoverParent = new TaskViewHoverParent();
    private listDefMap = new Map<string, PinnedListDefinition>();
    private topRightEditor = new TopRightConfigEditor();
    private readonly paging: TaskPagingController;
    /**
     * Reconciler for the in-flight `render()` call. Set at the top of
     * `render()` and consumed by `renderTaskCards` (which is called both
     * directly and via `paging.render`'s callback). Null between renders.
     */
    private currentReconciler: CardReconciler | null = null;

    getViewType(): string {
        return KanbanCodec.schema.viewType;
    }

    constructor(leaf: WorkspaceLeaf, plugin: PluginContext & TimerHost) {
        super(leaf, plugin, KanbanCodec);
        this.readService = this.plugin.getTaskReadService();
        this.index = this.plugin.getIndex();
        const cards = createCardRendering({
            app: this.app,
            plugin: this.plugin,
            getHoverParent: () => this.hoverParent,
            getMaskMode: () => this.state.maskMode ?? false,
        });
        this.taskRenderer = cards.taskRenderer;
        this.addChild(this.taskRenderer);
        this.linkInteractionManager = new TaskLinkInteractionManager(this.app, () => this.plugin.settings);
        this.listFilterMenu.setStatusDefinitions(this.plugin.settings.statusDefinitions);
        this.paging = new TaskPagingController(
            () => this.plugin.settings.pinnedListPageSize,
            (container, tasks, listId) => this.renderTaskCards(container, tasks, listId),
        );

        this.toolbar = new KanbanToolbar({ host: this.toolbarHost() });

        // A grid without a cell is given the default list, in the same change.
        this.store.subscribe((patch) => {
            if ('grid' in patch && !hasCells(this.state.grid)) {
                this.update({ grid: [[this.createDefaultList()]] });
            }
        });
    }

    /** The grid drawn. */
    private get grid(): PinnedListDefinition[][] {
        return this.state.grid ?? [];
    }

    /** Write the grid; the board is drawn again. */
    private setGrid(grid: PinnedListDefinition[][]): void {
        this.update({ grid });
    }

    /** Write one list of the grid, as a new grid. */
    private replaceList(id: string, patch: Partial<PinnedListDefinition>, options?: { draw?: boolean }): void {
        const grid = this.grid.map(row => row.map(l => l.id === id ? { ...l, ...patch } : l));
        this.update({ grid }, options);
    }

    protected openView(): void {
        this.container = this.contentEl;
        this.container.addClass('kanban-view');

        this.unsubscribe = this.index.onChange((taskId, changes) => {
            this.renderScheduler.handleChange(taskId, changes);
        });
    }

    protected closeView(): void {
        this.hoverParent.dispose();
        this.listFilterMenu.close();
        this.listSortMenu.close();
        this.toolbar.close();
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.scrollRestorer.dispose();
    }

    // ─── Render ───────────────────────────────────────────────

    protected draw(): void {
        // The board is rebuilt from scratch below, so the scroll offsets of the
        // old grid host die with it. Both axes matter here: columns run
        // horizontally, so scrollLeft is the position a user notices most.
        this.scrollRestorer.save();
        this.toolbar.detach();

        // Keyed reconciliation: lift surviving cards before tearing down the
        // grid. They will be re-parented + re-decorated as their
        // key turns up in the new render; unmatched ones (filter
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
        this.listDefMap.clear();
        for (let r = 0; r < this.grid.length; r++) {
            for (let c = 0; c < this.grid[r].length; c++) {
                const listDef = this.grid[r][c];
                currentListIds.add(listDef.id);
                this.listDefMap.set(listDef.id, listDef);
                this.renderCell(gridEl, listDef, r, c);
            }
        }
        this.paging.pruneRemovedLists(currentListIds);

        // Dispose any cards that did not turn up in the new render.
        reconciler.forEachStale(card => this.taskRenderer.dispose(card));
        this.currentReconciler = null;

        this.scrollRestorer.restore();
    }

    private renderCell(gridEl: HTMLElement, listDef: PinnedListDefinition, row: number, col: number): void {
        const isCollapsed = this.state.gridCollapsed?.[listDef.id] ?? false;

        const query = PinnedListQuery.resolve(listDef, this.state.filterState);
        const tasks = this.readService.getFilteredTasks(query.filter, query.sort);

        renderListSection(gridEl, {
            classes: KANBAN_CELL_CLASSES,
            name: listDef.name,
            taskCount: tasks.length,
            collapsed: isCollapsed,
            sortState: listDef.sortState,
            filterState: listDef.filterState,
            onSortClick: (anchorEl) => {
                this.listSortMenu.setSortState(listDef.sortState ?? createEmptySortState());
                this.listSortMenu.showMenuAtElement(anchorEl, {
                    onSortChange: () => {
                        this.replaceList(listDef.id, { sortState: this.listSortMenu.getSortState() });
                    },
                });
            },
            onFilterClick: (anchorEl) => {
                this.listFilterMenu.showMenuAtElement(anchorEl, {
                    value: listDef.filterState,
                    onChange: (next) => this.replaceList(listDef.id, { filterState: next }),
                    getTasks: () => this.index.getTasks(),
                });
            },
            onMoreClick: (anchorEl, event) => {
                const nameEl = anchorEl.parentElement
                    ?.querySelector(`.${KANBAN_CELL_CLASSES.name}`) as HTMLElement | null;
                if (nameEl) this.showCellMenu(event, listDef, nameEl, row, col);
            },
            onCollapsedChange: (collapsed) => {
                this.update({
                    gridCollapsed: { ...this.state.gridCollapsed, [listDef.id]: collapsed },
                }, { draw: false });
            },
            renderBody: (body, opts) => {
                if (opts.resetPaging) this.paging.resetOne(listDef.id);
                this.paging.render(body, tasks, listDef.id);
            },
        });
    }

    private renderTaskCards(body: HTMLElement, tasks: import('../../types').DisplayTask[], listId: string): void {
        const settings = this.plugin.settings;
        const reconciler = this.currentReconciler;
        const listDef = this.listDefMap.get(listId);
        const topRight = listDef?.topRight
            ? { mode: 'template' as const, config: listDef.topRight }
            : { mode: 'none' as const };
        for (const task of tasks) {
            const key = { scope: `cell-${listId}`, name: task.id };
            const reused = reconciler?.acquire(key, task);
            const card = reused ?? body.createDiv('task-card');
            if (reused) body.appendChild(reused);

            this.taskRenderer.render(card, task, settings, {
                key,
                topRight,
            });
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
            item.setTitle(t('pinnedList.topRightLabel'))
                .setIcon('tag')
                .onClick(() => {
                    const tasks = this.index.getTasks();
                    const propertyKeys = FilterValueCollector.collectPropertyKeys(tasks);
                    this.topRightEditor.open(nameEl, {
                        config: listDef.topRight,
                        propertyKeys,
                        onChange: (config) => this.replaceList(listDef.id, { topRight: config }),
                    });
                });
        });

        menu.addItem(item => {
            item
                .setTitle(t('menu.applyViewFilter'))
                .setIcon('filter')
                .setChecked(listDef.applyViewFilter)
                .onClick(() => this.replaceList(listDef.id, { applyViewFilter: !listDef.applyViewFilter }));
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
        // The rename shows the new name in place; the board is not drawn.
        startListSectionRename(nameEl, KANBAN_CELL_CLASSES, listDef.name, (newName) => {
            this.replaceList(listDef.id, { name: newName }, { draw: false });
        });
    }

    // ─── Grid Operations ──────────────────────────────────────

    private createDefaultList(): PinnedListDefinition {
        return {
            id: this.generateId(),
            name: t('pinnedList.newList'),
            filterState: createDefaultListFilterState(),
            applyViewFilter: false,
        };
    }

    private generateId(): string {
        return 'kb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    }

    private insertRow(atIndex: number): void {
        const cols = this.grid[0]?.length ?? 1;
        const newRow: PinnedListDefinition[] = [];
        for (let c = 0; c < cols; c++) {
            newRow.push(this.createDefaultList());
        }
        const grid = [...this.grid];
        grid.splice(atIndex, 0, newRow);
        this.setGrid(grid);
    }

    private insertColumn(atIndex: number): void {
        this.setGrid(this.grid.map(row => {
            const next = [...row];
            next.splice(atIndex, 0, this.createDefaultList());
            return next;
        }));
    }

    private removeRow(index: number): void {
        if (this.grid.length <= 1) return;
        this.setGrid(this.grid.filter((_, r) => r !== index));
    }

    private removeColumn(index: number): void {
        const cols = this.grid[0]?.length ?? 1;
        if (cols <= 1) return;
        this.setGrid(this.grid.map(row => row.filter((_, c) => c !== index)));
    }

    private duplicateCell(listDef: PinnedListDefinition, row: number, col: number): void {
        const dup: PinnedListDefinition = {
            ...listDef,
            id: this.generateId(),
            name: listDef.name + ' (copy)',
        };

        // Insert the duplicate to the right in its row; keep the grid
        // rectangular by inserting a default cell at the same column in every
        // other row. splice tolerates col+1 past a shorter row's length (it
        // appends), so a non-rectangular grid no longer silently no-ops.
        this.setGrid(this.grid.map((cells, r) => {
            const next = [...cells];
            next.splice(col + 1, 0, r === row ? dup : this.createDefaultList());
            return next;
        }));
    }
}

/** Whether a grid holds a cell. */
function hasCells(grid: PinnedListDefinition[][] | undefined): boolean {
    return !!grid && grid.some(row => row.length > 0);
}
