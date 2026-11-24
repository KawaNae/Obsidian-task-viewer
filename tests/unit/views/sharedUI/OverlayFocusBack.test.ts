import { describe, it, expect, afterEach } from 'vitest';
import { giveFocusBack, placeFirstFocus, type ClosingOverlay, type OpeningOverlay } from '../../../../src/views/sharedUI/OverlayShell';
import { closeAllOverlays } from '../../../../src/views/sharedUI/OverlayRegistry';
import { forgetMenus, menuShown } from '../../../../src/interaction/menu/MenusOnScreen';

/**
 * An overlay closing gives the focus back to what had it before it opened
 * (`giveFocusBack`): at once with nothing to wait for (a button, Escape, a
 * press outside), and once the plugin's menus have gone when one is still
 * on the screen (a menu's item closing the hub), the focus taken out of the
 * closing overlay meanwhile. An overlay opened meanwhile takes the focus.
 */

class MockDocument {
    body = new MockElement(this);
    activeElement: MockElement | null = this.body;
}

/** An element: it takes the focus, and lets it go to the body on a blur. */
class MockElement {
    isConnected = true;
    focused: FocusOptions[] = [];
    blurred = 0;
    constructor(readonly ownerDocument: MockDocument) {}
    focus(options?: FocusOptions) {
        this.focused.push(options ?? {});
        this.ownerDocument.activeElement = this;
    }
    blur() {
        this.blurred++;
        if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
    }
}

/** Let the promises the focus waits on settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
    const doc = new MockDocument();
    /** What had the focus before the overlay opened: the editor typed in. */
    const before = new MockElement(doc);
    /** A field of the closing overlay, holding the focus as it closes. */
    const field = new MockElement(doc);
    const outside = new MockElement(doc);
    field.focus();
    const closing: ClosingOverlay = {
        doc: doc as unknown as Document,
        before: before as unknown as Element,
        holds: (node) => node === (field as unknown),
    };
    return { doc, before, field, outside, close: () => giveFocusBack(closing) };
}

afterEach(() => {
    closeAllOverlays();
    forgetMenus();
});

describe('giveFocusBack', () => {
    it('gives the focus back at once with nothing to wait for, without scrolling', () => {
        const s = setup();
        s.close();
        expect(s.doc.activeElement).toBe(s.before);
        expect(s.before.focused).toEqual([{ preventScroll: true }]);
        expect(s.field.blurred).toBe(0);
    });

    it('waits for a menu still on the screen, the closing overlay\'s field let go of meanwhile', async () => {
        const s = setup();
        const gone = menuShown();
        s.close();
        expect(s.field.blurred).toBe(1);
        expect(s.doc.activeElement).toBe(s.doc.body);
        await flush();
        expect(s.before.focused).toEqual([]);

        gone();
        await flush();
        expect(s.doc.activeElement).toBe(s.before);
        expect(s.before.focused).toEqual([{ preventScroll: true }]);
    });

    it('does not give it back once an overlay opened meanwhile asks for its first focus', async () => {
        const s = setup();
        const gone = menuShown();
        s.close();

        const panel = new MockElement(s.doc);
        const next = new MockElement(s.doc);
        const opening: OpeningOverlay = {
            panel: panel as unknown as HTMLElement,
            doc: s.doc as unknown as Document,
            isCurrent: () => true,
            holds: (node) => node === (panel as unknown) || node === (next as unknown),
            target: () => ({ to: next }),
        };
        placeFirstFocus(opening);
        expect(s.doc.activeElement).toBe(panel);

        gone();
        await flush();
        expect(s.doc.activeElement).toBe(next);
        expect(s.before.focused).toEqual([]);
    });

    it('leaves a focus the user moved elsewhere meanwhile', async () => {
        const s = setup();
        const gone = menuShown();
        s.close();
        s.outside.focus();

        gone();
        await flush();
        expect(s.doc.activeElement).toBe(s.outside);
        expect(s.before.focused).toEqual([]);
    });

    it('gives nothing back to an element gone from the document', async () => {
        const s = setup();
        s.before.isConnected = false;
        s.close();
        expect(s.before.focused).toEqual([]);
        expect(s.doc.activeElement).toBe(s.field);
    });

    it('leaves a focus already outside the overlay as it closes (a note opened from it)', () => {
        const s = setup();
        s.outside.focus();
        s.close();
        expect(s.doc.activeElement).toBe(s.outside);
        expect(s.before.focused).toEqual([]);
    });
});
