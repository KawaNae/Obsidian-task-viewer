import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { historyStack } from 'obsidian';
import { SidebarManager } from '../../../../src/views/sidebar/SidebarManager';
import { holdHistoryBack } from '../../../../src/views/sharedUI/HistoryBack';

/**
 * The sidebar takes the user's "back" while it lies open over the view
 * (open, and at or below the breakpoint), and only then: the stand-in it
 * puts on Obsidian's stack (the mock's, whose `open` and `close` are written
 * as Obsidian's) is there exactly while both hold. The view's own state is
 * the open state; a close the back asks for comes back through
 * `onRequestClose`, which the view answers by closing and applying it.
 */

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
    globals.ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
    globals.ResizeObserver = realResizeObserver;
    historyStack.length = 0;
});

/** A view with a sidebar: its open state, its width, and what it was asked. */
function setup(width: number, open: boolean) {
    const view = { open, closeRequests: 0 };
    const container = { clientWidth: width, win: {} } as unknown as HTMLElement;
    const manager = new SidebarManager({
        mobileBreakpointPx: BREAKPOINT,
        onPersist: () => {},
        onRequestClose: () => {
            view.closeRequests++;
            setOpen(false);
        },
        getIsOpen: () => view.open,
    });
    manager.attach(container, () => {});
    manager.syncPresentation(view.open, { animate: false });

    function setOpen(next: boolean): void {
        view.open = next;
        manager.applyOpen(next, { animate: true });
    }
    function resize(next: number): void {
        (container as unknown as { clientWidth: number }).clientWidth = next;
        observers.forEach((cb) => cb());
    }
    return { view, manager, setOpen, resize };
}

function back(): void {
    historyStack[historyStack.length - 1].onHistoryBack();
}

describe('SidebarManager and the back', () => {
    it('takes the back while open over the view, which closes it as the backdrop does, and lets go once closed', () => {
        const { view } = setup(400, true);
        expect(historyStack).toHaveLength(1);

        back();
        expect(view.closeRequests).toBe(1);
        expect(view.open).toBe(false);
        expect(historyStack).toHaveLength(0);
    });

    it('takes it from the moment the view opens the sidebar at narrow width, once however often it syncs', () => {
        const { manager, setOpen } = setup(400, false);
        expect(historyStack).toHaveLength(0);

        setOpen(true);
        manager.syncPresentation(true, { animate: false });
        manager.applyOpen(true);
        expect(historyStack).toHaveLength(1);
    });

    it('leaves the back alone while the sidebar lies beside the view, at the breakpoint and wider', () => {
        setup(BREAKPOINT + 1, true);
        expect(historyStack).toHaveLength(0);
        setup(BREAKPOINT, true);
        expect(historyStack).toHaveLength(1);
    });

    it('lets go once the view widens past the breakpoint, and takes it again once it narrows', () => {
        const { resize } = setup(400, true);
        resize(1000);
        expect(historyStack).toHaveLength(0);
        resize(500);
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

    it('lets go on detach', () => {
        const { manager } = setup(400, true);
        manager.detach();
        expect(historyStack).toHaveLength(0);
    });

    it('lets go of its own place only, a dialog opened above it keeping the top', () => {
        const { view, resize } = setup(400, true);
        const backs: string[] = [];
        const releaseDialog = holdHistoryBack(() => backs.push('dialog'));
        expect(historyStack).toHaveLength(2);

        resize(1000);
        expect(historyStack).toHaveLength(1);
        back();
        expect(backs).toEqual(['dialog']);
        expect(view.closeRequests).toBe(0);
        releaseDialog();
    });

    it('is under a dialog opened above it: the back closes the dialog first, then the sidebar', () => {
        const { view } = setup(400, true);
        const releaseDialog = holdHistoryBack(() => releaseDialog());

        back();
        expect(view.open).toBe(true);
        expect(historyStack).toHaveLength(1);
        back();
        expect(view.open).toBe(false);
        expect(historyStack).toHaveLength(0);
    });
});
