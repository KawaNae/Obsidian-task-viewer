import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Menu } from 'obsidian';
import { t } from '../../../src/i18n';
import { listFrame, type PinnedListDefinition, type SidebarFrame } from '../../../src/types';
import { SidebarFrames, type SidebarFramesState } from '../../../src/views/sidebar/SidebarFrames';
import type { ListPlacement, ListSectionDeps } from '../../../src/views/sharedUI/TaskListSections';
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
    new SidebarFrames({} as ListSectionDeps, {
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
