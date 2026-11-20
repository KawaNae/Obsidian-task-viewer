import { describe, it, expect, beforeEach } from 'vitest';
import { stepBack, takeEscape, type ChildPopovers } from '../../../../src/views/sharedUI/OverlayShell';
import { closeAllOverlays, registerOverlay, unregisterOverlay, type ClosableOverlay } from '../../../../src/views/sharedUI/OverlayRegistry';

/**
 * Escape among overlays opened over one another, as OverlayShell routes it:
 * each open overlay listens on the document in the capture phase, in the
 * order it opened, and stands on the body in that order. The document, the
 * body and the event are stand-ins that keep only that: the listeners in
 * order, the layers' parent and next sibling, and whether the key was
 * stopped. An overlay's close unregisters it and stops its listening, as
 * OverlayShell's does.
 */

interface FakeNode { parentNode: FakeNode | null; nextSibling: FakeNode | null }
interface FakeKey { key: string; stopped: boolean; stopPropagation(): void }

class FakeDoc {
    private readonly body: FakeNode = { parentNode: null, nextSibling: null };
    private last: FakeNode | null = null;
    listeners: ((e: FakeKey) => void)[] = [];

    /** A layer put on the body after every one before it. */
    putLayer(): FakeNode {
        const layer: FakeNode = { parentNode: this.body, nextSibling: null };
        if (this.last) this.last.nextSibling = layer;
        this.last = layer;
        return layer;
    }

    /** A keydown, heard by the listeners in the order they were put on, as a document's capture phase is. */
    press(key: string): FakeKey {
        const e: FakeKey = { key, stopped: false, stopPropagation() { this.stopped = true; } };
        for (const listener of [...this.listeners]) {
            if (this.listeners.includes(listener)) listener(e);
        }
        return e;
    }
}

class StandInOverlay implements ClosableOverlay {
    private open = true;
    private readonly layerNode: FakeNode;
    private readonly listener: (e: FakeKey) => void;

    constructor(
        private readonly doc: FakeDoc,
        readonly name: string,
        private readonly log: string[],
        opts: { yieldsEscape?: () => boolean; childStack?: ChildPopovers } = {},
    ) {
        this.layerNode = doc.putLayer();
        this.listener = (e) => takeEscape(e as unknown as KeyboardEvent, this, opts.yieldsEscape, () =>
            stepBack(opts.childStack ?? null, () => this.close()));
        doc.listeners.push(this.listener);
        registerOverlay(this);
    }

    close(): void {
        if (!this.open) return;
        this.open = false;
        this.log.push(`${this.name} closed`);
        unregisterOverlay(this);
        this.doc.listeners = this.doc.listeners.filter(l => l !== this.listener);
    }

    layer(): Node | null {
        return this.open ? this.layerNode as unknown as Node : null;
    }
}

/** Child popovers of an overlay: open until closed. */
function childPopovers(log: string[]): ChildPopovers {
    let open = true;
    return {
        isOpen: () => open,
        closeAll: () => { if (open) log.push('child closed'); open = false; },
    };
}

beforeEach(() => {
    closeAllOverlays();
});

describe('takeEscape', () => {
    it('closes the top overlay alone, the one under staying open, and the next Escape closes the one under', () => {
        const doc = new FakeDoc();
        const log: string[] = [];
        new StandInOverlay(doc, 'hub', log);
        new StandInOverlay(doc, 'dialog', log);

        expect(doc.press('Escape').stopped).toBe(true);
        expect(log).toEqual(['dialog closed']);

        expect(doc.press('Escape').stopped).toBe(true);
        expect(log).toEqual(['dialog closed', 'hub closed']);
    });

    it('closes an overlay alone at once, and takes no other key', () => {
        const doc = new FakeDoc();
        const log: string[] = [];
        new StandInOverlay(doc, 'dialog', log);

        expect(doc.press('Enter').stopped).toBe(false);
        expect(log).toEqual([]);
        expect(doc.press('Escape').stopped).toBe(true);
        expect(log).toEqual(['dialog closed']);
    });

    it('leaves an Escape the top overlay\'s body takes to it, the one under closing neither', () => {
        const doc = new FakeDoc();
        const log: string[] = [];
        let editorList = true;
        new StandInOverlay(doc, 'hub', log);
        new StandInOverlay(doc, 'dialog', log, { yieldsEscape: () => editorList });

        expect(doc.press('Escape').stopped).toBe(false);
        expect(log).toEqual([]);

        editorList = false;
        doc.press('Escape');
        expect(log).toEqual(['dialog closed']);
    });

    it('closes the top overlay\'s child popover first, then the top overlay, the one under staying open', () => {
        const doc = new FakeDoc();
        const log: string[] = [];
        new StandInOverlay(doc, 'hub', log);
        new StandInOverlay(doc, 'filter', log, { childStack: childPopovers(log) });

        doc.press('Escape');
        expect(log).toEqual(['child closed']);
        doc.press('Escape');
        expect(log).toEqual(['child closed', 'filter closed']);
    });

    it('takes no Escape for the one under while the top overlay is asked and stays open', () => {
        const doc = new FakeDoc();
        const log: string[] = [];
        const hub = new StandInOverlay(doc, 'hub', log);
        // A top overlay that asks before it closes and is kept open: its close never runs.
        const kept = new StandInOverlay(doc, 'kept', log, { childStack: { isOpen: () => false, closeAll: () => {} } });
        kept.close = () => { log.push('kept asked'); };

        doc.press('Escape');
        expect(log).toEqual(['kept asked']);
        expect(hub.layer()).not.toBeNull();
    });
});

describe('stepBack', () => {
    it('closes the child popovers open, asking the overlay nothing, and asks the overlay once none is open', () => {
        const log: string[] = [];
        const children = childPopovers(log);
        stepBack(children, () => log.push('asked'));
        expect(log).toEqual(['child closed']);
        stepBack(children, () => log.push('asked'));
        stepBack(null, () => log.push('asked'));
        expect(log).toEqual(['child closed', 'asked', 'asked']);
    });
});
