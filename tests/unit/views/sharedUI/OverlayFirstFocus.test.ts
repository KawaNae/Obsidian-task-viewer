import { describe, it, expect } from 'vitest';
import { focusOnceOpen, type OpeningOverlay } from '../../../../src/views/sharedUI/OverlayShell';

/**
 * An overlay's first focus, as the shell puts it a frame after it opens
 * (`focusOnceOpen`): on the field the body names once the open animation
 * has stopped, on the panel until then.
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
    constructor(protected doc: MockDocument, private takes = true) {}
    focus(options?: FocusOptions) {
        if (!this.takes) return;
        this.focused.push(options ?? {});
        this.doc.activeElement = this;
    }
}

/** A text field: its text selected by `select`. */
class MockField extends MockFocusable {
    value = '名前';
    selected = false;
    select() { this.selected = true; }
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

function setup(opts: { animations?: MockAnimation[]; listsAnimations?: boolean } = {}) {
    const win = new MockWindow();
    const doc = new MockDocument();
    const root = opts.listsAnimations === false ? {} : Object.assign(new MockRoot(), { animations: opts.animations ?? [] });
    const panel = new MockFocusable(doc);
    const field = new MockField(doc);
    /** Another part of the surface: a button, another field. */
    const other = new MockFocusable(doc);
    const outside = new MockFocusable(doc);
    const state = { current: true, target: field as MockFocusable | null };
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
            state.target = new MockFocusable(doc as MockDocument, false);

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
});
