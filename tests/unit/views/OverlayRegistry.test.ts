import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerOverlay,
    unregisterOverlay,
    closeAllOverlays,
    openOverlayCount,
    overlayAbove,
    whenOverlaysOpened,
    type ClosableOverlay,
} from '../../../src/views/sharedUI/OverlayRegistry';

/**
 * Stand-in for OverlayShell — the registry calls `close()` and reads
 * `layer()`, so a plain object is the whole contract (the "plain object, no
 * jsdom" pattern used in tests/unit/views/ViewToolbarMenus.test.ts).
 */
function fakeOverlay(closed: string[], name: string, onClose?: () => void): ClosableOverlay {
    return {
        close() {
            closed.push(name);
            onClose?.();
        },
        layer: () => null,
        opening: () => null,
    };
}

/** A node of a body: its parent and its next sibling, all the order reads. */
interface FakeNode { parentNode: FakeNode | null; nextSibling: FakeNode | null }

/** A body holding `count` layers in the order they were put there. */
function bodyOf(count: number): FakeNode[] {
    const body: FakeNode = { parentNode: null, nextSibling: null };
    const layers = Array.from({ length: count }, (): FakeNode => ({ parentNode: body, nextSibling: null }));
    layers.forEach((layer, i) => { layer.nextSibling = layers[i + 1] ?? null; });
    return layers;
}

/** An open overlay standing in `layer`. */
function standingIn(layer: FakeNode | null): ClosableOverlay {
    return { close() {}, layer: () => layer as unknown as Node | null, opening: () => null };
}

describe('OverlayRegistry', () => {
    beforeEach(() => {
        closeAllOverlays();
    });

    it('closes every registered overlay and empties the registry', () => {
        const closed: string[] = [];
        registerOverlay(fakeOverlay(closed, 'a'));
        registerOverlay(fakeOverlay(closed, 'b'));
        expect(openOverlayCount()).toBe(2);

        closeAllOverlays();

        expect(closed).toEqual(['a', 'b']);
        expect(openOverlayCount()).toBe(0);
    });

    it('does not close an overlay that unregistered itself', () => {
        const closed: string[] = [];
        const gone = fakeOverlay(closed, 'gone');
        registerOverlay(gone);
        registerOverlay(fakeOverlay(closed, 'kept'));

        unregisterOverlay(gone);
        closeAllOverlays();

        expect(closed).toEqual(['kept']);
    });

    it('walks every overlay even when close() unregisters during the walk', () => {
        // OverlayShell.close() calls unregisterOverlay(this), so this is the
        // normal path — mutating the set mid-iteration must not cut it short.
        const closed: string[] = [];
        const overlays: ClosableOverlay[] = [];
        for (const name of ['a', 'b', 'c']) {
            const overlay: ClosableOverlay = fakeOverlay(closed, name, () => unregisterOverlay(overlay));
            overlays.push(overlay);
            registerOverlay(overlay);
        }

        closeAllOverlays();

        expect(closed).toEqual(['a', 'b', 'c']);
        expect(openOverlayCount()).toBe(0);
    });

    it('closes the remaining overlays when one throws', () => {
        const closed: string[] = [];
        registerOverlay({ close() { closed.push('boom'); throw new Error('teardown failed'); }, layer: () => null, opening: () => null });
        registerOverlay(fakeOverlay(closed, 'after'));

        expect(() => closeAllOverlays()).not.toThrow();

        expect(closed).toEqual(['boom', 'after']);
        expect(openOverlayCount()).toBe(0);
    });

    it('closes an overlay once even if it is registered twice', () => {
        const closed: string[] = [];
        const overlay = fakeOverlay(closed, 'a');
        registerOverlay(overlay);
        registerOverlay(overlay);

        closeAllOverlays();

        expect(closed).toEqual(['a']);
    });
});

describe('overlayAbove', () => {
    beforeEach(() => {
        closeAllOverlays();
    });

    it('finds an open overlay put on the body after this one, and none for the top one', () => {
        // The workspace first, then the hub, then the dialog opened from it.
        const [, hub, dialog] = bodyOf(3);
        const under = standingIn(hub);
        const top = standingIn(dialog);
        registerOverlay(under);
        registerOverlay(top);
        expect(overlayAbove(under)).toBe(true);
        expect(overlayAbove(top)).toBe(false);
    });

    it('goes by the body, not by the order they were registered in', () => {
        const [lower, upper] = bodyOf(2);
        const top = standingIn(upper);
        const under = standingIn(lower);
        registerOverlay(top);
        registerOverlay(under);
        expect(overlayAbove(under)).toBe(true);
        expect(overlayAbove(top)).toBe(false);
    });

    it('finds none once the one above has closed, nor for an overlay alone', () => {
        const [lower, upper] = bodyOf(2);
        const under = standingIn(lower);
        const top = standingIn(upper);
        registerOverlay(under);
        expect(overlayAbove(under)).toBe(false);
        registerOverlay(top);
        unregisterOverlay(top);
        expect(overlayAbove(under)).toBe(false);
    });

    it('does not count an overlay of another window\'s body, or one that stands nowhere', () => {
        const [here] = bodyOf(1);
        const [there] = bodyOf(1);
        const overlay = standingIn(here);
        registerOverlay(overlay);
        registerOverlay(standingIn(there));
        registerOverlay(standingIn(null));
        expect(overlayAbove(overlay)).toBe(false);
        expect(overlayAbove(standingIn(null))).toBe(false);
    });
});

describe('whenOverlaysOpened', () => {
    beforeEach(() => {
        closeAllOverlays();
    });

    /** An open overlay, opening until `opened` is called. */
    function openingOverlay(): { overlay: ClosableOverlay; opened: () => void } {
        let pending: Promise<void> | null = null;
        let opened = () => {};
        pending = new Promise<void>((resolve) => { opened = () => { pending = null; resolve(); }; });
        return { overlay: { close() {}, layer: () => null, opening: () => pending }, opened: () => opened() };
    }

    it('is null with no overlay opening, open ones among them', () => {
        expect(whenOverlaysOpened()).toBeNull();
        registerOverlay(fakeOverlay([], 'open'));
        expect(whenOverlaysOpened()).toBeNull();
    });

    it('settles once every overlay opening has opened', async () => {
        const a = openingOverlay();
        const b = openingOverlay();
        registerOverlay(a.overlay);
        registerOverlay(b.overlay);
        let done = false;
        void whenOverlaysOpened()!.then(() => { done = true; });
        a.opened();
        await Promise.resolve();
        await Promise.resolve();
        expect(done).toBe(false);
        b.opened();
        await new Promise((r) => setTimeout(r, 0));
        expect(done).toBe(true);
        expect(whenOverlaysOpened()).toBeNull();
    });

    it('does not count an overlay closed while it opened', () => {
        const a = openingOverlay();
        registerOverlay(a.overlay);
        expect(whenOverlaysOpened()).not.toBeNull();
        unregisterOverlay(a.overlay);
        expect(whenOverlaysOpened()).toBeNull();
    });
});
