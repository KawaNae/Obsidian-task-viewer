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
const drawn = vi.hoisted(() => ({ placement: null as unknown, markdownPlacement: null as unknown }));

vi.mock('../../../src/views/sharedUI/TaskListSections', () => ({
    TaskListSections: class {
        constructor(_deps: unknown, placement: unknown) { drawn.placement = placement; }
    },
}));

vi.mock('../../../src/views/sidebar/MarkdownFrameSections', () => ({
    MarkdownFrameSections: class {
        constructor(_deps: unknown, placement: unknown) { drawn.markdownPlacement = placement; }
    },
}));

const list = (id: string): PinnedListDefinition =>
    ({ id, name: `List ${id}`, filterState: { filters: [], logic: 'and' }, applyViewFilter: false });
const A = listFrame(list('a'));
const B = listFrame(list('b'));
const MEMO: SidebarFrame = { kind: 'markdown', id: 'm', link: 'Folder/Note#Memo' };

/** A panel over `sidebar`, with what it wrote into the view's state. */
function panelOver(sidebar: SidebarFrame[]) {
    let state: SidebarFramesState = { sidebar, sidebarCollapsed: { a: true } };
    let writes = 0;
    new SidebarFrames({ plugin: { app: {} } } as unknown as SidebarFramesDeps, {
        state: () => state,
        subscribe: () => () => {},
        write: patch => { writes++; state = { ...state, ...patch }; },
    });
    const placement = drawn.placement as ListPlacement;
    const markdown = drawn.markdownPlacement as MarkdownFramePlacement;
    /** Choose `title` in the items the panel adds to the menu of the frame `id`. */
    const choose = (id: string, title: string) => open(id)(title);
    /** Open the menu of the frame `id`: what it gives chooses one of its items, then or later. */
    const open = (id: string) => {
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
        placement.appendMenuItems(menu as unknown as Menu, { id } as PinnedListDefinition);
        return (title: string) => {
            const run = items.get(title);
            if (!run) throw new Error(`no item "${title}" among ${[...items.keys()].join(', ')}`);
            run();
        };
    };
    /** Change the frames from outside the menu, as a rename of a note does. */
    const set = (frames: SidebarFrame[]) => { state = { ...state, sidebar: frames }; };
    return { placement, markdown, choose, open, set, ids: () => state.sidebar?.map(f => f.id), state: () => state, writes: () => writes };
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

    it('writes a change of a list into the list frame of its id, and into no markdown frame', () => {
        const panel = panelOver([A, MEMO, B]);
        panel.placement.replaceList('b', { name: 'Renamed' });
        expect(panel.state().sidebar).toEqual([A, MEMO, { ...B, name: 'Renamed' }]);
        panel.placement.replaceList('m', { name: 'Not a list' });
        expect(panel.state().sidebar).toEqual([A, MEMO, { ...B, name: 'Renamed' }]);
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
