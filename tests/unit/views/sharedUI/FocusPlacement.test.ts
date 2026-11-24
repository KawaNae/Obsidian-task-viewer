import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { placeFocusWith, type FocusWaits } from '../../../../src/views/sharedUI/FocusPlacement';
import { MENU_GONE_BOUND_MS, type MenusGone } from '../../../../src/interaction/menu/MenusOnScreen';

/**
 * The focus put on a field once the plugin's menus have gone and its
 * overlays have opened, at once with neither: timed as a phone's menu sheet
 * goes (about 435 ms) and an overlay opens (150 ms), on a fake clock.
 */

class MockDocument {
    activeElement: unknown = null;
    body = { name: 'body' };
}

/** What takes the focus: it becomes the document's active element, and says each time it did. */
class MockFocusable {
    focused: FocusOptions[] = [];
    isConnected = true;
    constructor(readonly ownerDocument: MockDocument) {}
    focus(options?: FocusOptions) {
        this.focused.push(options ?? {});
        this.ownerDocument.activeElement = this;
    }
}

/** A text field: whether all of its text is selected. */
class MockField extends MockFocusable {
    value = '名前';
    selectionStart: number | null = 0;
    selectionEnd: number | null = 0;
    select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
}

/** The waits, each settled by the test at a time on the fake clock. */
function waitsAt(opts: { menuGoneAt?: number | 'bound'; openedAt?: number }) {
    const log: string[] = [];
    const waits: FocusWaits = {
        menus: () => {
            if (opts.menuGoneAt === undefined) return null;
            const at = opts.menuGoneAt === 'bound' ? MENU_GONE_BOUND_MS : opts.menuGoneAt;
            const how: MenusGone = opts.menuGoneAt === 'bound' ? 'bound' : 'gone';
            return new Promise((resolve) => setTimeout(() => resolve(how), at));
        },
        overlays: () => (opts.openedAt === undefined ? null
            : new Promise<void>((resolve) => setTimeout(resolve, opts.openedAt))),
        now: () => Date.now(),
        log: (message) => log.push(message),
    };
    return { waits, log };
}

function setup() {
    const doc = new MockDocument();
    const field = new MockField(doc);
    const panel = new MockFocusable(doc);
    const other = new MockFocusable(doc);
    return { doc, field, panel, other };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('placeFocusWith', () => {
    it('puts the focus at once, in the caller\'s task, with nothing to wait for, and logs nothing', () => {
        const { doc, field } = setup();
        const { waits, log } = waitsAt({});
        expect(placeFocusWith(waits, { to: field, selection: 'all' })).toBe(true);
        expect(doc.activeElement).toBe(field);
        expect(field.selectionEnd).toBe(field.value.length);
        expect(log).toEqual([]);
    });

    it('waits for the menu to go (435 ms, a sheet sliding away)', async () => {
        const { doc, field } = setup();
        const { waits, log } = waitsAt({ menuGoneAt: 435 });
        expect(placeFocusWith(waits, { to: field })).toBe(false);
        await vi.advanceTimersByTimeAsync(434);
        expect(doc.activeElement).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        expect(doc.activeElement).toBe(field);
        expect(log).toEqual(['[kb] focus placed after=435ms menus=435ms opening=-']);
    });

    it('waits for the overlays to open (150 ms)', async () => {
        const { doc, field } = setup();
        const { waits, log } = waitsAt({ openedAt: 150 });
        placeFocusWith(waits, { to: field });
        await vi.advanceTimersByTimeAsync(149);
        expect(doc.activeElement).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        expect(doc.activeElement).toBe(field);
        expect(log).toEqual(['[kb] focus placed after=150ms menus=- opening=150ms']);
    });

    it('waits for both, the later of them', async () => {
        const { doc, field } = setup();
        const { waits, log } = waitsAt({ menuGoneAt: 435, openedAt: 150 });
        placeFocusWith(waits, { to: field });
        await vi.advanceTimersByTimeAsync(150);
        expect(doc.activeElement).toBeNull();
        await vi.advanceTimersByTimeAsync(285);
        expect(doc.activeElement).toBe(field);
        expect(log).toEqual(['[kb] focus placed after=435ms menus=435ms opening=150ms']);
    });

    it('puts the focus at the bound when the menu is not told gone, and logs that the bound was reached', async () => {
        const { doc, field } = setup();
        const { waits, log } = waitsAt({ menuGoneAt: 'bound' });
        placeFocusWith(waits, { to: field });
        await vi.advanceTimersByTimeAsync(MENU_GONE_BOUND_MS);
        expect(doc.activeElement).toBe(field);
        expect(log).toEqual([`[kb] focus placed after=${MENU_GONE_BOUND_MS}ms menus=${MENU_GONE_BOUND_MS}ms (bound) opening=-`]);
    });

    it('gives the focus options to the field as they are, at once and after a wait', async () => {
        const { field } = setup();
        placeFocusWith(waitsAt({}).waits, { to: field }, { focusOptions: { preventScroll: true } });
        placeFocusWith(waitsAt({ menuGoneAt: 10 }).waits, { to: field }, { focusOptions: { preventScroll: false } });
        await vi.advanceTimersByTimeAsync(10);
        expect(field.focused).toEqual([{ preventScroll: true }, { preventScroll: false }]);
    });

    describe('the last ask in a document wins', () => {
        it('drops an ask still waiting when a later one comes', async () => {
            const { doc, field, other } = setup();
            const { waits, log } = waitsAt({ menuGoneAt: 435 });
            placeFocusWith(waits, { to: field });
            placeFocusWith(waits, { to: other });
            await vi.advanceTimersByTimeAsync(435);
            expect(doc.activeElement).toBe(other);
            expect(field.focused).toEqual([]);
            expect(log[0]).toMatch(/^\[kb\] focus superseded /);
        });

        it('drops an ask still waiting when a later one is put at once', async () => {
            const { doc, field, other } = setup();
            placeFocusWith(waitsAt({ menuGoneAt: 435 }).waits, { to: field });
            placeFocusWith(waitsAt({}).waits, { to: other });
            await vi.advanceTimersByTimeAsync(435);
            expect(doc.activeElement).toBe(other);
            expect(field.focused).toEqual([]);
        });

        it('keeps an ask of another document', async () => {
            const { field } = setup();
            const elsewhere = setup();
            placeFocusWith(waitsAt({ menuGoneAt: 435 }).waits, { to: field });
            placeFocusWith(waitsAt({}).waits, { to: elsewhere.field });
            await vi.advanceTimersByTimeAsync(435);
            expect(field.ownerDocument.activeElement).toBe(field);
        });
    });

    describe('once the wait has ended', () => {
        it('puts no focus on a field gone from the document', async () => {
            const { doc, field } = setup();
            const { waits, log } = waitsAt({ menuGoneAt: 435 });
            placeFocusWith(waits, { to: field });
            field.isConnected = false;
            await vi.advanceTimersByTimeAsync(435);
            expect(doc.activeElement).toBeNull();
            expect(log[0]).toMatch(/^\[kb\] focus field gone /);
        });

        it('puts no focus once the user moved it elsewhere', async () => {
            const { doc, field, other } = setup();
            const { waits, log } = waitsAt({ menuGoneAt: 435 });
            placeFocusWith(waits, { to: field });
            other.focus();
            await vi.advanceTimersByTimeAsync(435);
            expect(doc.activeElement).toBe(other);
            expect(field.focused).toEqual([]);
            expect(log[0]).toMatch(/^\[kb\] focus not wanted /);
        });

        it('puts the focus when it went to nothing (the document\'s body) meanwhile', async () => {
            const { doc, field, other } = setup();
            other.focus();
            placeFocusWith(waitsAt({ menuGoneAt: 435 }).waits, { to: field });
            doc.activeElement = doc.body;
            await vi.advanceTimersByTimeAsync(435);
            expect(doc.activeElement).toBe(field);
        });

        it('asks the caller whether it is still wanted, where the caller says', async () => {
            const { doc, field, other } = setup();
            let wanted = true;
            placeFocusWith(waitsAt({ menuGoneAt: 435 }).waits, { to: field }, { stillWanted: () => wanted });
            other.focus();
            await vi.advanceTimersByTimeAsync(435);
            expect(doc.activeElement).toBe(field);

            wanted = false;
            placeFocusWith(waitsAt({ menuGoneAt: 435 }).waits, { to: other }, { stillWanted: () => wanted });
            await vi.advanceTimersByTimeAsync(435);
            expect(doc.activeElement).toBe(field);
        });
    });

    describe('what holds the focus while it waits', () => {
        it('holds the focus on what the caller names, which raises no keyboard, until the field takes it', async () => {
            const { doc, field, panel } = setup();
            placeFocusWith(waitsAt({ openedAt: 150 }).waits, { to: field }, { hold: panel });
            expect(doc.activeElement).toBe(panel);
            expect(panel.focused).toEqual([{ preventScroll: true }]);
            await vi.advanceTimersByTimeAsync(150);
            expect(doc.activeElement).toBe(field);
        });

        it('does not take the focus from the field with nothing to wait for', () => {
            const { doc, field, panel } = setup();
            placeFocusWith(waitsAt({}).waits, { to: field }, { hold: panel });
            expect(panel.focused).toEqual([]);
            expect(doc.activeElement).toBe(field);
        });
    });
});
