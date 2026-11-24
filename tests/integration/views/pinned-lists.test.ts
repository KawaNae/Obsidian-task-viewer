/**
 * The pinned lists of Timeline's and Calendar's sidebar, in the running Dev
 * vault, driven as the user clicks them: the add button's Add List, each list's
 * header (collapse), its sort, filter and ⋯ buttons, the menus and popovers
 * they open, and Show more. What a list shows is read from its DOM, what the
 * view keeps from `getState` (`sidebar`, `sidebarCollapsed`).
 *
 * The lists count the tasks of a note of the test's own, tagged so that only
 * they pass. Menu items are picked by the text the vault's locale shows.
 * The page size is set for the test and put back after it.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault open, with the current build
 *     loaded (the preflight builds it into the vault)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/pinned-lists.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTeardown } from '../helpers/teardown';
import { deleteTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import {
    PRELUDE, SETTLE_MS, closeViews, ev, openView, overrideSettings, readSettings, restartView, tr, visualDay,
} from '../helpers/view-helper';
import { waitForFileDeindexed } from '../helpers/waits';

const FILE = 'test-int-pinned-lists.md';
/** The note of the lists that count from today: its tasks start on days around it. */
const DAY_FILE = 'test-int-pinned-lists-day.md';
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

/** The classes of a list frame of the sidebar (SidebarFrames). */
const C = {
    root: 'pinned-list',
    header: 'sidebar-frame__header',
    name: 'sidebar-frame__name',
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
            lists: state.sidebar ?? [],
            collapsed: state.sidebarCollapsed ?? {},
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

interface PanelReading {
    /** The first class of each child of the sidebar's panel, of its body, and of the frames' element. */
    panel: string[];
    body: string[];
    frames: string[];
    empty: string | null;
    /** The left edge of the frames' content, where each frame's row starts. */
    framesLeft: number;
    framesBottom: number;
    lastFrame: { id: string | null; bottom: number } | null;
    button: { label: string; left: number; top: number };
}

/** What the sidebar's panel of the view `name` holds, in order, and where the add button stands. */
function panel(name: string): PanelReading {
    return ev<PanelReading>(`(() => {
        ${PRELUDE}
        const el = V(${JSON.stringify(name)}).contentEl;
        const first = (e) => [...e.children].map(c => c.classList.contains('tv-icon-btn') ? [...c.classList].find(k => k !== 'tv-icon-btn') : c.classList[0]);
        const frames = el.querySelector('.tv-sidebar__frames');
        const button = el.querySelector('.tv-sidebar__panel-add-btn');
        const last = frames.lastElementChild;
        return JSON.stringify({
            panel: first(el.querySelector('.tv-sidebar__panel')),
            body: first(el.querySelector('.tv-sidebar__panel-body')),
            frames: first(frames),
            empty: frames.querySelector(':scope > .tv-sidebar__frames--empty')?.textContent ?? null,
            framesLeft: frames.getBoundingClientRect().left + parseFloat(getComputedStyle(frames).paddingLeft),
            framesBottom: frames.getBoundingClientRect().bottom,
            lastFrame: last && !last.classList.contains('tv-sidebar__frames--empty')
                ? { id: last.dataset.listId ?? last.dataset.frameId ?? null, bottom: last.getBoundingClientRect().bottom } : null,
            button: { label: button.textContent, left: button.getBoundingClientRect().left, top: button.getBoundingClientRect().top },
        });
    })()`);
}

/** The keys of the state the view `name` saves (`getState`). */
function stateKeys(name: string): string[] {
    return ev<string[]>(`(() => {
        ${PRELUDE}
        return JSON.stringify(Object.keys(V(${JSON.stringify(name)}).getState()));
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

const teardown = createTeardown();

beforeAll(async () => {
    const held = overrideSettings({ pinnedListPageSize: PAGE });
    teardown.add('put the settings back', () => held.restore());
    teardown.add('delete the note', async () => { deleteTestFile(FILE); await waitForFileDeindexed(FILE); });
    teardown.add('delete the note of days', async () => { deleteTestFile(DAY_FILE); await waitForFileDeindexed(DAY_FILE); });
    teardown.add('close the views', closeViews);
    teardown.add('close the overlays', () => ev(`(() => { document.querySelectorAll('.tv-overlay__panel .tv-overlay__close').forEach(b => b.click()); return JSON.stringify(true); })()`));
    await writeIndexedTestFile(FILE, note());
});

afterAll(() => teardown.run());

describe.each([
    ['Timeline', 'timeline-view', 'pl-tl'],
    ['Calendar', 'calendar-view', 'pl-cal'],
])("%s's pinned lists", (_label, type, name) => {
    let alpha: string;

    beforeAll(() => {
        openView(name, type, { showSidebar: true, sidebar: [] });
    });

    it('says that nothing is added yet while it holds nothing, with no header row above, and its add button after that, at the frames\' left', () => {
        const r = panel(name);
        expect(r.empty).toBe(tr('sidebar.empty'));
        expect(r.panel).toEqual(['tv-sidebar__panel-body']);
        expect(r.body).toEqual(['tv-sidebar__frames', 'tv-sidebar__panel-add-btn']);
        expect(r.frames).toEqual(['tv-sidebar__frames--empty']);
        expect(r.button.label).toBe(tr('sidebar.add'));
        expect(r.button.top).toBeGreaterThanOrEqual(r.framesBottom);
        expect(r.button.left).toBeCloseTo(r.framesLeft, 0);
    });

    it('offers a list and a section in the add button\'s menu', () => {
        const titles = ev<string[]>(`(async () => {
            ${PRELUDE}
            V(${JSON.stringify(name)}).contentEl.querySelector('.tv-sidebar__panel-add-btn').click();
            await wait(100);
            const titles = menuItems().map(it => it.titleEl?.textContent ?? '');
            closeMenus();
            return JSON.stringify(titles);
        })()`);
        expect(titles).toEqual([tr('pinnedList.addList'), tr('sidebar.addSection')]);
    });

    it('adds a list from the add button\'s menu and starts editing its name, which Enter keeps', () => {
        let r = op(name, `
            el.querySelector('.tv-sidebar__panel-add-btn').click();
            await wait(100);
            menuItem(it => it.titleEl?.textContent === ${JSON.stringify(tr('pinnedList.addList'))});
        `, 300);
        expect(r.lists).toHaveLength(1);
        expect(r.lists[0].name).toBe(tr('pinnedList.newList'));
        expect(r.lists[0].filterState).toEqual({ logic: 'and', filters: [TOP_LEVEL] });
        expect(r.lists[0].applyViewFilter).toBe(false);
        expect(r.sections).toHaveLength(1);
        expect(r.sections[0].renaming).toBe(true);
        alpha = r.lists[0].id;
        expect(r.sections[0].id).toBe(alpha);

        // The new list is the last frame, right above the button that added it.
        const p = panel(name);
        expect(p.body).toEqual(['tv-sidebar__frames', 'tv-sidebar__panel-add-btn']);
        expect(p.frames).toEqual([C.root]);
        expect(p.lastFrame!.id).toBe(alpha);
        expect(p.button.top - p.lastFrame!.bottom).toBeGreaterThanOrEqual(0);
        expect(p.button.top - p.lastFrame!.bottom).toBeLessThan(30);

        r = op(name, `
            const input = sec(0).querySelector('.' + C.nameInput);
            input.value = 'Alpha';
            key(input, 'Enter');
        `);
        expect(r.lists[0].name).toBe('Alpha');
        expect(r.sections[0].renaming).toBe(false);
        expect(r.sections[0].name).toBe('Alpha');
    });

    it('renames a list from its ⋯ menu on Enter, with no blur coming to it, and keeps the old name on Escape', () => {
        let r = op(name, more(0, tr('menu.rename')), 200);
        expect(r.sections[0].renaming).toBe(true);
        r = op(name, `
            const input = sec(0).querySelector('.' + C.nameInput);
            // As in a window that is not in front: no blur reaches the field.
            input.addEventListener('blur', e => e.stopImmediatePropagation(), { capture: true });
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

    it('leaves the sidebar open, its state kept, on the Escape that keeps a list\'s old name', () => {
        const r = ev<Record<string, unknown>>(`(async () => {
            ${PRELUDE}
            const C = ${JSON.stringify(C)};
            const el = V(${JSON.stringify(name)}).contentEl;
            const sidebar = () => ({
                shown: !el.querySelector('.tv-sidebar__panel').classList.contains('tv-sidebar__panel--hidden'),
                saved: V(${JSON.stringify(name)}).getState().showSidebar ?? true,
            });
            if (!sidebar().shown) {
                el.querySelector('.sidebar-toggle-button-icon').click();
                await wait(400);
            }
            const before = sidebar();
            const sec = el.querySelector('.' + C.root);
            headerBtn(C, sec, 'more-horizontal').click();
            await wait(100);
            menuItem(it => it.titleEl?.textContent === ${JSON.stringify(tr('menu.rename'))});
            await wait(200);
            const input = el.querySelector('.' + C.root + ' .' + C.nameInput);
            input.value = 'Discarded';
            key(input, 'Escape');
            await wait(${SETTLE_MS});
            return JSON.stringify({ before, name: readSection(C, el.querySelector('.' + C.root)).name, after: sidebar() });
        })()`);
        expect(r).toEqual({
            before: { shown: true, saved: true },
            name: 'Alpha',
            after: { shown: true, saved: true },
        });
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
        await writeIndexedTestFile(FILE, note(['- [ ] pl 13 #tvpla']));
        let r = op(name, '');
        expect(r.sections[0].count).toBe(13);
        await writeIndexedTestFile(FILE, note());
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

    it('adds a list right above and right below a list from the submenus of its ⋯ menu, its name edited, the other lists and folds kept', () => {
        const before = op(name, '', 0);
        const [first, second] = before.lists.map(l => l.id);
        const addList = (i: number, where: string) => `
            headerBtn(C, sec(${i}), 'more-horizontal').click();
            await wait(100);
            menuItem(it => it.titleEl?.textContent === ${JSON.stringify(tr('pinnedList.addList'))}, {
                within: it => it.titleEl?.textContent === ${JSON.stringify(where)},
            });
        `;
        const keepName = (i: number) => `key(sec(${i}).querySelector('.' + C.nameInput), 'Escape');`;

        let r = op(name, addList(1, tr('menu.addAbove')), 300);
        const above = r.lists[1].id;
        expect(r.lists.map(l => l.id)).toEqual([first, above, second]);
        expect(r.sections.map(s => s.id)).toEqual([first, above, second]);
        expect(r.sections[1].renaming).toBe(true);
        r = op(name, keepName(1));
        expect(r.lists[1].name).toBe(tr('pinnedList.newList'));

        r = op(name, addList(0, tr('menu.addBelow')), 300);
        const below = r.lists[1].id;
        expect(r.lists.map(l => l.id)).toEqual([first, below, above, second]);
        expect(r.sections[1].renaming).toBe(true);
        r = op(name, keepName(1));
        expect(r.lists[0]).toEqual(before.lists[0]);
        expect(r.lists[3]).toEqual(before.lists[1]);
        expect(r.collapsed).toEqual(before.collapsed);

        r = op(name, more(2, tr('menu.remove')));
        r = op(name, more(1, tr('menu.remove')));
        expect(r.lists).toEqual(before.lists);
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

describe.each([
    ['Timeline', 'timeline-view', 'pl-tl-old', 'timeline'],
    ['Calendar', 'calendar-view', 'pl-cal-old', 'calendar'],
])('%s opened with a state saved under the older keys', (_label, type, name, prefix) => {
    it('draws its lists, collapsed as they were saved, and saves them under the new keys', () => {
        const a = { id: 'old-a', name: 'Old A', filterState: { logic: 'and', filters: [TOP_LEVEL, TAG_A] } };
        const b = { id: 'old-b', name: 'Old B', filterState: { logic: 'and', filters: [TOP_LEVEL, TAG_B] } };
        openView(name, type, {
            showSidebar: true,
            pinnedLists: [a, b],
            // The older form of an id, the view's name before it.
            pinnedListCollapsed: { [`${prefix}::old-a`]: true },
        });

        const r = op(name, '');
        expect(r.sections.map(s => s.name)).toEqual(['Old A', 'Old B']);
        expect(r.sections.map(s => s.collapsed)).toEqual([true, false]);
        expect(r.sections[0].cards).toBe(0);
        expect(r.sections[1].count).toBe(4);
        expect(r.sections[1].cards).toBe(4);

        expect(r.lists.map(l => l.id)).toEqual(['old-a', 'old-b']);
        expect(r.collapsed).toEqual({ 'old-a': true });
        const keys = stateKeys(name);
        expect(keys).toEqual(expect.arrayContaining(['sidebar', 'sidebarCollapsed']));
        expect(keys).not.toContain('pinnedLists');
        expect(keys).not.toContain('pinnedListCollapsed');
    });
});

/**
 * The view hands the panel saved settings and a new day, and the panel
 * draws its lists again. Each is told here through `ViewEvents`, as the
 * plugin tells the views, with the setting changed in memory alone: a save
 * through the plugin also has the index tell its listeners, and the panel
 * draws on that too, so the save would not show whether the view's own
 * event reaches the panel. Nothing else changes between the two readings.
 */
describe.each([
    ['Timeline', 'timeline-view', 'pl-tl-ev'],
    ['Calendar', 'calendar-view', 'pl-cal-ev'],
])("%s's pinned lists, told of saved settings and a new day", (_label, type, name) => {
    /** Read the lists' counts and cards, run `body` in the plugin (`P`), and read them again once drawn; `undo` runs after, whatever happens. */
    function around(body: string, undo: string): { before: Section[]; after: Section[] } {
        return ev(`(async () => {
            ${PRELUDE}
            const C = ${JSON.stringify(C)};
            const el = V(${JSON.stringify(name)}).contentEl;
            const sections = () => [...el.querySelectorAll('.' + C.root)].map(s => readSection(C, s));
            await wait(${SETTLE_MS});
            const before = sections();
            try {
                ${body}
                await wait(${SETTLE_MS});
                return JSON.stringify({ before, after: sections() });
            } finally {
                ${undo}
                await wait(${SETTLE_MS});
            }
        })()`);
    }

    it('shows a page of the size the saved settings give', () => {
        const list = { id: 'ev-page', name: 'Page', filterState: { logic: 'and', filters: [TOP_LEVEL, TAG_A] }, applyViewFilter: false };
        openView(name, type, { showSidebar: true, sidebar: [list] });

        const r = around(`
            P.settings.pinnedListPageSize = 3;
            P.viewEvents.settingsChanged();
        `, `
            P.settings.pinnedListPageSize = ${PAGE};
            P.viewEvents.settingsChanged();
        `);
        expect(r.before[0].cards).toBe(PAGE);
        expect(r.after[0].count).toBe(12);
        expect(r.after[0].cards).toBe(3);
        expect(r.after[0].more).toBe(tr('pinnedList.showMore', { remaining: 12 - 3 }));
    });

    /**
     * The visual day is moved by the start hour, as viewed-date's day roll
     * does: set in memory to an hour still ahead (or to 0 before the start
     * hour), today becomes another day, and `ViewEvents.rollIfChanged`, what
     * the minute clock calls, tells the views. The start hour is put back in
     * the same call. The hour ahead is two on, so the test may run past the
     * end of this one; skipped from 22:00, when two on is no hour of the day.
     */
    const now = new Date();
    const h = now.getHours();

    it.skipIf(h >= 22)('counts again the tasks that start today when the day rolls', async () => {
        const startHour = readSettings(['startHour']).startHour as number;
        const today = visualDay(startHour, now);
        const rolledHour = h < startHour ? 0 : h + 2;
        const rolledToday = visualDay(rolledHour, now);
        expect(rolledToday).not.toBe(today);

        await writeIndexedTestFile(DAY_FILE, [
            `- [ ] pld today #tvpld @${today}`,
            `- [ ] pld rolled 1 #tvpld @${rolledToday}`,
            `- [ ] pld rolled 2 #tvpld @${rolledToday}`,
            '',
        ].join('\n'));
        const list = {
            id: 'ev-today',
            name: 'Today',
            filterState: { logic: 'and', filters: [
                { property: 'tag', operator: 'includes', value: ['tvpld'] },
                { property: 'startDate', operator: 'equals', value: { preset: 'today' } },
            ] },
            applyViewFilter: false,
        };
        openView(name, type, { showSidebar: true, sidebar: [list] });

        const r = around(`
            P.settings.startHour = ${rolledHour};
            if (!P.viewEvents.rollIfChanged()) throw new Error('the day did not roll');
        `, `
            P.settings.startHour = ${startHour};
            P.viewEvents.rollIfChanged();
        `);
        expect(r.before[0].count).toBe(1);
        expect(r.after[0].count).toBe(2);
        expect(r.after[0].cards).toBe(2);
    });
});
