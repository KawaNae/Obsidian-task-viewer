import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Menu } from 'obsidian';
import { t } from '../../../src/i18n';
import { insertFrame, listFrame, type PinnedListDefinition, type SidebarFrame } from '../../../src/types';
import { SidebarFrames, stackInOrder, type SidebarFramesDeps, type SidebarFramesState } from '../../../src/views/sidebar/SidebarFrames';
import type { ListPlacement } from '../../../src/views/sharedUI/TaskListSections';
import type { MarkdownFramePlacement } from '../../../src/views/sidebar/MarkdownFrameSections';
import { FakeEl } from '../helpers/fakeDom';

/**
 * The stack of a sidebar that holds a markdown frame among its lists: the
 * panel adds below, moves, removes and collapses a frame by its id, whatever
 * its kind, and writes a markdown frame's link. The drawing of the lists and
 * of the markdown frames is stood in for, and hands the test the placements
 * the panel is.
 */
const drawn = vi.hoisted(() => ({
    placement: null as unknown,
    markdownPlacement: null as unknown,
    /** The slots the markdown frames were asked to open the dialog that adds one for, in order. */
    sectionsAdded: [] as unknown[],
    /** The lists the list frames were told to have their names edited when next drawn. */
    renames: [] as string[],
    /** What the markdown frames were had take, in order: the frames' ids and the folds. */
    synced: [] as { ids: string[]; collapsed: Record<string, boolean> }[],
    /** How many draws were requested of the window. */
    requested: 0,
}));

vi.mock('../../../src/views/sharedUI/TaskListSections', () => ({
    newList: () => ({ id: 'list-new', name: 'New List', filterState: { filters: [], logic: 'and' }, applyViewFilter: false }),
    TaskListSections: class {
        constructor(_deps: unknown, placement: unknown) { drawn.placement = placement; }
        scheduleRename(id: string) { drawn.renames.push(id); }
        keepPagesOf() {}
        drawList() { return {}; }
        close() {}
    },
}));

vi.mock('../../../src/views/sidebar/MarkdownFrameSections', () => ({
    MarkdownFrameSections: class {
        constructor(_deps: unknown, placement: unknown) { drawn.markdownPlacement = placement; }
        open() {}
        close() {}
        sync(frames: SidebarFrame[], collapsed: Record<string, boolean>) {
            drawn.synced.push({ ids: frames.filter(f => f.kind === 'markdown').map(f => f.id), collapsed });
        }
        holds() { return false; }
        elementOf() { return {}; }
        paint() {}
        placed() {}
        add(slot: unknown) { drawn.sectionsAdded.push(slot); }
    },
}));

vi.mock('../../../src/views/sharedUI/CardReconciler', () => ({
    CardReconciler: class {
        detach() {}
        forEachStale() {}
    },
}));

vi.mock('../../../src/utils/HostWindow', () => ({
    HostFrameScheduler: class {
        request() { return ++drawn.requested; }
        cancel() {}
    },
}));

const list = (id: string): PinnedListDefinition =>
    ({ id, name: `List ${id}`, filterState: { filters: [], logic: 'and' }, applyViewFilter: false });
const A = listFrame(list('a'));
const B = listFrame(list('b'));
const MEMO: SidebarFrame = { kind: 'markdown', id: 'm', link: 'Folder/Note#Memo' };

/**
 * A menu that records its items by title, an item of a submenu as
 * `parent › title`: `choose` runs the item of a title, then or later.
 * `closed` counts the closes of the menu.
 */
function menuOf() {
    const items = new Map<string, () => void>();
    let closed = 0;
    const menuUnder = (prefix: string) => {
        const menu = {
            addSeparator: () => menu,
            close: () => { closed++; },
            addItem(build: (item: unknown) => void) {
                let named = '';
                const item = {
                    setTitle: (text: string) => { named = prefix + text; return item; },
                    setIcon: () => item,
                    onClick: (run: () => void) => { items.set(named, run); return item; },
                    setSubmenu: () => menuUnder(`${named} › `),
                };
                build(item);
                return menu;
            },
        };
        return menu;
    };
    return {
        menu: menuUnder('') as unknown as Menu,
        closed: () => closed,
        titles: () => [...items.keys()],
        choose(title: string) {
            const run = items.get(title);
            if (!run) throw new Error(`no item "${title}" among ${[...items.keys()].join(', ')}`);
            run();
        },
    };
}

/** A panel over `sidebar`, with what it wrote into the view's state. Its listeners hear a write at once, as a view's store tells it. */
function panelOver(sidebar: SidebarFrame[]) {
    let state: SidebarFramesState = { sidebar, sidebarCollapsed: { a: true } };
    let writes = 0;
    const listeners: ((patch: Partial<SidebarFramesState>) => void)[] = [];
    const update = (patch: Partial<SidebarFramesState>) => {
        state = { ...state, ...patch };
        for (const listener of listeners) listener(patch);
    };
    let addMenu: ReturnType<typeof menuOf> | null = null;
    const frames = new SidebarFrames({
        plugin: { app: {}, menuPresenter: { present: (build: (menu: Menu) => void) => { addMenu = menuOf(); build(addMenu.menu); } } },
        index: { onChange: () => () => {} },
    } as unknown as SidebarFramesDeps, {
        state: () => state,
        subscribe: (listener) => {
            listeners.push(listener);
            return () => listeners.splice(listeners.indexOf(listener), 1);
        },
        write: (patch) => { writes++; update(patch); },
    });
    const placement = drawn.placement as ListPlacement;
    const markdown = drawn.markdownPlacement as MarkdownFramePlacement;
    /** Choose `title` in the items the panel adds to the menu of the frame `id`. */
    const choose = (id: string, title: string) => open(id)(title);
    /** Open the menu of the frame `id`: what it gives chooses one of its items, then or later. */
    const open = (id: string) => menuAt(id).choose;
    /** The menu of the frame `id`, with the items the panel adds to it. */
    const menuAt = (id: string) => {
        const menu = menuOf();
        placement.appendMenuItems(menu.menu, { id } as PinnedListDefinition);
        return menu;
    };
    /** Put the panel into a sidebar and click its add button: what it gives chooses one of the items of the menu it opened. */
    const add = () => {
        const placed: FakeEl[] = [];
        frames.mount({ appendChild: (el: FakeEl) => placed.push(el) } as unknown as HTMLElement);
        const button = placed.find(el => el.classList.contains('tv-sidebar__panel-add-btn'))!;
        Object.assign(button, { getBoundingClientRect: () => ({}) });
        button.dispatchEvent(new Event('click'));
        return {
            placed: placed.map(el => el.classList.contains('tv-sidebar__frames') ? 'frames' : el === button ? 'button' : 'other'),
            label: button.textContent, items: addMenu!.titles(), choose: addMenu!.choose,
        };
    };
    /** Change the frames from outside the menu, as a rename of a note does. */
    const set = (frames: SidebarFrame[]) => { state = { ...state, sidebar: frames }; };
    return {
        frames, placement, markdown, choose, open, menuAt, add, set, update,
        ids: () => state.sidebar?.map(f => f.id), state: () => state, writes: () => writes,
    };
}

describe("the stack of a sidebar that holds a markdown frame", () => {
    beforeEach(() => {
        vi.stubGlobal('document', { createElement: () => new FakeEl() });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('moves a list past the markdown frame, and the markdown frame by its own id', () => {
        const panel = panelOver([A, MEMO, B]);
        panel.choose('b', t('menu.moveUp'));
        expect(panel.ids()).toEqual(['a', 'b', 'm']);
        panel.choose('m', t('menu.moveUp'));
        expect(panel.ids()).toEqual(['a', 'm', 'b']);
        panel.choose('m', t('menu.moveDown'));
        expect(panel.ids()).toEqual(['a', 'b', 'm']);
        expect(panel.state().sidebar?.[2]).toEqual(MEMO);
    });

    it('moves the frames the state holds when the item is chosen, not those it held when the menu opened', () => {
        const panel = panelOver([A, MEMO, B]);
        const choose = panel.open('b');
        const renamed: SidebarFrame = { ...MEMO, link: 'Moved/Note#Memo' };
        panel.set([A, renamed, B]);
        choose(t('menu.moveUp'));
        expect(panel.state().sidebar).toEqual([A, B, renamed]);
    });

    it('finds the frame again by its id when the item is chosen, and moves nothing once it is gone or at the end', () => {
        const panel = panelOver([A, MEMO, B]);
        const up = panel.open('b');
        panel.set([B, A, MEMO]);
        up(t('menu.moveUp'));
        expect(panel.ids()).toEqual(['b', 'a', 'm']);

        const down = panel.open('a');
        panel.set([B, MEMO]);
        down(t('menu.moveDown'));
        expect(panel.ids()).toEqual(['b', 'm']);
    });

    it('offers no move past the ends of the stack', () => {
        const panel = panelOver([MEMO, A]);
        expect(() => panel.choose('m', t('menu.moveUp'))).toThrow();
        expect(() => panel.choose('a', t('menu.moveDown'))).toThrow();
    });

    it('removes a frame by its id: a list beside the markdown frame, or the markdown frame', () => {
        const panel = panelOver([A, MEMO, B]);
        panel.choose('a', t('menu.remove'));
        expect(panel.state().sidebar).toEqual([MEMO, B]);
        panel.choose('m', t('menu.remove'));
        expect(panel.state().sidebar).toEqual([B]);
    });

    it('writes which frame is collapsed by its id, beside the others', () => {
        const panel = panelOver([A, MEMO, B]);
        panel.placement.setCollapsed('m', true);
        expect(panel.state().sidebarCollapsed).toEqual({ a: true, m: true });
        expect(panel.state().sidebar).toEqual([A, MEMO, B]);
    });

    it('puts a copy of a list right below it, above the markdown frame', () => {
        const panel = panelOver([A, MEMO, B]);
        panel.placement.insertCopy(A, list('copy'));
        expect(panel.state().sidebar).toEqual([A, listFrame(list('copy')), MEMO, B]);
    });

    it('writes the links it is given into the markdown frames of their ids, at once, and into no list', () => {
        const other: SidebarFrame = { kind: 'markdown', id: 'n', link: 'Other#Note' };
        const panel = panelOver([A, MEMO, other, B]);
        panel.markdown.relink(new Map([['m', 'Moved/Note#Memo'], ['a', 'Not/A#List']]));
        expect(panel.state().sidebar).toEqual([A, { ...MEMO, link: 'Moved/Note#Memo' }, other, B]);
        expect(panel.writes()).toBe(1);
    });

    it('writes nothing for links that change no frame: a link a frame has already, or an id no markdown frame has', () => {
        const panel = panelOver([A, MEMO]);
        panel.markdown.relink(new Map([['m', MEMO.link], ['gone', 'Gone#Memo']]));
        expect(panel.writes()).toBe(0);
    });

    it('collapses and removes a markdown frame by its id, through the place the markdown frames are handed', () => {
        const panel = panelOver([A, MEMO, B]);
        panel.markdown.setCollapsed('m', true);
        expect(panel.state().sidebarCollapsed).toEqual({ a: true, m: true });
        panel.markdown.remove('m');
        expect(panel.state().sidebar).toEqual([A, B]);
    });

    it('puts its add button into the sidebar after the frames, and not among them', () => {
        expect(panelOver([A, MEMO]).add().placed).toEqual(['frames', 'button']);
    });

    it('offers a list and a section from its add button, and puts a new list at the end of the stack, its name edited once drawn', () => {
        drawn.renames = [];
        const panel = panelOver([A, MEMO]);
        const menu = panel.add();
        expect(menu.label).toBe(t('sidebar.add'));
        expect(menu.items).toEqual([t('pinnedList.addList'), t('sidebar.addSection')]);
        menu.choose(t('pinnedList.addList'));
        const added = panel.state().sidebar?.[2];
        expect(panel.state().sidebar?.slice(0, 2)).toEqual([A, MEMO]);
        expect(added).toMatchObject({ kind: 'list', id: 'list-new' });
        expect(drawn.renames).toEqual(['list-new']);
    });

    it('has the markdown frames open the dialog that adds a section, and puts the frame they hand it at the end of the stack', () => {
        drawn.sectionsAdded = [];
        const panel = panelOver([A, MEMO]);
        panel.add().choose(t('sidebar.addSection'));
        expect(drawn.sectionsAdded).toEqual([{ at: 'end' }]);
        expect(panel.writes()).toBe(0);

        const added: SidebarFrame = { kind: 'markdown', id: 'md-new', link: 'Other#Memo' };
        panel.markdown.insert(added, { at: 'end' });
        expect(panel.state().sidebar).toEqual([A, MEMO, added]);
        expect(panel.state().sidebarCollapsed).toEqual({ a: true });
    });

    it('offers in every frame\'s menu to add above and below it, each the add button\'s items, next to the moves', () => {
        const panel = panelOver([A, MEMO, B]);
        const above = t('menu.addAbove'), below = t('menu.addBelow');
        for (const id of ['a', 'm', 'b']) {
            expect(panel.menuAt(id).titles()).toEqual(expect.arrayContaining([
                `${above} › ${t('pinnedList.addList')}`, `${above} › ${t('sidebar.addSection')}`,
                `${below} › ${t('pinnedList.addList')}`, `${below} › ${t('sidebar.addSection')}`,
            ]));
        }
        expect(panel.menuAt('m').titles().filter(title => !title.includes(' › '))).toEqual([t('menu.moveUp'), t('menu.moveDown'), t('menu.remove')]);
    });

    it('puts a new list right above or below the frame whose menu added it, its name edited once drawn, and closes that menu', () => {
        drawn.renames = [];
        const panel = panelOver([A, MEMO, B]);
        const menu = panel.menuAt('m');
        menu.choose(`${t('menu.addAbove')} › ${t('pinnedList.addList')}`);
        expect(panel.ids()).toEqual(['a', 'list-new', 'm', 'b']);
        expect(menu.closed()).toBe(1);

        panel.set([A, MEMO, B]);
        panel.menuAt('m').choose(`${t('menu.addBelow')} › ${t('pinnedList.addList')}`);
        expect(panel.ids()).toEqual(['a', 'm', 'list-new', 'b']);
        expect(drawn.renames).toEqual(['list-new', 'list-new']);
        expect(panel.state().sidebarCollapsed).toEqual({ a: true });
    });

    it('has the markdown frames open the dialog for the slot above or below the frame, and puts the frame they hand it there as the frames are then', () => {
        drawn.sectionsAdded = [];
        const panel = panelOver([A, MEMO, B]);
        panel.menuAt('a').choose(`${t('menu.addBelow')} › ${t('sidebar.addSection')}`);
        panel.menuAt('b').choose(`${t('menu.addAbove')} › ${t('sidebar.addSection')}`);
        expect(drawn.sectionsAdded).toEqual([{ at: 'below', id: 'a' }, { at: 'above', id: 'b' }]);
        expect(panel.writes()).toBe(0);

        // The frames changed while the dialog was open: the frame is found again by its id.
        panel.set([B, A, MEMO]);
        const added: SidebarFrame = { kind: 'markdown', id: 'md-new', link: 'Other#Memo' };
        panel.markdown.insert(added, { at: 'above', id: 'b' });
        expect(panel.ids()).toEqual(['md-new', 'b', 'a', 'm']);
    });

    it('writes a change of a list into the list frame of its id, and into no markdown frame', () => {
        const panel = panelOver([A, MEMO, B]);
        panel.placement.replaceList('b', { name: 'Renamed' });
        expect(panel.state().sidebar).toEqual([A, MEMO, { ...B, name: 'Renamed' }]);
        panel.placement.replaceList('m', { name: 'Not a list' });
        expect(panel.state().sidebar).toEqual([A, MEMO, { ...B, name: 'Renamed' }]);
    });
});

describe('the markdown frames of a sidebar, kept to the state', () => {
    beforeEach(() => {
        // The panel's elements, as much of them as making the panel and a draw touch.
        vi.stubGlobal('document', {
            createElement: () => {
                const children: unknown[] = [];
                return {
                    children,
                    addClass() {},
                    appendText() {},
                    addEventListener() {},
                    insertBefore(node: unknown) { children.push(node); return node; },
                    createDiv: () => ({ setText() {} }),
                };
            },
        });
        drawn.synced = [];
        drawn.requested = 0;
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('have the state\'s frames and folds take as the panel opens, and at once on a change of either, ahead of the draw it requests', () => {
        const panel = panelOver([]);
        panel.frames.open();
        expect(drawn.synced).toEqual([{ ids: [], collapsed: { a: true } }]);

        panel.update({ sidebar: [A, MEMO] });
        expect(drawn.synced.at(-1)).toEqual({ ids: ['m'], collapsed: { a: true } });
        expect(drawn.requested).toBe(1);

        panel.markdown.setCollapsed('m', true);
        expect(drawn.synced.at(-1)).toEqual({ ids: ['m'], collapsed: { a: true, m: true } });
        expect(drawn.synced).toHaveLength(3);
    });

    it('are not had take anything on a change of another field, nor once the panel is closed', () => {
        const panel = panelOver([MEMO]);
        panel.frames.open();
        panel.update({ maskMode: true, filterState: { filters: [], logic: 'and' } });
        expect(drawn.synced).toHaveLength(1);

        panel.frames.close();
        panel.update({ sidebar: [] });
        expect(drawn.synced).toHaveLength(1);
    });

    it('take the frames the state got while the panel was closed when it opens again', () => {
        const panel = panelOver([]);
        panel.frames.open();
        panel.frames.close();
        panel.update({ sidebar: [MEMO] });
        panel.frames.open();
        expect(drawn.synced.at(-1)).toEqual({ ids: ['m'], collapsed: { a: true } });
    });
});

/**
 * The order the panel puts its frames' elements in: the elements a draw
 * kept (the markdown frames') are where they were, and those it made anew
 * (the lists') are at the end, until `stackInOrder` places them.
 */
describe('the elements of the frames, put in the order of the stack', () => {
    /** A parent holding the elements `names`, with the elements it was asked to put in. */
    function parentOf(names: string[]) {
        const els = new Map<string, HTMLElement>();
        const el = (name: string) => {
            if (!els.has(name)) els.set(name, { name } as unknown as HTMLElement);
            return els.get(name)!;
        };
        const nameOf = (node: unknown) => (node as { name: string }).name;
        const children = names.map(el);
        const moved: string[] = [];
        const parent = {
            children: children as unknown as HTMLCollection,
            insertBefore<T extends Node>(node: T, at: Node | null): T {
                const one = node as unknown as HTMLElement;
                moved.push(nameOf(one));
                const from = children.indexOf(one);
                if (from >= 0) children.splice(from, 1);
                children.splice(at ? children.indexOf(at as HTMLElement) : children.length, 0, one);
                return node;
            },
        };
        return { order: (wanted: string[]) => stackInOrder(parent, wanted.map(el)), moved, names: () => children.map(nameOf) };
    }

    it('moves the lists made anew into their places, and no markdown frame that kept its order', () => {
        const parent = parentOf(['m1', 'm2', 'l1', 'l2']);
        parent.order(['l1', 'm1', 'l2', 'm2']);
        expect(parent.names()).toEqual(['l1', 'm1', 'l2', 'm2']);
        expect(parent.moved).toEqual(['l1', 'l2']);
    });

    it('moves nothing when every element is where it goes', () => {
        const parent = parentOf(['m1', 'm2', 'l1']);
        parent.order(['m1', 'm2', 'l1']);
        expect(parent.moved).toEqual([]);
    });

    it('moves one of two markdown frames that changed places, and not the other', () => {
        const parent = parentOf(['m1', 'm2', 'm3']);
        parent.order(['m1', 'm3', 'm2']);
        expect(parent.names()).toEqual(['m1', 'm3', 'm2']);
        expect(parent.moved).toEqual(['m3']);
    });

    it('puts in an element the parent did not hold, where it goes', () => {
        const parent = parentOf(['m1', 'm2']);
        parent.order(['m1', 'm0', 'm2']);
        expect(parent.names()).toEqual(['m1', 'm0', 'm2']);
        expect(parent.moved).toEqual(['m0']);
    });
});

describe('a new frame put in a slot of the stack', () => {
    const NEW = listFrame(list('new'));
    const ids = (frames: SidebarFrame[]) => frames.map(f => f.id);

    it('goes at the end, right above or right below the frame of an id', () => {
        expect(ids(insertFrame([A, MEMO, B], NEW, { at: 'end' }))).toEqual(['a', 'm', 'b', 'new']);
        expect(ids(insertFrame([A, MEMO, B], NEW, { at: 'above', id: 'a' }))).toEqual(['new', 'a', 'm', 'b']);
        expect(ids(insertFrame([A, MEMO, B], NEW, { at: 'above', id: 'm' }))).toEqual(['a', 'new', 'm', 'b']);
        expect(ids(insertFrame([A, MEMO, B], NEW, { at: 'below', id: 'm' }))).toEqual(['a', 'm', 'new', 'b']);
        expect(ids(insertFrame([A, MEMO, B], NEW, { at: 'below', id: 'b' }))).toEqual(['a', 'm', 'b', 'new']);
    });

    it('goes at the end when no frame has the id, and alone in a stack that holds none', () => {
        expect(ids(insertFrame([A, MEMO], NEW, { at: 'above', id: 'gone' }))).toEqual(['a', 'm', 'new']);
        expect(ids(insertFrame([A, MEMO], NEW, { at: 'below', id: 'gone' }))).toEqual(['a', 'm', 'new']);
        expect(ids(insertFrame([], NEW, { at: 'below', id: 'gone' }))).toEqual(['new']);
    });

    it('leaves the frames it is handed as they are', () => {
        const frames = [A, MEMO];
        insertFrame(frames, NEW, { at: 'above', id: 'a' });
        expect(frames).toEqual([A, MEMO]);
    });
});
