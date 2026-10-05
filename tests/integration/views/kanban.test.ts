/**
 * Kanban's grid of lists, in the running Dev vault, driven as the user
 * clicks it: each cell's ⋯ menu (insert and remove rows and columns,
 * duplicate, rename, display label, Apply view filter), its header
 * (collapse), its sort and filter buttons, and the toolbar's filter. What the
 * board shows is read from its DOM, what the view keeps from `getState`
 * (`grid`, `gridCollapsed`, `filterState`).
 *
 * The cells count the tasks of a note of the test's own, tagged so that only
 * they pass. Menu items are picked by the text the vault's locale shows.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/kanban.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { PRELUDE, SETTLE_MS, closeViews, ev, openView, restartView, tr } from '../helpers/view-helper';

const FILE = 'test-int-kanban.md';
/** Six top-level tasks tagged tvkba, the first two also tvkbb. */
const NOTE = Array.from({ length: 6 }, (_, i) => `- [ ] kb ${i + 1} #tvkba${i < 2 ? ' #tvkbb' : ''}`).join('\n') + '\n';

/** The classes of a cell (KanbanView). */
const C = {
    root: 'kanban-view__cell',
    header: 'kanban-view__cell-header',
    name: 'kanban-view__cell-name',
    nameInput: 'kanban-view__cell-name-input',
    count: 'kanban-view__cell-count',
    body: 'kanban-view__cell-body',
    collapsed: 'kanban-view__cell--collapsed',
};

interface Cell {
    name: string | null;
    renaming: boolean;
    count: number;
    collapsed: boolean;
    sorted: boolean;
    filtered: boolean;
    cards: number;
    labels: string[];
}

interface ListDef {
    id: string;
    name: string;
    filterState: { logic: string; filters: unknown[] };
    sortState?: { rules: unknown[] };
    applyViewFilter?: boolean;
    topRight?: { fields: string[] };
}

interface Reading {
    grid: ListDef[][];
    gridCollapsed: Record<string, boolean>;
    filterState?: { logic: string; filters: unknown[] };
    /** The cells drawn, row by row. */
    cells: Cell[];
    /** The columns the grid is laid out in. */
    columns: number;
}

/** Run `body` in the board `name` (with `cell(i)`, the i-th cell drawn), and read it once drawn. */
function op(name: string, body: string, settleMs = SETTLE_MS): Reading {
    return ev<Reading>(`(async () => {
        ${PRELUDE}
        const C = ${JSON.stringify(C)};
        const el = V(${JSON.stringify(name)}).contentEl;
        const cell = (i) => {
            const s = el.querySelectorAll('.' + C.root)[i];
            if (!s) throw new Error('no cell ' + i);
            return s;
        };
        ${body}
        await wait(${settleMs});
        const state = V(${JSON.stringify(name)}).getState();
        const gridEl = el.querySelector('.kanban-view__grid');
        return JSON.stringify({
            grid: state.grid ?? [],
            gridCollapsed: state.gridCollapsed ?? {},
            filterState: state.filterState,
            cells: [...el.querySelectorAll('.' + C.root)].map(s => readSection(C, s)),
            columns: gridEl ? getComputedStyle(gridEl).gridTemplateColumns.split(' ').length : 0,
        });
    })()`);
}

/** Open the ⋯ menu of cell `i` and run its item `title`. */
function more(i: number, title: string): string {
    return `
        headerBtn(C, cell(${i}), 'more-horizontal').click();
        await wait(100);
        menuItem(it => it.titleEl?.textContent === ${JSON.stringify(title)});
    `;
}

/** The titles of the ⋯ menu of cell `i`. */
function moreTitles(name: string, i: number): string[] {
    return ev<string[]>(`(async () => {
        ${PRELUDE}
        const C = ${JSON.stringify(C)};
        const s = V(${JSON.stringify(name)}).contentEl.querySelectorAll('.' + C.root)[${i}];
        headerBtn(C, s, 'more-horizontal').click();
        await wait(100);
        const titles = menuItems().map(it => it.titleEl?.textContent ?? '');
        closeMenus();
        return JSON.stringify(titles);
    })()`);
}

const shape = (r: Reading) => r.grid.map(row => row.length);
const ids = (r: Reading) => r.grid.map(row => row.map(l => l.id));

const TAG_A = { property: 'tag', operator: 'includes', value: ['tvkba'] };
const TAG_B = { property: 'tag', operator: 'includes', value: ['tvkbb'] };
const TOP_LEVEL = { property: 'parent', operator: 'isNotSet' };

/** Give cell `i` the condition tagged `tag`, through its filter menu. */
function filterCell(i: number, tag: string): string {
    return `
        headerBtn(C, cell(${i}), 'filter').click();
        await wait(200);
        buttonText(fFooter(), ${JSON.stringify(tr('filter.addFilter'))}).click();
        await wait(100);
        fSetTags(fRows().length - 1, ${JSON.stringify(tag)});
        await wait(100);
        closeOverlays();
    `;
}

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    const live = ev<boolean>(`(() => typeof app.plugins.plugins['obsidian-task-viewer'].viewEvents?.rollIfChanged === 'function')()`);
    if (!live) throw new Error('The Dev vault runs an older build: run `npm run build` and reload the plugin.');
    expect(await writeIndexedTestFile(FILE, NOTE)).toBe(true);
});

afterAll(async () => {
    ev(`(() => { document.querySelectorAll('.tv-overlay__panel .tv-overlay__close').forEach(b => b.click()); return JSON.stringify(true); })()`);
    await closeViews();
    deleteTestFile(FILE);
    await waitForFileDeindexed(FILE);
});

describe("Kanban's grid", () => {
    let first: string;

    beforeAll(() => {
        openView('kb', 'kanban-view');
    });

    it('opens with one cell, a new list of top-level tasks', () => {
        const r = op('kb', '', 0);
        expect(shape(r)).toEqual([1]);
        expect(r.grid[0][0].name).toBe(tr('pinnedList.newList'));
        expect(r.grid[0][0].filterState).toEqual({ logic: 'and', filters: [TOP_LEVEL] });
        expect(r.cells).toHaveLength(1);
        first = r.grid[0][0].id;
    });

    it("inserts rows above and below and columns left and right from a cell's ⋯ menu", () => {
        let r = op('kb', more(0, tr('menu.insertRowBelow')));
        expect(shape(r)).toEqual([1, 1]);
        expect(r.grid[0][0].id).toBe(first);
        expect(r.cells).toHaveLength(2);

        r = op('kb', more(0, tr('menu.insertRowAbove')));
        expect(shape(r)).toEqual([1, 1, 1]);
        expect(r.grid[1][0].id).toBe(first);

        // The first list's cell is now the second drawn.
        r = op('kb', more(1, tr('menu.insertColumnRight')));
        expect(shape(r)).toEqual([2, 2, 2]);
        expect(r.grid[1][0].id).toBe(first);
        expect(r.cells).toHaveLength(6);
        expect(r.columns).toBe(2);

        r = op('kb', more(2, tr('menu.insertColumnLeft')));
        expect(shape(r)).toEqual([3, 3, 3]);
        expect(r.grid[1][1].id).toBe(first);
        expect(r.cells).toHaveLength(9);
        expect(r.columns).toBe(3);
        // Every new cell is a new list of its own.
        expect(new Set(ids(r).flat()).size).toBe(9);
        expect(r.grid.flat().filter(l => l.id !== first).every(l => l.name === tr('pinnedList.newList'))).toBe(true);
    });

    it('removes rows and columns from the ⋯ menu, and offers neither when only one is left', () => {
        // Row 0 and column 0 go; the first list is left alone at (0, 0) after two more.
        let r = op('kb', more(0, tr('menu.removeRow')));
        expect(shape(r)).toEqual([3, 3]);
        expect(r.grid[0][1].id).toBe(first);
        r = op('kb', more(0, tr('menu.removeColumn')));
        expect(shape(r)).toEqual([2, 2]);
        expect(r.grid[0][0].id).toBe(first);
        expect(r.cells).toHaveLength(4);
        r = op('kb', more(2, tr('menu.removeRow')));
        expect(shape(r)).toEqual([2]);
        r = op('kb', more(1, tr('menu.removeColumn')));
        expect(shape(r)).toEqual([1]);
        expect(r.grid[0][0].id).toBe(first);
        expect(r.cells).toHaveLength(1);

        const titles = moreTitles('kb', 0);
        expect(titles).not.toContain(tr('menu.removeRow'));
        expect(titles).not.toContain(tr('menu.removeColumn'));
        expect(titles).toContain(tr('menu.insertRowBelow'));
    });

    it('renames a cell from its ⋯ menu on Enter, and keeps the old name on Escape', () => {
        let r = op('kb', more(0, tr('menu.rename')), 200);
        expect(r.cells[0].renaming).toBe(true);
        r = op('kb', `
            const input = cell(0).querySelector('.' + C.nameInput);
            input.value = 'Discarded';
            key(input, 'Escape');
        `);
        expect(r.grid[0][0].name).toBe(tr('pinnedList.newList'));
        expect(r.cells[0].name).toBe(tr('pinnedList.newList'));
        expect(r.cells[0].renaming).toBe(false);

        op('kb', more(0, tr('menu.rename')), 200);
        r = op('kb', `
            const input = cell(0).querySelector('.' + C.nameInput);
            input.value = 'Alpha';
            key(input, 'Enter');
        `);
        expect(r.grid[0][0].name).toBe('Alpha');
        expect(r.cells[0].name).toBe('Alpha');
        expect(r.cells[0].renaming).toBe(false);
    });

    it('starts a second rename from the name the first one wrote, and Escape keeps that name', () => {
        op('kb', more(0, tr('menu.rename')), 200);
        let r = op('kb', `
            const input = cell(0).querySelector('.' + C.nameInput);
            input.value = 'Beta';
            key(input, 'Enter');
        `);
        expect(r.grid[0][0].name).toBe('Beta');

        r = op('kb', more(0, tr('menu.rename')) + `
            await wait(200);
            const input = cell(0).querySelector('.' + C.nameInput);
            window.__tvRenameStart = input.value;
            key(input, 'Escape');
        `);
        expect(ev<string>(`JSON.stringify(window.__tvRenameStart)`)).toBe('Beta');
        expect(r.grid[0][0].name).toBe('Beta');
        expect(r.cells[0].name).toBe('Beta');

        // A menu item used right after the rename reads the list as renamed.
        r = op('kb', more(0, tr('menu.applyViewFilter')));
        expect(r.grid[0][0].name).toBe('Beta');
        r = op('kb', more(0, tr('menu.applyViewFilter')));
        expect(r.grid[0][0].name).toBe('Beta');
        expect(r.grid[0][0].applyViewFilter).toBe(false);
    });

    it("filters a cell by the condition added in its filter menu, and sorts it by its sort menu's rule", () => {
        let r = op('kb', filterCell(0, 'tvkba'));
        expect(r.grid[0][0].filterState).toEqual({ logic: 'and', filters: [TOP_LEVEL, TAG_A] });
        expect(r.cells[0].count).toBe(6);
        expect(r.cells[0].cards).toBe(6);
        expect(r.cells[0].filtered).toBe(true);

        r = op('kb', `
            headerBtn(C, cell(0), 'arrow-up-down').click();
            await wait(200);
            buttonText(overlay('sort-popover'), ${JSON.stringify(tr('sort.addSort'))}).click();
            await wait(100);
            closeOverlays();
        `);
        expect(r.grid[0][0].sortState).toEqual({ rules: [{ property: 'due', direction: 'asc' }] });
        expect(r.cells[0].sorted).toBe(true);
    });

    it("edits a cell's display label from its ⋯ menu, which its cards show", () => {
        const r = op('kb', more(0, tr('pinnedList.topRightLabel')) + `
            await wait(200);
            const input = overlay('top-right-config-editor').querySelector('.tv-ctrl__input');
            input.value = 'tags';
            key(input, 'Enter');
            await wait(100);
            closeOverlays();
        `);
        expect(r.grid[0][0].topRight).toEqual({ fields: ['tags'], separator: '' });
        expect(r.cells[0].labels).toHaveLength(6);
        expect(r.cells[0].labels.every(l => l.includes('#tvkba'))).toBe(true);
    });

    it('duplicates a cell to its right, named with " (copy)", and gives the other rows a new list there', () => {
        let r = op('kb', more(0, tr('menu.insertRowBelow')));
        expect(shape(r)).toEqual([1, 1]);
        const below = r.grid[1][0].id;

        r = op('kb', more(0, tr('menu.duplicate')));
        expect(shape(r)).toEqual([2, 2]);
        expect(r.columns).toBe(2);
        const [orig, copy] = r.grid[0];
        expect(orig.id).toBe(first);
        expect(copy.id).not.toBe(first);
        expect(copy.name).toBe('Beta (copy)');
        expect(copy.filterState).toEqual(orig.filterState);
        expect(copy.sortState).toEqual(orig.sortState);
        expect(r.grid[1][0].id).toBe(below);
        expect(r.grid[1][1].name).toBe(tr('pinnedList.newList'));
        expect([first, copy.id, below]).not.toContain(r.grid[1][1].id);
        expect(r.cells.map(c => c.name)).toEqual(['Beta', 'Beta (copy)', tr('pinnedList.newList'), tr('pinnedList.newList')]);
        expect(r.cells[1].count).toBe(6);
    });

    it("changes a copy's filter and sort and leaves the original as it was", () => {
        const before = op('kb', '', 0).grid[0][0];
        let r = op('kb', filterCell(1, 'tvkbb'));
        expect(r.grid[0][1].filterState).toEqual({ logic: 'and', filters: [TOP_LEVEL, TAG_A, TAG_B] });
        expect(r.cells[1].count).toBe(2);
        r = op('kb', `
            headerBtn(C, cell(1), 'arrow-up-down').click();
            await wait(200);
            buttonText(overlay('sort-popover'), ${JSON.stringify(tr('sort.deleteSort'))}).click();
            await wait(100);
            closeOverlays();
        `);
        expect(r.grid[0][1].sortState).toEqual({ rules: [] });
        expect(r.grid[0][0]).toEqual(before);
        expect(r.cells[0].count).toBe(6);
        expect(r.cells[0].sorted).toBe(true);
    });

    it('collapses and expands a cell on a click of its header, and keeps it on restart', () => {
        let r = op('kb', `cell(0).querySelector('.' + C.header).click();`);
        expect(r.gridCollapsed[first]).toBe(true);
        expect(r.cells[0].collapsed).toBe(true);
        expect(r.cells[1].collapsed).toBe(false);

        restartView('kb', 'kb-2');
        r = op('kb-2', '', 0);
        expect(r.gridCollapsed[first]).toBe(true);
        expect(r.cells[0].collapsed).toBe(true);
        expect(r.cells[0].cards).toBe(0);

        r = op('kb-2', `cell(0).querySelector('.' + C.header).click();`);
        // An expanded cell is saved as no entry.
        expect(r.gridCollapsed[first]).toBeFalsy();
        expect(r.cells[0].collapsed).toBe(false);
        expect(r.cells[0].cards).toBe(6);
    });
});

describe("Kanban's view filter", () => {
    it('keeps the filter built in the toolbar, restores it on restart, and narrows only the cells that apply it', () => {
        // The first cell applies the view filter.
        let r = op('kb', more(0, tr('menu.applyViewFilter')));
        expect(r.grid[0][0].applyViewFilter).toBe(true);
        expect(r.cells[0].count).toBe(6);
        const below = r.cells[2].count;
        expect(below).toBeGreaterThanOrEqual(6);

        r = op('kb', `
            const btn = el.querySelector('.view-toolbar__btn--icon:has(svg.lucide-filter)');
            btn.click();
            await wait(200);
            buttonText(fFooter(), ${JSON.stringify(tr('filter.addFilter'))}).click();
            await wait(100);
            fSetTags(0, 'tvkbb');
            await wait(100);
            closeOverlays();
        `);
        expect(r.filterState).toEqual({ logic: 'and', filters: [TAG_B] });
        expect(r.cells[0].count).toBe(2);
        // The cell below does not apply it: it counts every top-level task, as before.
        expect(r.grid[1][0].applyViewFilter).toBe(false);
        expect(r.cells[2].count).toBe(below);
        expect(ev<boolean>(`(() => window.__tvE2E.kb.view.contentEl.querySelector('.view-toolbar__btn--icon:has(svg.lucide-filter)').classList.contains('is-filtered'))()`)).toBe(true);

        restartView('kb', 'kb-3');
        r = op('kb-3', '', 0);
        expect(r.filterState).toEqual({ logic: 'and', filters: [TAG_B] });
        expect(r.grid[0][0].applyViewFilter).toBe(true);
        expect(r.cells[0].count).toBe(2);

        r = op('kb-3', more(0, tr('menu.applyViewFilter')));
        expect(r.grid[0][0].applyViewFilter).toBe(false);
        expect(r.cells[0].count).toBe(6);
    });
});
