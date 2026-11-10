import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Menu } from 'obsidian';
import { t } from '../../../src/i18n';
import { listFrame, type PinnedListDefinition, type SidebarFrame } from '../../../src/types';
import { SidebarFrames, stackInOrder, type SidebarFramesDeps, type SidebarFramesState } from '../../../src/views/sidebar/SidebarFrames';
import type { ListPlacement } from '../../../src/views/sharedUI/TaskListSections';
import { FakeEl } from '../helpers/fakeDom';

/**
 * The stack of a sidebar that holds a markdown frame among its lists: the
 * panel adds below, moves, removes and collapses a frame by its id, whatever
 * its kind. The lists' drawing is stood in for, and hands the test the
 * placement the panel is.
 */
const drawn = vi.hoisted(() => ({ placement: null as unknown }));

vi.mock('../../../src/views/sharedUI/TaskListSections', () => ({
    TaskListSections: class {
        constructor(_deps: unknown, placement: unknown) { drawn.placement = placement; }
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
    new SidebarFrames({ plugin: { app: {} } } as unknown as SidebarFramesDeps, {
        state: () => state,
        subscribe: () => () => {},
        write: patch => { state = { ...state, ...patch }; },
    });
    const placement = drawn.placement as ListPlacement;
    /** Choose `title` in the items the panel adds to the menu of the frame `id`. */
    const choose = (id: string, title: string) => {
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
        const run = items.get(title);
        if (!run) throw new Error(`no item "${title}" among ${[...items.keys()].join(', ')}`);
        run();
    };
    return { placement, choose, ids: () => state.sidebar?.map(f => f.id), state: () => state };
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
