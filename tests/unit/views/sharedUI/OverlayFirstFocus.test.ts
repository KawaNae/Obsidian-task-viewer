import { describe, it, expect, afterEach } from 'vitest';
import { placeFirstFocus, watchOpening, type FieldFocus, type OpeningOverlay, type SelectionOnFocus } from '../../../../src/views/sharedUI/OverlayShell';
import { closeAllOverlays, registerOverlay, type ClosableOverlay } from '../../../../src/views/sharedUI/OverlayRegistry';
import { forgetMenus, menuShown } from '../../../../src/interaction/menu/MenusOnScreen';

/**
 * An overlay's opening (`watchOpening`): until the frame after it opens,
 * then until the animations of its panel and its backdrop running then
 * have stopped. And its first focus at that frame (`placeFirstFocus`): on
 * the field the body names once the overlays have opened and the plugin's
 * menus have gone, on the panel until then, the field's text met as the
 * body says (all of it selected, or the caret after it).
 */

/** An animation in the overlay (the sheet sliding up), ended or cancelled by the test. */
class MockAnimation {
    playState: string;
    finished: Promise<MockAnimation>;
    private settle!: { end: () => void; cancel: () => void };
    constructor(private endTime = 150, playState = 'running') {
        this.playState = playState;
        this.finished = new Promise((resolve, reject) => {
            this.settle = {
                end: () => { this.playState = 'finished'; resolve(this); },
                cancel: () => { this.playState = 'idle'; reject(new Error('AbortError')); },
            };
        });
        this.finished.catch(() => {});
    }
    effect = { getComputedTiming: () => ({ endTime: this.endTime }) };
    end() { this.settle.end(); }
    cancel() { this.settle.cancel(); }
}

class MockDocument {
    activeElement: unknown = null;
}

/** What takes the focus: it becomes the document's active element, and says each time it did. */
class MockFocusable {
    focused: FocusOptions[] = [];
    constructor(readonly ownerDocument: MockDocument, private takes = true) {}
    focus(options?: FocusOptions) {
        if (!this.takes) return;
        this.focused.push(options ?? {});
        this.ownerDocument.activeElement = this;
    }
}

/** A text field: what of its text is selected, and how far it is scrolled in itself. */
class MockField extends MockFocusable {
    value = 'とても長い名前';
    /** Where the browser puts the caret of a field focused by script: at its start. */
    selectionStart: number | null = 0;
    selectionEnd: number | null = 0;
    scrollLeft = 0;
    scrollWidth = 480;
    scrollTop = 0;
    scrollHeight = 0;
    select() { this.setSelectionRange(0, this.value.length); }
    setSelectionRange(start: number, end: number) {
        this.selectionStart = start;
        this.selectionEnd = end;
    }
    get selected() { return this.selectionStart === 0 && this.selectionEnd === this.value.length; }
    get caretAtEnd() { return this.selectionStart === this.value.length && this.selectionEnd === this.value.length; }
}

/** A part of the overlay (its panel, its backdrop): the DOM lists what animates on it, and in it with `subtree`. */
class MockPart {
    animations: MockAnimation[] = [];
    /** What animates in what the part holds (a field's focus ring), listed only with `subtree`. */
    inside: MockAnimation[] = [];
    subtreeAsked: (boolean | undefined)[] = [];
    getAnimations(opts?: { subtree?: boolean }) {
        this.subtreeAsked.push(opts?.subtree);
        const listed = opts?.subtree ? [...this.animations, ...this.inside] : this.animations;
        return listed.filter((a) => a.playState !== 'finished' && a.playState !== 'idle');
    }
}

class MockWindow {
    private frames: (() => void)[] = [];
    requestAnimationFrame(fn: () => void) { this.frames.push(fn); return this.frames.length; }
    /** Run the frame asked for. */
    frame() {
        const due = this.frames;
        this.frames = [];
        for (const fn of due) fn();
    }
}

/** Let the promises the first focus waits on settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Whether `p` has settled, read after the promises settle. */
async function settled(p: Promise<void> | null): Promise<boolean> {
    if (p === null) return true;
    let done = false;
    void p.then(() => { done = true; });
    await flush();
    return done;
}

/** An overlay opening, as the registry sees it, until `opened()`. */
function standInOpening(): { opened: () => void } {
    let pending: Promise<void> | null = null;
    let opened = () => {};
    pending = new Promise<void>((resolve) => { opened = () => { pending = null; resolve(); }; });
    const overlay: ClosableOverlay = { close() {}, layer: () => null, opening: () => pending };
    registerOverlay(overlay);
    return { opened: () => opened() };
}

function setup(opts: { selection?: SelectionOnFocus } = {}) {
    const doc = new MockDocument();
    const panel = new MockFocusable(doc);
    const field = new MockField(doc);
    /** Another part of the surface: a button, another field. */
    const other = new MockFocusable(doc);
    const outside = new MockFocusable(doc);
    const state = { current: true, target: { to: field, selection: opts.selection ?? 'all' } as FieldFocus | null };
    const overlay: OpeningOverlay = {
        panel: panel as unknown as HTMLElement,
        doc: doc as unknown as Document,
        isCurrent: () => state.current,
        holds: (node) => node === (panel as unknown) || node === (field as unknown) || node === (other as unknown),
        target: () => state.target,
    };
    return { doc, panel, field, other, outside, state, place: () => placeFirstFocus(overlay) };
}

afterEach(() => {
    closeAllOverlays();
    forgetMenus();
});

describe('watchOpening', () => {
    function opening(parts: object[]) {
        const win = new MockWindow();
        const at: (Promise<void> | null)[] = [];
        const watch = watchOpening(win as unknown as Window, parts as unknown as Element[], () => at.push(watch.pending()));
        return { win, watch, at };
    }

    it('is opening from its opening to the frame after, whatever runs', () => {
        const { watch, at } = opening([new MockPart()]);
        expect(watch.pending()).not.toBeNull();
        expect(at).toEqual([]);
    });

    it('has opened by the frame\'s first focus when nothing runs on its parts then', () => {
        const { win, watch, at } = opening([new MockPart(), new MockPart()]);
        win.frame();
        expect(at).toEqual([null]);
        expect(watch.pending()).toBeNull();
    });

    it('waits for the animations running on its parts at the frame, ended or cancelled', async () => {
        const backdrop = Object.assign(new MockPart(), { animations: [new MockAnimation()] });
        const panel = Object.assign(new MockPart(), { animations: [new MockAnimation()] });
        const { win, watch, at } = opening([backdrop, panel]);
        win.frame();
        expect(at[0]).not.toBeNull();
        backdrop.animations[0].end();
        expect(await settled(watch.pending())).toBe(false);
        panel.animations[0].cancel();
        await flush();
        expect(watch.pending()).toBeNull();
    });

    it('lists the parts\' own animations, not those of what they hold (a field\'s focus ring)', () => {
        const panel = Object.assign(new MockPart(), { inside: [new MockAnimation()] });
        const { win, watch } = opening([panel]);
        win.frame();
        expect(panel.subtreeAsked).toEqual([false]);
        expect(watch.pending()).toBeNull();
    });

    it('does not wait for an animation started on a part once it has opened (the panel following the keyboard)', () => {
        const panel = new MockPart();
        const { win, watch } = opening([panel]);
        win.frame();
        panel.animations.push(new MockAnimation());
        expect(watch.pending()).toBeNull();
    });

    it('does not wait for an endless or a paused animation, nor where the DOM cannot list them', () => {
        const panel = Object.assign(new MockPart(), { animations: [new MockAnimation(Infinity), new MockAnimation(150, 'paused')] });
        const { win, watch } = opening([panel, {}]);
        win.frame();
        expect(watch.pending()).toBeNull();
    });

    it('has opened once ended (the overlay closed), whatever still runs', async () => {
        const panel = Object.assign(new MockPart(), { animations: [new MockAnimation()] });
        const { win, watch } = opening([panel]);
        const before = watch.pending();
        watch.end();
        expect(watch.pending()).toBeNull();
        expect(await settled(before)).toBe(true);
        win.frame();
        expect(watch.pending()).toBeNull();
    });
});

describe('placeFirstFocus', () => {
    describe('while an overlay opens', () => {
        it('focuses the panel, not the field, and the field once it has opened, its text selected', async () => {
            const opening = standInOpening();
            const { doc, panel, field, place } = setup();

            place();
            expect(doc.activeElement).toBe(panel);
            expect(panel.focused).toEqual([{ preventScroll: true }]);
            await flush();
            expect(field.focused).toEqual([]);

            opening.opened();
            await flush();
            expect(doc.activeElement).toBe(field);
            expect(field.focused).toEqual([{ preventScroll: true }]);
            expect(field.selected).toBe(true);
        });

        it('waits for every overlay opening', async () => {
            const first = standInOpening();
            const next = standInOpening();
            const { doc, panel, field, place } = setup();

            place();
            first.opened();
            await flush();
            expect(doc.activeElement).toBe(panel);

            next.opened();
            await flush();
            expect(doc.activeElement).toBe(field);
        });

        it('focuses nothing more when the overlay closed, or opened again, during the wait', async () => {
            const opening = standInOpening();
            const { doc, panel, field, state, place } = setup();

            place();
            state.current = false;
            opening.opened();
            await flush();

            expect(field.focused).toEqual([]);
            expect(panel.focused.length).toBe(1);
            expect(doc.activeElement).toBe(panel);
        });

        it('leaves the focus where the user moved it in the surface during the wait', async () => {
            const opening = standInOpening();
            const { doc, field, other, place } = setup();

            place();
            other.focus();
            opening.opened();
            await flush();

            expect(doc.activeElement).toBe(other);
            expect(field.focused).toEqual([]);
        });

        it('focuses the field when the focus went outside the surface during the wait', async () => {
            const opening = standInOpening();
            const { doc, field, outside, place } = setup();

            place();
            outside.focus();
            opening.opened();
            await flush();

            expect(doc.activeElement).toBe(field);
        });

        it('asks the body what to focus when the wait ends, and keeps the panel when it names nothing', async () => {
            const opening = standInOpening();
            const { doc, panel, state, place } = setup();

            place();
            state.target = null;
            opening.opened();
            await flush();

            expect(doc.activeElement).toBe(panel);
        });

        it('puts the caret after the text once opened, as the body asks', async () => {
            const opening = standInOpening();
            const { field, place } = setup({ selection: 'end' });
            place();
            opening.opened();
            await flush();
            expect(field.caretAtEnd).toBe(true);
        });
    });

    describe('while a menu of the plugin is on the screen', () => {
        it('focuses the panel, and the field once the menu has gone (a sheet sliding away)', async () => {
            const gone = menuShown();
            const { doc, panel, field, place } = setup();

            place();
            expect(doc.activeElement).toBe(panel);
            await flush();
            expect(field.focused).toEqual([]);

            gone();
            await flush();
            expect(doc.activeElement).toBe(field);
            expect(field.selected).toBe(true);
        });

        it('waits for the menu and the overlay opening alike', async () => {
            const gone = menuShown();
            const opening = standInOpening();
            const { doc, panel, field, place } = setup();

            place();
            opening.opened();
            await flush();
            expect(doc.activeElement).toBe(panel);

            gone();
            await flush();
            expect(doc.activeElement).toBe(field);
        });
    });

    describe('with nothing to wait for', () => {
        it('focuses the field at once, its text selected', () => {
            const { doc, panel, field, place } = setup();

            place();

            expect(doc.activeElement).toBe(field);
            expect(field.selected).toBe(true);
            expect(panel.focused).toEqual([]);
        });

        it('focuses the panel when the body names nothing', () => {
            const { doc, panel, state, place } = setup();
            state.target = null;

            place();

            expect(doc.activeElement).toBe(panel);
        });

        it('focuses the panel when what the body named does not take the focus (hidden, or disabled)', () => {
            const { doc, panel, state, place } = setup();
            state.target = { to: new MockFocusable(doc as MockDocument, false), selection: 'all' };

            place();

            expect(doc.activeElement).toBe(panel);
        });

        it('focuses nothing when the overlay closed before the frame', () => {
            const { doc, state, place } = setup();
            state.current = false;

            place();

            expect(doc.activeElement).toBeNull();
        });
    });

    describe('the field\'s text, as the body says', () => {
        it('selects all of it when the body asks it selected', () => {
            const { field, place } = setup({ selection: 'all' });
            place();
            expect(field.selected).toBe(true);
            expect(field.scrollLeft).toBe(0);
        });

        it('puts the caret after it, the field scrolled in itself to its end, when the body asks the caret at the end', () => {
            const { doc, panel, field, place } = setup({ selection: 'end' });
            place();
            expect(doc.activeElement).toBe(field);
            expect(field.caretAtEnd).toBe(true);
            expect(field.selected).toBe(false);
            expect(field.scrollLeft).toBe(field.scrollWidth);
            expect(field.focused).toEqual([{ preventScroll: true }]);
            expect(panel.focused).toEqual([]);
        });

        it('leaves the text as it is when the body says nothing of it (a button, an editor)', () => {
            const { doc, field, state, place } = setup();
            state.target = { to: field };
            place();
            expect(doc.activeElement).toBe(field);
            expect(field.selectionStart).toBe(0);
            expect(field.selectionEnd).toBe(0);
        });

        it('leaves a field with no caret (a native colour or date input) focused and as it is', () => {
            const { doc, field, place } = setup({ selection: 'end' });
            field.selectionStart = null;
            field.selectionEnd = null;
            place();
            expect(doc.activeElement).toBe(field);
            expect(field.selectionStart).toBeNull();
            expect(field.scrollLeft).toBe(0);
        });

        it('meets no text of a field that did not take the focus', () => {
            const { doc, panel, state, place } = setup();
            const hidden = new MockField(doc as MockDocument, false);
            state.target = { to: hidden, selection: 'end' };
            place();
            expect(doc.activeElement).toBe(panel);
            expect(hidden.selectionStart).toBe(0);
        });
    });
});
