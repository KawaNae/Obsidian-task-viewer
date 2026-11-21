import { describe, it, expect } from 'vitest';
import { focusOnceOpen, type FieldFocus, type OpeningOverlay, type SelectionOnFocus } from '../../../../src/views/sharedUI/OverlayShell';

/**
 * An overlay's first focus, as the shell puts it a frame after it opens
 * (`focusOnceOpen`): on the field the body names once the open animation
 * has stopped, on the panel until then, the field's text met as the body
 * says (all of it selected, or the caret after it).
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

/** The overlay's root: the DOM lists what animates in it, unless it cannot (`getAnimations`). */
class MockRoot {
    animations: MockAnimation[] = [];
    subtreeAsked: boolean | undefined;
    getAnimations(opts?: { subtree?: boolean }) {
        this.subtreeAsked = opts?.subtree;
        return this.animations.filter((a) => a.playState !== 'finished' && a.playState !== 'idle');
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

function setup(opts: { animations?: MockAnimation[]; listsAnimations?: boolean; selection?: SelectionOnFocus } = {}) {
    const win = new MockWindow();
    const doc = new MockDocument();
    const root = opts.listsAnimations === false ? {} : Object.assign(new MockRoot(), { animations: opts.animations ?? [] });
    const panel = new MockFocusable(doc);
    const field = new MockField(doc);
    /** Another part of the surface: a button, another field. */
    const other = new MockFocusable(doc);
    const outside = new MockFocusable(doc);
    const state = { current: true, target: { to: field, selection: opts.selection ?? 'all' } as FieldFocus | null };
    const overlay: OpeningOverlay = {
        root: root as unknown as Element,
        panel: panel as unknown as HTMLElement,
        doc: doc as unknown as Document,
        isCurrent: () => state.current,
        holds: (node) => node === (panel as unknown) || node === (field as unknown) || node === (other as unknown),
        target: () => state.target,
    };
    focusOnceOpen(win as unknown as Window, overlay);
    return { win, doc, root, panel, field, other, outside, state };
}

describe('focusOnceOpen', () => {
    it('focuses nothing before the frame after the overlay opens', () => {
        const { doc } = setup();
        expect(doc.activeElement).toBeNull();
    });

    describe('while the open animation runs', () => {
        it('focuses the panel at the frame, not the field, and the field once the animation has ended, its text selected', async () => {
            const slide = new MockAnimation();
            const { win, doc, root, panel, field } = setup({ animations: [slide] });

            win.frame();
            expect(doc.activeElement).toBe(panel);
            expect(panel.focused).toEqual([{ preventScroll: true }]);
            expect((root as MockRoot).subtreeAsked).toBe(true);
            await flush();
            expect(field.focused).toEqual([]);

            slide.end();
            await flush();
            expect(doc.activeElement).toBe(field);
            expect(field.focused).toEqual([{ preventScroll: true }]);
            expect(field.selected).toBe(true);
        });

        it('waits for every animation running in the overlay (the backdrop fading, the panel popping in)', async () => {
            const fade = new MockAnimation();
            const pop = new MockAnimation();
            const { win, doc, panel, field } = setup({ animations: [fade, pop] });

            win.frame();
            fade.end();
            await flush();
            expect(doc.activeElement).toBe(panel);

            pop.end();
            await flush();
            expect(doc.activeElement).toBe(field);
        });

        it('focuses the field after an animation cancelled (the sheet dragged by its handle)', async () => {
            const slide = new MockAnimation();
            const { win, doc, field } = setup({ animations: [slide] });

            win.frame();
            slide.cancel();
            await flush();

            expect(doc.activeElement).toBe(field);
            expect(field.selected).toBe(true);
        });

        it('focuses nothing more when the overlay closed, or opened again, during the wait', async () => {
            const slide = new MockAnimation();
            const { win, doc, panel, field, state } = setup({ animations: [slide] });

            win.frame();
            state.current = false;
            slide.end();
            await flush();

            expect(field.focused).toEqual([]);
            expect(panel.focused.length).toBe(1);
            expect(doc.activeElement).toBe(panel);
        });

        it('leaves the focus where the user moved it in the surface during the wait', async () => {
            const slide = new MockAnimation();
            const { win, doc, field, other } = setup({ animations: [slide] });

            win.frame();
            other.focus();
            slide.end();
            await flush();

            expect(doc.activeElement).toBe(other);
            expect(field.focused).toEqual([]);
        });

        it('focuses the field when the focus went outside the surface during the wait', async () => {
            const slide = new MockAnimation();
            const { win, doc, field, outside } = setup({ animations: [slide] });

            win.frame();
            outside.focus();
            slide.end();
            await flush();

            expect(doc.activeElement).toBe(field);
        });

        it('asks the body what to focus when the wait ends, and keeps the panel when it names nothing', async () => {
            const slide = new MockAnimation();
            const { win, doc, panel, state } = setup({ animations: [slide] });

            win.frame();
            state.target = null;
            slide.end();
            await flush();

            expect(doc.activeElement).toBe(panel);
        });
    });

    describe('with no open animation', () => {
        it('focuses the field at the frame, its text selected, when no animation runs, an endless or paused one among them', () => {
            const spinner = new MockAnimation(Infinity);
            const paused = new MockAnimation(150, 'paused');
            const { win, doc, panel, field } = setup({ animations: [spinner, paused] });

            win.frame();

            expect(doc.activeElement).toBe(field);
            expect(field.selected).toBe(true);
            expect(panel.focused).toEqual([]);
        });

        it('focuses the field at the frame where the DOM cannot list the animations', () => {
            const { win, doc, panel, field } = setup({ listsAnimations: false });

            win.frame();

            expect(doc.activeElement).toBe(field);
            expect(field.selected).toBe(true);
            expect(panel.focused).toEqual([]);
        });

        it('focuses the panel when the body names nothing', () => {
            const { win, doc, panel, state } = setup();
            state.target = null;

            win.frame();

            expect(doc.activeElement).toBe(panel);
        });

        it('focuses the panel when what the body named does not take the focus (hidden, or disabled)', () => {
            const { win, doc, panel, state } = setup();
            state.target = { to: new MockFocusable(doc as MockDocument, false), selection: 'all' };

            win.frame();

            expect(doc.activeElement).toBe(panel);
        });

        it('focuses nothing when the overlay closed before the frame', () => {
            const { win, doc, state } = setup();
            state.current = false;

            win.frame();

            expect(doc.activeElement).toBeNull();
        });
    });

    describe('the field\'s text, as the body says', () => {
        it('selects all of it when the body asks it selected', () => {
            const { win, field } = setup({ selection: 'all' });
            win.frame();
            expect(field.selected).toBe(true);
            expect(field.scrollLeft).toBe(0);
        });

        it('puts the caret after it, the field scrolled in itself to its end, when the body asks the caret at the end', () => {
            const { win, doc, panel, field } = setup({ selection: 'end' });
            win.frame();
            expect(doc.activeElement).toBe(field);
            expect(field.caretAtEnd).toBe(true);
            expect(field.selected).toBe(false);
            expect(field.scrollLeft).toBe(field.scrollWidth);
            expect(field.focused).toEqual([{ preventScroll: true }]);
            expect(panel.focused).toEqual([]);
        });

        it('puts the caret after it once the open animation has stopped', async () => {
            const slide = new MockAnimation();
            const { win, field } = setup({ animations: [slide], selection: 'end' });
            win.frame();
            slide.end();
            await flush();
            expect(field.caretAtEnd).toBe(true);
        });

        it('leaves the text as it is when the body says nothing of it (a button, an editor)', () => {
            const { win, doc, field, state } = setup();
            state.target = { to: field };
            win.frame();
            expect(doc.activeElement).toBe(field);
            expect(field.selectionStart).toBe(0);
            expect(field.selectionEnd).toBe(0);
        });

        it('leaves a field with no caret (a native colour or date input) focused and as it is', () => {
            const { win, doc, field } = setup({ selection: 'end' });
            field.selectionStart = null;
            field.selectionEnd = null;
            win.frame();
            expect(doc.activeElement).toBe(field);
            expect(field.selectionStart).toBeNull();
            expect(field.scrollLeft).toBe(0);
        });

        it('meets no text of a field that did not take the focus', () => {
            const { win, doc, panel, state } = setup();
            const hidden = new MockField(doc as MockDocument, false);
            state.target = { to: hidden, selection: 'end' };
            win.frame();
            expect(doc.activeElement).toBe(panel);
            expect(hidden.selectionStart).toBe(0);
        });
    });
});
