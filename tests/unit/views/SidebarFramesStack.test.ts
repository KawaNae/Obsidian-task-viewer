import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Menu } from 'obsidian';
import { t } from '../../../src/i18n';
import { listFrame, type PinnedListDefinition, type SidebarFrame } from '../../../src/types';
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
    /** How many times the markdown frames were asked to open the dialog that adds one. */
    sectionsAdded: 0,
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
        add() { drawn.sectionsAdded++; }
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

/** A menu that records its items by title: `choose` runs the item of a title, then or later. */
function menuOf() {
    const items = new Map<string, () => void>();
    const menu = {
        addSeparator: () => menu,
        addItem(build: (item: unknown) => void) {
            let named = '';
            const item = {
                setTitle: (text: string) => { named = text; return item; },
                setIcon: () => item,
                onClick: (run: () => void) => { items.set(named, run); return item; },
            };
            build(item);
            return menu;
        },
    };
    return {
        menu: menu as unknown as Menu,
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
    const open = (id: string) => {
        const { menu, choose: chooseIn } = menuOf();
        placement.appendMenuItems(menu, { id } as PinnedListDefinition);
        return chooseIn;
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
        frames, placement, markdown, choose, open, add, set, update,
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
        drawn.sectionsAdded = 0;
        const panel = panelOver([A, MEMO]);
        panel.add().choose(t('sidebar.addSection'));
        expect(drawn.sectionsAdded).toBe(1);
        expect(panel.writes()).toBe(0);

        const added: SidebarFrame = { kind: 'markdown', id: 'md-new', link: 'Other#Memo' };
        panel.markdown.append(added);
        expect(panel.state().sidebar).toEqual([A, MEMO, added]);
        expect(panel.state().sidebarCollapsed).toEqual({ a: true });
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
