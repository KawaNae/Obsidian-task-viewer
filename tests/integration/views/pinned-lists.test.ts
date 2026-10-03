/**
 * The pinned lists of Timeline's and Calendar's sidebar, in the running Dev
 * vault, driven as the user clicks them: the Add List button, each list's
 * header (collapse), its sort, filter and ⋯ buttons, the menus and popovers
 * they open, and Show more. What a list shows is read from its DOM, what the
 * view keeps from `getState` (`pinnedLists`, `pinnedListCollapsed`).
 *
 * The lists count the tasks of a note of the test's own, tagged so that only
 * they pass. Menu items are picked by the text the vault's locale shows.
 * The page size is set for the test and put back after it.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/pinned-lists.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import {
    PRELUDE, SETTLE_MS, closeViews, ev, openView, readSettings, restartView, saveSettings, tr,
} from '../helpers/view-helper';

const FILE = 'test-int-pinned-lists.md';
/** Twelve top-level tasks tagged tvpla, the first four also tvplb; one child, which a list leaves out. */
function note(extra: string[] = []): string {
    const rows: string[] = [];
    for (let i = 1; i <= 12; i++) {
        rows.push(`- [ ] pl ${String(i).padStart(2, '0')} #tvpla${i <= 4 ? ' #tvplb' : ''}`);
        if (i === 1) rows.push('    - [ ] pl child #tvpla');
    }
    return [...rows, ...extra, ''].join('\n');
}

const PAGE = 5;
let originalPage: unknown;

/** The classes of a pinned list (PinnedListRenderer). */
const C = {
    root: 'pinned-list',
    header: 'pinned-list__header',
    name: 'pinned-list__name',
    nameInput: 'pinned-list__name-input',
    count: 'pinned-list__count',
    body: 'pinned-list__body',
    collapsed: 'pinned-list--collapsed',
};

interface Section {
    id: string | null;
    name: string | null;
    renaming: boolean;
    count: number;
    collapsed: boolean;
    sorted: boolean;
    filtered: boolean;
    cards: number;
    labels: string[];
    more: string | null;
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
    lists: ListDef[];
    collapsed: Record<string, boolean>;
    sections: Section[];
}

/** Run `body` in the view `name` (with `sec(i)`, the i-th list's element), and read its lists once drawn. */
function op(name: string, body: string, settleMs = SETTLE_MS): Reading {
    return ev<Reading>(`(async () => {
        ${PRELUDE}
        const C = ${JSON.stringify(C)};
        const el = V(${JSON.stringify(name)}).contentEl;
        const sec = (i) => {
            const s = el.querySelectorAll('.' + C.root)[i];
            if (!s) throw new Error('no list ' + i);
            return s;
        };
        ${body}
        await wait(${settleMs});
        const state = V(${JSON.stringify(name)}).getState();
        return JSON.stringify({
            lists: state.pinnedLists ?? [],
            collapsed: state.pinnedListCollapsed ?? {},
            sections: [...el.querySelectorAll('.' + C.root)].map(s => readSection(C, s)),
        });
    })()`);
}

/** Open the ⋯ menu of list `i` and run its item `title`. */
function more(i: number, title: string): string {
    return `
        headerBtn(C, sec(${i}), 'more-horizontal').click();
        await wait(100);
        menuItem(it => it.titleEl?.textContent === ${JSON.stringify(title)});
    `;
}

/** The titles of the ⋯ menu of list `i`. */
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

/** Whether `collapsed` (prefixed keys) marks the list `id` collapsed. */
function isCollapsed(collapsed: Record<string, boolean>, id: string): boolean | undefined {
    const entry = Object.entries(collapsed).find(([k]) => k === id || k.endsWith(`::${id}`));
    return entry?.[1];
}

const TAG_A = { property: 'tag', operator: 'includes', value: ['tvpla'] };
const TAG_B = { property: 'tag', operator: 'includes', value: ['tvplb'] };
const TOP_LEVEL = { property: 'parent', operator: 'isNotSet' };

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    const live = ev<boolean>(`(() => typeof app.plugins.plugins['obsidian-task-viewer'].viewEvents?.rollIfChanged === 'function')()`);
    if (!live) throw new Error('The Dev vault runs an older build: run `npm run build` and reload the plugin.');
    originalPage = readSettings(['pinnedListPageSize']).pinnedListPageSize;
    saveSettings({ pinnedListPageSize: PAGE });
    expect(await writeIndexedTestFile(FILE, note())).toBe(true);
});

afterAll(async () => {
    ev(`(() => { document.querySelectorAll('.tv-overlay__panel .tv-overlay__close').forEach(b => b.click()); return JSON.stringify(true); })()`);
    await closeViews();
    saveSettings({ pinnedListPageSize: originalPage });
    deleteTestFile(FILE);
    await waitForFileDeindexed(FILE);
});

describe.each([
    ['Timeline', 'timeline-view', 'pl-tl'],
    ['Calendar', 'calendar-view', 'pl-cal'],
])("%s's pinned lists", (_label, type, name) => {
    let alpha: string;

    beforeAll(() => {
        openView(name, type, { showSidebar: true, pinnedLists: [] });
    });

    it('adds a list with the Add List button and starts editing its name, which Enter keeps', () => {
        let r = op(name, `el.querySelector('.tv-sidebar__panel-add-btn').click();`, 300);
        expect(r.lists).toHaveLength(1);
        expect(r.lists[0].name).toBe(tr('pinnedList.newList'));
        expect(r.lists[0].filterState).toEqual({ logic: 'and', filters: [TOP_LEVEL] });
        expect(r.lists[0].applyViewFilter).toBe(false);
        expect(r.sections).toHaveLength(1);
        expect(r.sections[0].renaming).toBe(true);
        alpha = r.lists[0].id;
        expect(r.sections[0].id).toBe(alpha);

        r = op(name, `
            const input = sec(0).querySelector('.' + C.nameInput);
            input.value = 'Alpha';
            key(input, 'Enter');
        `);
        expect(r.lists[0].name).toBe('Alpha');
        expect(r.sections[0].renaming).toBe(false);
        expect(r.sections[0].name).toBe('Alpha');
    });

    it('renames a list from its ⋯ menu on Enter, and keeps the old name on Escape', () => {
        let r = op(name, more(0, tr('menu.rename')), 200);
        expect(r.sections[0].renaming).toBe(true);
        r = op(name, `
            const input = sec(0).querySelector('.' + C.nameInput);
            input.value = 'Renamed';
            key(input, 'Enter');
        `);
        expect(r.lists[0].name).toBe('Renamed');
        expect(r.sections[0].name).toBe('Renamed');

        op(name, more(0, tr('menu.rename')), 200);
        r = op(name, `
            const input = sec(0).querySelector('.' + C.nameInput);
            input.value = 'Discarded';
            key(input, 'Escape');
        `);
        expect(r.lists[0].name).toBe('Renamed');
        expect(r.sections[0].name).toBe('Renamed');
        expect(r.sections[0].renaming).toBe(false);

        r = op(name, more(0, tr('menu.rename')) + `
            await wait(100);
            const input = sec(0).querySelector('.' + C.nameInput);
            input.value = 'Alpha';
            key(input, 'Enter');
        `);
        expect(r.lists[0].name).toBe('Alpha');
    });

    it('adds, duplicates and removes conditions and groups in its filter menu, and counts what passes', () => {
        // A condition: tagged tvpla.
        let r = op(name, `
            headerBtn(C, sec(0), 'filter').click();
            await wait(200);
            buttonText(fFooter(), ${JSON.stringify(tr('filter.addFilter'))}).click();
            await wait(100);
            fSetTags(1, 'tvpla');
        `);
        expect(r.lists[0].filterState).toEqual({ logic: 'and', filters: [TOP_LEVEL, TAG_A] });
        expect(r.sections[0].count).toBe(12);
        expect(r.sections[0].filtered).toBe(true);

        // A group: tagged tvplb.
        r = op(name, `
            buttonText(fFooter(), ${JSON.stringify(tr('filter.addFilterGroup'))}).click();
            await wait(100);
            fSetTags(2, 'tvplb');
        `);
        expect(r.lists[0].filterState).toEqual({
            logic: 'and',
            filters: [TOP_LEVEL, TAG_A, { logic: 'and', filters: [TAG_B] }],
        });
        expect(r.sections[0].count).toBe(4);

        // Duplicating the condition puts its copy right after it.
        r = op(name, `await fRowMenu(1, ${JSON.stringify(tr('filter.duplicate'))});`);
        expect(r.lists[0].filterState.filters).toEqual([TOP_LEVEL, TAG_A, TAG_A, { logic: 'and', filters: [TAG_B] }]);
        expect(r.sections[0].count).toBe(4);

        // Removing the copy, then the group, leaves the one condition.
        r = op(name, `await fRowMenu(2, ${JSON.stringify(tr('filter.remove'))});`);
        expect(r.lists[0].filterState.filters).toEqual([TOP_LEVEL, TAG_A, { logic: 'and', filters: [TAG_B] }]);
        r = op(name, `
            await fGroupMenu(0, ${JSON.stringify(tr('filter.removeGroup'))});
            await wait(100);
            closeOverlays();
        `);
        expect(r.lists[0].filterState).toEqual({ logic: 'and', filters: [TOP_LEVEL, TAG_A] });
        expect(r.sections[0].count).toBe(12);
    });

    it('sorts a list by the rule added in its sort menu, and marks its sort button', () => {
        expect(op(name, '', 0).sections[0].sorted).toBe(false);
        const r = op(name, `
            headerBtn(C, sec(0), 'arrow-up-down').click();
            await wait(200);
            buttonText(overlay('sort-popover'), ${JSON.stringify(tr('sort.addSort'))}).click();
            await wait(100);
            closeOverlays();
        `);
        expect(r.lists[0].sortState).toEqual({ rules: [{ property: 'due', direction: 'asc' }] });
        expect(r.sections[0].sorted).toBe(true);
    });

    it('shows a page of cards, and the next page on each Show more', () => {
        let r = op(name, '', 0);
        expect(r.sections[0].cards).toBe(PAGE);
        expect(r.sections[0].more).toBe(tr('pinnedList.showMore', { remaining: 12 - PAGE }));
        r = op(name, `sec(0).querySelector('.task-paging__show-more').click();`);
        expect(r.sections[0].cards).toBe(2 * PAGE);
        expect(r.sections[0].more).toBe(tr('pinnedList.showMore', { remaining: 12 - 2 * PAGE }));
        r = op(name, `sec(0).querySelector('.task-paging__show-more').click();`);
        expect(r.sections[0].cards).toBe(12);
        expect(r.sections[0].more).toBeNull();
    });

    it('counts again when a task of its note is added or taken away', async () => {
        expect(await writeIndexedTestFile(FILE, note(['- [ ] pl 13 #tvpla']))).toBe(true);
        let r = op(name, '');
        expect(r.sections[0].count).toBe(13);
        expect(await writeIndexedTestFile(FILE, note())).toBe(true);
        r = op(name, '');
        expect(r.sections[0].count).toBe(12);
    });

    it('edits the display label of a list from its ⋯ menu, which its cards show', () => {
        const r = op(name, more(0, tr('pinnedList.topRightLabel')) + `
            await wait(200);
            const input = overlay('top-right-config-editor').querySelector('.tv-ctrl__input');
            input.value = 'tags';
            key(input, 'Enter');
            await wait(100);
            closeOverlays();
        `);
        expect(r.lists[0].topRight).toEqual({ fields: ['tags'], separator: '' });
        expect(r.sections[0].labels.length).toBeGreaterThan(0);
        expect(r.sections[0].labels.every(l => l.includes('#tvpla'))).toBe(true);
    });

    it('duplicates a list right after it, named with " (copy)" and a new id', () => {
        const r = op(name, more(0, tr('menu.duplicate')));
        expect(r.lists).toHaveLength(2);
        expect(r.lists[0].id).toBe(alpha);
        expect(r.lists[1].id).not.toBe(alpha);
        expect(r.lists[1].name).toBe('Alpha (copy)');
        expect(r.lists[1].filterState).toEqual(r.lists[0].filterState);
        expect(r.lists[1].sortState).toEqual(r.lists[0].sortState);
        expect(r.sections.map(s => s.name)).toEqual(['Alpha', 'Alpha (copy)']);
        expect(r.sections[1].id).toBe(r.lists[1].id);
        expect(r.sections[1].count).toBe(12);
    });

    it("changes a copy's filter and sort and leaves the original as it was", () => {
        const before = op(name, '', 0).lists[0];
        let r = op(name, `
            headerBtn(C, sec(1), 'filter').click();
            await wait(200);
            fSetTags(1, 'tvplb');
            await wait(100);
            closeOverlays();
        `);
        expect(r.lists[1].filterState).toEqual({ logic: 'and', filters: [TOP_LEVEL, { ...TAG_A, value: ['tvpla', 'tvplb'] }] });
        r = op(name, `
            headerBtn(C, sec(1), 'arrow-up-down').click();
            await wait(200);
            buttonText(overlay('sort-popover'), ${JSON.stringify(tr('sort.deleteSort'))}).click();
            await wait(100);
            closeOverlays();
        `);
        expect(r.lists[1].sortState).toEqual({ rules: [] });
        expect(r.sections[1].sorted).toBe(false);
        expect(r.lists[0]).toEqual(before);
        expect(r.sections[0].count).toBe(12);
        expect(r.sections[0].sorted).toBe(true);
    });

    it('moves a list up and down from its ⋯ menu, which offers only the moves there are', () => {
        expect(moreTitles(name, 0)).not.toContain(tr('menu.moveUp'));
        expect(moreTitles(name, 0)).toContain(tr('menu.moveDown'));
        expect(moreTitles(name, 1)).toContain(tr('menu.moveUp'));
        expect(moreTitles(name, 1)).not.toContain(tr('menu.moveDown'));
        const copy = op(name, '', 0).lists[1].id;

        let r = op(name, more(1, tr('menu.moveUp')));
        expect(r.lists.map(l => l.id)).toEqual([copy, alpha]);
        expect(r.sections.map(s => s.id)).toEqual([copy, alpha]);
        r = op(name, more(0, tr('menu.moveDown')));
        expect(r.lists.map(l => l.id)).toEqual([alpha, copy]);
        expect(r.sections.map(s => s.id)).toEqual([alpha, copy]);
    });

    it("narrows a list by the view's filter only while its Apply view filter is on", () => {
        const viewFilter = { logic: 'and', filters: [TAG_B] };
        let r = op(name, `V(${JSON.stringify(name)}).store.update({ filterState: ${JSON.stringify(viewFilter)} });`);
        expect(r.lists[0].applyViewFilter).toBe(false);
        expect(r.sections[0].count).toBe(12);

        r = op(name, more(0, tr('menu.applyViewFilter')));
        expect(r.lists[0].applyViewFilter).toBe(true);
        expect(r.sections[0].count).toBe(4);
        expect(r.lists[1].applyViewFilter).toBe(false);

        r = op(name, more(0, tr('menu.applyViewFilter')));
        expect(r.lists[0].applyViewFilter).toBe(false);
        expect(r.sections[0].count).toBe(12);
        op(name, `V(${JSON.stringify(name)}).store.update({ filterState: undefined });`);
    });

    it('collapses and expands on a click of its header, and keeps it on restart', () => {
        let r = op(name, `sec(0).querySelector('.' + C.header).click();`);
        expect(isCollapsed(r.collapsed, alpha)).toBe(true);
        expect(r.sections[0].collapsed).toBe(true);
        expect(r.sections[1].collapsed).toBe(false);

        const restarted = `${name}-2`;
        restartView(name, restarted);
        r = op(restarted, '', 0);
        expect(isCollapsed(r.collapsed, alpha)).toBe(true);
        expect(r.sections[0].collapsed).toBe(true);
        expect(r.sections[0].cards).toBe(0);
        expect(r.sections.map(s => s.name)).toEqual(['Alpha', 'Alpha (copy)']);

        r = op(restarted, `sec(0).querySelector('.' + C.header).click();`);
        // An expanded list is saved as no entry.
        expect(isCollapsed(r.collapsed, alpha)).toBeFalsy();
        expect(r.sections[0].collapsed).toBe(false);
        expect(r.sections[0].cards).toBe(PAGE);
    });

    it('removes a list from its ⋯ menu', () => {
        const r = op(name, more(1, tr('menu.remove')));
        expect(r.lists.map(l => l.id)).toEqual([alpha]);
        expect(r.sections.map(s => s.id)).toEqual([alpha]);
    });
});
