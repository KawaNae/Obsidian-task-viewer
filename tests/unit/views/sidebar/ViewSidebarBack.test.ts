import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { historyStack } from '../../mocks/obsidian';
import { ViewSidebar, type ViewSidebarState } from '../../../../src/views/sidebar/ViewSidebar';
import type { SidebarFramesDeps } from '../../../../src/views/sidebar/SidebarFrames';
import { holdHistoryBack } from '../../../../src/views/sharedUI/HistoryBack';
import { FakeEl, asEl } from '../../helpers/fakeDom';

/**
 * The sidebar takes the user's "back" while it lies open over the view
 * (open, and at or below the breakpoint), and only then: the stand-in it
 * puts on Obsidian's stack (the mock's, whose `open` and `close` are written
 * as Obsidian's) is there exactly while both hold. Over the view, whether it
 * is open is the sidebar's own value, which the back closes, leaving the
 * view's `showSidebar` as it was.
 *
 * Then the open state: beside the view it is `showSidebar`, which the toggle
 * alone writes; over it, a value the sidebar holds and writes nowhere,
 * closed each time the view is seen narrow after it was not (wider, or a
 * hidden tab), kept while the view stays narrow.
 *
 * Then the look: it follows a `showSidebar` the view's state is handed
 * without a draw of the view, and a toggle applies it once, sliding.
 *
 * Then the document: a view opened in none and put into one later has the
 * panel told, once, when its container is seen in the document, and not
 * when its width alone changes.
 */

/** How many times the panel was told it was put into a document. */
let placedCalls = 0;

vi.mock('../../../../src/views/sidebar/SidebarFrames', () => ({
    SidebarFrames: class {
        open() {}
        close() {}
        settingsSaved() {}
        placed() { placedCalls++; }
    },
}));

const BREAKPOINT = 768;

let observers: Array<() => void> = [];

class FakeResizeObserver {
    constructor(private callback: () => void) {}
    observe(): void { observers.push(this.callback); }
    disconnect(): void { observers = observers.filter((cb) => cb !== this.callback); }
}

const globals = globalThis as { ResizeObserver?: unknown };
const realResizeObserver = globals.ResizeObserver;

beforeEach(() => {
    observers = [];
    placedCalls = 0;
    globals.ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
    globals.ResizeObserver = realResizeObserver;
    historyStack.length = 0;
});

/**
 * A view with a sidebar at `width`, built as the view opens, its state's
 * `showSidebar` being `saved`; with `open`, the user then opened it with the
 * toggle. Its state's listeners hear a write at once, as a view's store
 * tells them.
 */
function setup(width: number, open: boolean, connected = true, saved = open) {
    let state: ViewSidebarState = { showSidebar: saved };
    const writes: Partial<ViewSidebarState>[] = [];
    const listeners: ((patch: Partial<ViewSidebarState>) => void)[] = [];
    const update = (patch: Partial<ViewSidebarState>) => {
        state = { ...state, ...patch };
        for (const listener of [...listeners]) listener(patch);
    };
    let toggleSyncs = 0;
    const container = Object.assign(new FakeEl(), { clientWidth: width, isConnected: connected });
    const sidebar = new ViewSidebar({} as SidebarFramesDeps, {
        state: () => state,
        subscribe: (listener) => {
            listeners.push(listener);
            return () => listeners.splice(listeners.indexOf(listener), 1);
        },
        write: (patch) => { writes.push(patch); update(patch); },
    }, {
        mobileBreakpointPx: BREAKPOINT,
        syncToggleButton: () => { toggleSyncs++; },
    });
    sidebar.build(asEl(container));
    if (open) sidebar.toggle(true);

    function resize(next: number): void {
        container.clientWidth = next;
        observers.forEach((cb) => cb());
    }
    /** Put the container into a document, or take it out; it takes or loses a size, which the observer reports. */
    function place(inDocument: boolean, next = width): void {
        container.isConnected = inDocument;
        resize(inDocument ? next : 0);
    }
    const layout = container.find('tv-sidebar')!;
    const look = () => ({
        hidden: layout.find('tv-sidebar__panel')!.classList.contains('tv-sidebar__panel--hidden'),
        animate: layout.classList.contains('tv-sidebar--animate'),
    });
    const clickBackdrop = () => layout.find('tv-sidebar__backdrop')!.dispatchEvent(new Event('click'));
    return {
        sidebar, resize, place, update, look, clickBackdrop,
        writes: () => writes.length,
        shown: () => state.showSidebar,
        toggleSyncs: () => toggleSyncs,
    };
}

function back(): void {
    historyStack[historyStack.length - 1].onHistoryBack();
}

describe('ViewSidebar and the back', () => {
    it('takes the back while open over the view, which closes it as the backdrop does, and lets go once closed', () => {
        const { sidebar, shown } = setup(400, true);
        expect(historyStack).toHaveLength(1);

        back();
        expect(sidebar.isOpen()).toBe(false);
        expect(shown()).toBe(true);
        expect(historyStack).toHaveLength(0);
    });

    it('takes it from the moment the user opens the sidebar at narrow width, once however often it syncs', () => {
        const { sidebar, resize, update } = setup(400, false);
        expect(historyStack).toHaveLength(0);

        sidebar.toggle(true);
        resize(400);
        update({ showSidebar: true });
        expect(historyStack).toHaveLength(1);
    });

    it('does not take it at narrow width for a showSidebar the state holds, until the toggle opens the sidebar', () => {
        const { sidebar, update } = setup(400, false);
        update({ showSidebar: true });
        expect(sidebar.isOpen()).toBe(false);
        expect(historyStack).toHaveLength(0);
    });

    it('leaves the back alone while the sidebar lies beside the view, at the breakpoint and wider', () => {
        setup(BREAKPOINT + 1, true);
        expect(historyStack).toHaveLength(0);
        setup(BREAKPOINT, true);
        expect(historyStack).toHaveLength(1);
    });

    it('lets go once the view widens past the breakpoint, and takes it again once the toggle opens it narrowed', () => {
        const { sidebar, resize } = setup(400, true);
        resize(1000);
        expect(historyStack).toHaveLength(0);
        resize(500);
        expect(historyStack).toHaveLength(0);
        sidebar.toggle(true);
        expect(historyStack).toHaveLength(1);
    });

    it('does not take it in a hidden tab, which reports no width, and lets go once its tab is hidden', () => {
        setup(0, true);
        expect(historyStack).toHaveLength(0);

        const { resize } = setup(400, true);
        expect(historyStack).toHaveLength(1);
        resize(0);
        expect(historyStack).toHaveLength(0);
    });

    it('lets go on close, and no longer follows the width', () => {
        const { sidebar, resize } = setup(400, true);
        sidebar.close();
        expect(historyStack).toHaveLength(0);
        resize(500);
        expect(historyStack).toHaveLength(0);
    });

    it('lets go of its own place only, a dialog opened above it keeping the top', () => {
        const { shown, resize } = setup(400, true);
        const backs: string[] = [];
        const releaseDialog = holdHistoryBack(() => backs.push('dialog'));
        expect(historyStack).toHaveLength(2);

        resize(1000);
        expect(historyStack).toHaveLength(1);
        back();
        expect(backs).toEqual(['dialog']);
        expect(shown()).toBe(true);
        releaseDialog();
    });

    it('is under a dialog opened above it: the back closes the dialog first, then the sidebar', () => {
        const { sidebar } = setup(400, true);
        const releaseDialog = holdHistoryBack(() => releaseDialog());

        back();
        expect(sidebar.isOpen()).toBe(true);
        expect(historyStack).toHaveLength(1);
        back();
        expect(sidebar.isOpen()).toBe(false);
        expect(historyStack).toHaveLength(0);
    });
});

describe('ViewSidebar\'s open state', () => {
    it('starts closed over the view whatever showSidebar says, and the toggle opens and closes it there without writing it', () => {
        const { sidebar, look, shown, writes } = setup(400, false, true, true);
        expect(sidebar.isOpen()).toBe(false);
        expect(look().hidden).toBe(true);

        sidebar.toggle(true);
        expect(sidebar.isOpen()).toBe(true);
        expect(look()).toEqual({ hidden: false, animate: true });
        sidebar.toggle(false);
        expect(sidebar.isOpen()).toBe(false);
        expect(look()).toEqual({ hidden: true, animate: true });
        expect(shown()).toBe(true);
        expect(writes()).toBe(0);
    });

    it('opens over the view with the toggle whatever showSidebar says', () => {
        const { sidebar, shown, writes } = setup(400, true, true, false);
        expect(sidebar.isOpen()).toBe(true);
        expect(shown()).toBe(false);
        expect(writes()).toBe(0);
    });

    it('closes over the view on a click on the backdrop and on the back, writing nothing', () => {
        const backdrop = setup(400, true, true, true);
        backdrop.clickBackdrop();
        expect(backdrop.sidebar.isOpen()).toBe(false);
        expect(backdrop.look()).toEqual({ hidden: true, animate: true });
        expect(backdrop.writes()).toBe(0);

        const theBack = setup(400, true, true, true);
        back();
        expect(theBack.sidebar.isOpen()).toBe(false);
        expect(theBack.writes()).toBe(0);
    });

    it('writes showSidebar with the toggle beside the view, and follows it', () => {
        const { sidebar, shown, writes } = setup(1000, false, true, true);
        expect(sidebar.isOpen()).toBe(true);
        sidebar.toggle(false);
        expect(shown()).toBe(false);
        expect(sidebar.isOpen()).toBe(false);
        sidebar.toggle(true);
        expect(shown()).toBe(true);
        expect(writes()).toBe(2);
    });

    it('closes once the view narrows, opened beside it with the toggle or by the state', () => {
        const toggled = setup(1000, false, true, false);
        toggled.sidebar.toggle(true);
        toggled.resize(500);
        expect(toggled.sidebar.isOpen()).toBe(false);
        expect(toggled.look()).toEqual({ hidden: true, animate: false });
        expect(toggled.shown()).toBe(true);

        const saved = setup(1000, false, true, true);
        saved.resize(500);
        expect(saved.sidebar.isOpen()).toBe(false);
        expect(saved.look().hidden).toBe(true);
    });

    it('stays open over the view while its width changes and stays narrow', () => {
        const { sidebar, resize, look } = setup(400, true);
        resize(600);
        resize(BREAKPOINT);
        expect(sidebar.isOpen()).toBe(true);
        expect(look().hidden).toBe(false);
    });

    it('shows the showSidebar of the wide width once the view widens, whatever was done over it', () => {
        const closedOver = setup(400, true, true, true);
        closedOver.sidebar.toggle(false);
        closedOver.resize(1000);
        expect(closedOver.sidebar.isOpen()).toBe(true);
        expect(closedOver.look().hidden).toBe(false);

        const openedOver = setup(400, true, true, false);
        openedOver.resize(1000);
        expect(openedOver.sidebar.isOpen()).toBe(false);
        expect(openedOver.look().hidden).toBe(true);
    });

    it('starts closed again each time the view narrows, opened over it before', () => {
        const { sidebar, resize, look } = setup(400, true, true, false);
        resize(1000);
        resize(400);
        expect(sidebar.isOpen()).toBe(false);
        expect(look().hidden).toBe(true);
    });

    it('starts closed once its tab, hidden, is shown again at narrow width', () => {
        const { sidebar, resize, look } = setup(400, true, true, true);
        resize(0);
        resize(400);
        expect(sidebar.isOpen()).toBe(false);
        expect(look().hidden).toBe(true);
        expect(historyStack).toHaveLength(0);
    });

    it('shows nothing of a showSidebar handed in over the view, and shows it once the view widens', () => {
        const { sidebar, update, resize, look } = setup(400, true, true, false);
        update({ showSidebar: true });
        update({ showSidebar: false });
        expect(sidebar.isOpen()).toBe(true);
        expect(look()).toEqual({ hidden: false, animate: true });

        update({ showSidebar: true });
        resize(1000);
        expect(look()).toEqual({ hidden: false, animate: false });
        update({ showSidebar: false });
        resize(400);
        resize(1000);
        expect(look().hidden).toBe(true);
    });

    it('shows on the toolbar each change over the view, by the toggle, the backdrop and the narrowing', () => {
        const { sidebar, clickBackdrop, resize, toggleSyncs } = setup(400, false);
        let before = toggleSyncs();
        sidebar.toggle(true);
        expect(toggleSyncs() - before).toBe(1);
        before = toggleSyncs();
        clickBackdrop();
        expect(toggleSyncs() - before).toBe(1);
        resize(1000);
        sidebar.toggle(true);
        before = toggleSyncs();
        resize(400);
        expect(toggleSyncs() - before).toBe(1);
        expect(sidebar.isOpen()).toBe(false);
    });
});

describe('ViewSidebar\'s look', () => {
    it('follows a showSidebar the state is handed, at once and without sliding', () => {
        const { update, look } = setup(1000, false);
        expect(look()).toEqual({ hidden: true, animate: false });
        update({ showSidebar: true });
        expect(look()).toEqual({ hidden: false, animate: false });
        update({ showSidebar: false });
        expect(look()).toEqual({ hidden: true, animate: false });
    });

    it('no longer follows the state once closed', () => {
        const { sidebar, update, look } = setup(1000, false);
        sidebar.close();
        update({ showSidebar: true });
        expect(look().hidden).toBe(true);
    });

    it('applies a toggle once, sliding: the showSidebar it writes is not applied again', () => {
        const { sidebar, look, shown, toggleSyncs } = setup(1000, false);
        const before = toggleSyncs();
        sidebar.toggle(true);
        expect(shown()).toBe(true);
        expect(look()).toEqual({ hidden: false, animate: true });
        expect(toggleSyncs() - before).toBe(1);
    });
});

describe('ViewSidebar and the document', () => {
    it('tells the panel once, when a view built in no document is put into one', () => {
        const { resize, place } = setup(1000, false, false);
        resize(0);
        expect(placedCalls).toBe(0);

        place(true);
        expect(placedCalls).toBe(1);
        resize(800);
        resize(1200);
        expect(placedCalls).toBe(1);
    });

    it('tells it nothing when the view was built in a document and only its width changes', () => {
        const { resize } = setup(1000, false);
        resize(1000);
        resize(500);
        resize(0);
        resize(1000);
        expect(placedCalls).toBe(0);
    });

    it('tells it again when the view is taken out of the document and put back', () => {
        const { place } = setup(1000, false);
        place(false);
        expect(placedCalls).toBe(0);
        place(true);
        expect(placedCalls).toBe(1);
    });

    it('tells it nothing once closed', () => {
        const { sidebar, place } = setup(1000, false, false);
        sidebar.close();
        place(true);
        expect(placedCalls).toBe(0);
    });
});
