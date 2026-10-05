import type { Menu, WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { createCardRendering } from '../sharedUI/CardRendering';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { KanbanToolbar } from './KanbanToolbar';
import { CardReconciler } from '../sharedUI/CardReconciler';
import { PixelScrollRestorer } from '../sharedUI/PixelScrollRestorer';
import type { ListSectionClasses } from '../sharedUI/ListSectionRenderer';
import { TaskListSections, newList } from '../sharedUI/TaskListSections';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import type { PinnedListDefinition } from '../../types';
import { KanbanCodec, type KanbanConfig, type KanbanTransient } from './KanbanSchema';
import type { IndexReads } from '../../services/core/TaskIndex';
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
    /** The index's copies and changes (`PluginContext.getIndex`). */
    private readonly index: IndexReads;
    private readonly taskRenderer: TaskCardRenderer;
    private readonly toolbar: KanbanToolbar;
    /** The board's lists: the grid is their placement. */
    private readonly cells: TaskListSections;

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

    getViewType(): string {
        return KanbanCodec.schema.viewType;
    }

    constructor(leaf: WorkspaceLeaf, plugin: PluginContext & TimerHost) {
        super(leaf, plugin, KanbanCodec);
        this.index = this.plugin.getIndex();
        const cards = createCardRendering({
            app: this.app,
            plugin: this.plugin,
            getHoverParent: () => this.hoverParent,
            getMaskMode: () => this.state.maskMode ?? false,
        });
        this.taskRenderer = cards.taskRenderer;
        this.addChild(this.taskRenderer);
        this.cells = new TaskListSections({
            plugin: this.plugin,
            readService: this.plugin.getTaskReadService(),
            index: this.index,
            taskRenderer: this.taskRenderer,
        }, {
            classes: KANBAN_CELL_CLASSES,
            scopePrefix: 'cell',
            replaceList: (id, patch) => this.setGrid(this.grid.map(row => row.map(l => l.id === id ? { ...l, ...patch } : l))),
            setCollapsed: (id, collapsed) => this.update({
                gridCollapsed: { ...this.state.gridCollapsed, [id]: collapsed },
            }, { draw: false }),
            insertCopy: (list, copy) => this.insertCopy(list, copy),
            appendMenuItems: (menu, list) => this.appendCellMenuItems(menu, list),
        });

        this.toolbar = new KanbanToolbar({ host: this.toolbarHost() });

        // A grid without a cell is given the default list, in the same change.
        this.store.subscribe((patch) => {
            if ('grid' in patch && !hasCells(this.state.grid)) {
                this.update({ grid: [[newList()]] });
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

    protected openView(): void {
        this.container = this.contentEl;
        this.container.addClass('kanban-view');

        this.unsubscribe = this.index.onChange((taskId, changes) => {
            this.renderScheduler.handleChange(taskId, changes);
        });
    }

    protected closeView(): void {
        this.hoverParent.dispose();
        this.cells.close();
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

        // Keep the cards already shown: they are re-parented as their key
        // turns up in the new board, and the rest are disposed at the end.
        const reconciler = new CardReconciler();
        reconciler.detach(this.container);
        this.container.empty();

        const toolbarHost = this.container.createDiv('kanban-view__toolbar-host');
        this.toolbar.mount(toolbarHost);

        // The cells fill the grid row by row: the columns are the grid's.
        const gridHost = this.container.createDiv('kanban-view__grid-host');
        const gridEl = gridHost.createDiv('kanban-view__grid');
        gridEl.style.gridTemplateColumns = `repeat(${this.grid[0]?.length ?? 1}, minmax(250px, 1fr))`;
        this.cells.draw(gridEl, this.grid.flat(), {
            reconciler,
            collapsed: this.state.gridCollapsed ?? {},
            viewFilter: this.state.filterState,
        });

        reconciler.forEachStale(card => this.taskRenderer.dispose(card));
        this.scrollRestorer.restore();
    }

    // ─── Cell Menu ────────────────────────────────────────────

    /** Where the list `id` is on the grid. */
    private positionOf(id: string): { row: number; col: number } | null {
        for (let row = 0; row < this.grid.length; row++) {
            const col = this.grid[row].findIndex(l => l.id === id);
            if (col >= 0) return { row, col };
        }
        return null;
    }

    /** Insert and remove rows and columns, around the cell. */
    private appendCellMenuItems(menu: Menu, list: PinnedListDefinition): void {
        const at = this.positionOf(list.id);
        if (!at) return;
        const { row, col } = at;

        menu.addSeparator();
        menu.addItem(item => item.setTitle(t('menu.insertRowAbove')).setIcon('arrow-up').onClick(() => this.insertRow(row)));
        menu.addItem(item => item.setTitle(t('menu.insertRowBelow')).setIcon('arrow-down').onClick(() => this.insertRow(row + 1)));
        menu.addItem(item => item.setTitle(t('menu.insertColumnLeft')).setIcon('arrow-left').onClick(() => this.insertColumn(col)));
        menu.addItem(item => item.setTitle(t('menu.insertColumnRight')).setIcon('arrow-right').onClick(() => this.insertColumn(col + 1)));

        menu.addSeparator();
        if (this.grid.length > 1) {
            menu.addItem(item => item.setTitle(t('menu.removeRow')).setIcon('trash').onClick(() => this.removeRow(row)));
        }
        if ((this.grid[0]?.length ?? 1) > 1) {
            menu.addItem(item => item.setTitle(t('menu.removeColumn')).setIcon('trash').onClick(() => this.removeColumn(col)));
        }
    }

    // ─── Grid Operations ──────────────────────────────────────

    private insertRow(atIndex: number): void {
        const cols = this.grid[0]?.length ?? 1;
        const newRow: PinnedListDefinition[] = [];
        for (let c = 0; c < cols; c++) {
            newRow.push(newList());
        }
        const grid = [...this.grid];
        grid.splice(atIndex, 0, newRow);
        this.setGrid(grid);
    }

    private insertColumn(atIndex: number): void {
        this.setGrid(this.grid.map(row => {
            const next = [...row];
            next.splice(atIndex, 0, newList());
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

    /**
     * Put `copy` right of `list` in its row; the other rows are given a new
     * list in the same column, so the grid stays rectangular.
     */
    private insertCopy(list: PinnedListDefinition, copy: PinnedListDefinition): void {
        const at = this.positionOf(list.id);
        if (!at) return;
        this.setGrid(this.grid.map((cells, r) => {
            const next = [...cells];
            next.splice(at.col + 1, 0, r === at.row ? copy : newList());
            return next;
        }));
    }
}

/** Whether a grid holds a cell. */
function hasCells(grid: PinnedListDefinition[][] | undefined): boolean {
    return !!grid && grid.some(row => row.length > 0);
}
