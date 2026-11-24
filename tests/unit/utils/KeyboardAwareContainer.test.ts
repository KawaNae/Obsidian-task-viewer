import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { KeyboardAwareContainer } from '../../../src/utils/KeyboardAwareContainer';
import { untrackAllKeyboards } from '../../../src/utils/KeyboardWatch';

// Where the body stands once things have come to rest under the keyboard is
// seen in BodyOverKeyboard.test.ts. What is here is how this part comes to
// it: the waits it lists animations for, and the listeners it registers.

/**
 * KeyboardAwareContainer's `activeInput()`/focus handler do
 * `instanceof HTMLInputElement` / `instanceof HTMLTextAreaElement` checks.
 * Vitest's `node` environment has no DOM, so those globals don't exist —
 * defining them only for this file (restored in afterAll) avoids touching
 * the shared vitest setup or any other test file.
 */
class MockInputElement {}
class MockTextAreaElement {}
let savedHTMLInputElement: unknown;
let savedHTMLTextAreaElement: unknown;

beforeAll(() => {
    savedHTMLInputElement = (globalThis as any).HTMLInputElement;
    savedHTMLTextAreaElement = (globalThis as any).HTMLTextAreaElement;
    (globalThis as any).HTMLInputElement = MockInputElement;
    (globalThis as any).HTMLTextAreaElement = MockTextAreaElement;
});
afterAll(() => {
    (globalThis as any).HTMLInputElement = savedHTMLInputElement;
    (globalThis as any).HTMLTextAreaElement = savedHTMLTextAreaElement;
});

// --- Minimal DOM shims (plain-object pattern, mirrors ScheduleGridRenderer.test.ts) ---

class MiniEventTarget {
    private listeners = new Map<string, Set<(e?: any) => void>>();
    addEventListener(type: string, fn: (e?: any) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
    }
    removeEventListener(type: string, fn: (e?: any) => void) {
        this.listeners.get(type)?.delete(fn);
    }
    listenerCount(type: string): number {
        return this.listeners.get(type)?.size ?? 0;
    }
    dispatch(type: string, e?: any) {
        for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
    }
}

class MockPanel extends MiniEventTarget {
    style: { height: string; maxHeight: string; paddingBottom: string } = { height: '', maxHeight: '', paddingBottom: '' };
    scrollTop = 0;
    /** No scroll room beyond what is shown, unless a test gives some. */
    scrollHeight = 400;
    clientHeight = 400;
    rectHeight = 400;
    computedPaddingBottom = 0;
    /** Where the body's visible area ends: at the window's bottom (the box, the keyboard covering it), unless a test lifts it (the sheet). */
    rectBottom = 800;
    lastScrollBy: { top: number } | null = null;
    lastScrollTo: { top: number } | null = null;
    getBoundingClientRect() { return { height: this.rectHeight, bottom: this.rectBottom, top: 0 } as DOMRect; }
    scrollBy(opts: { top: number; behavior?: string }) { this.scrollTop += opts.top; this.lastScrollBy = opts; }
    scrollTo(opts: { top: number; behavior?: string }) { this.scrollTop = opts.top; this.lastScrollTo = opts; }
}

class MockInput extends MockInputElement {
    bottom: number;
    constructor(bottom: number) { super(); this.bottom = bottom; }
    getBoundingClientRect() { return { bottom: this.bottom, top: 0, height: 0 } as DOMRect; }
}

class MockVisualViewport extends MiniEventTarget {
    height: number;
    offsetTop: number;
    constructor(height: number, offsetTop = 0) { super(); this.height = height; this.offsetTop = offsetTop; }
}

/** A text node in an editable field, and where its caret stands when the selection's focus is in it. */
class MockText {
    nodeType = 3;
    constructor(public parentElement: MockEditable, public caretBottom: number | null) {}
}

/** An editable element (a CodeMirror editor's content), much taller than the caret line in it. */
class MockEditable {
    nodeType = 1;
    isContentEditable = true;
    ownerDocument: MockDocument;
    parentElement = null;
    constructor(doc: MockDocument, public bottom: number) { this.ownerDocument = doc; }
    contains(node: any) { return node === this || node?.parentElement === this; }
    getBoundingClientRect() { return { bottom: this.bottom, top: 0, height: this.bottom } as DOMRect; }
}

class MockDocument extends MiniEventTarget {
    activeElement: any = null;
    selection: { focusNode: any; focusOffset: number } | null = null;
    getSelection() { return this.selection; }
    createRange() {
        let node: any = null;
        return {
            setStart(n: any) { node = n; },
            collapse() {},
            getClientRects() {
                const bottom = node?.caretBottom ?? null;
                return bottom === null ? [] : [{ bottom, top: bottom - 20, height: 20 }];
            },
        };
    }
}

/** The container's inline style, as far as the CSS variables set on it. */
class MockStyle {
    vars = new Map<string, string>();
    setProperty(name: string, value: string) { this.vars.set(name, value); }
    removeProperty(name: string) { this.vars.delete(name); }
}

class MockContainer extends MiniEventTarget {
    ownerDocument = new MockDocument();
    style = new MockStyle();
    overlap() { return this.style.vars.get('--tv-keyboard-overlap'); }
    private children = new Set<any>();
    adopt(el: any) { this.children.add(el); }
    contains(el: any) { return this.children.has(el); }
}

/** An animation in the container (the sheet sliding up), ended or cancelled by the test. */
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

/** A container whose DOM lists its animations (`getAnimations`). */
class AnimatedContainer extends MockContainer {
    animations: MockAnimation[] = [];
    subtreeAsked: boolean | undefined;
    getAnimations(opts?: { subtree?: boolean }) {
        this.subtreeAsked = opts?.subtree;
        return this.animations.filter((a) => a.playState !== 'finished' && a.playState !== 'idle');
    }
}

/** Let the promises the container waits on settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class MockWindow extends MiniEventTarget {
    innerHeight = 800;
    visualViewport: MockVisualViewport | undefined;
    getComputedStyle(panel: MockPanel) {
        return { paddingBottom: `${panel.computedPaddingBottom}px` } as CSSStyleDeclaration;
    }
}

function setup(opts: { withVisualViewport?: boolean; vvHeight?: number } = {}) {
    const win = new MockWindow();
    if (opts.withVisualViewport !== false) {
        win.visualViewport = new MockVisualViewport(opts.vvHeight ?? win.innerHeight);
    }
    const container = new MockContainer();
    const panel = new MockPanel();
    const kac = new KeyboardAwareContainer(container as any, win as any, panel as any);
    return { win, container, panel, kac };
}

/** A container whose sheet is sliding up (one animation running), with a field focused in it. */
function setupAnimated(fieldBottom: number, ...animations: MockAnimation[]) {
    const win = new MockWindow();
    win.visualViewport = new MockVisualViewport(800);
    const container = new AnimatedContainer();
    container.animations = animations;
    const panel = new MockPanel();
    const scrolls: number[] = [];
    const scrollBy = panel.scrollBy.bind(panel);
    panel.scrollBy = (o) => { scrolls.push(o.top); scrollBy(o); };
    const input = new MockInput(fieldBottom);
    container.adopt(input);
    container.ownerDocument.activeElement = input;
    const kac = new KeyboardAwareContainer(container as any, win as any, panel as any);
    kac.attach();
    const openKeyboard = () => {
        win.visualViewport!.height = 500; // keyboardTop 500
        win.visualViewport!.dispatch('resize');
    };
    return { win, container, panel, scrolls, input, kac, openKeyboard };
}

describe('KeyboardAwareContainer', () => {
    afterEach(() => {
        untrackAllKeyboards(); // KeyboardWatch's map of the windows listened to is not GC'd between tests
        vi.useRealTimers();
    });

    describe('editable fields (contenteditable)', () => {
        function editable(fieldBottom: number, caretBottom: number | null) {
            const env = setup({ vvHeight: 800 });
            const doc = env.container.ownerDocument;
            const field = new MockEditable(doc, fieldBottom);
            const text = new MockText(field, caretBottom);
            doc.activeElement = field;
            doc.selection = { focusNode: text, focusOffset: 0 };
            env.container.adopt(field);
            return { ...env, doc, field, text };
        }

        it('stops following the selection once detached', () => {
            const { doc, kac } = editable(1400, 300);
            kac.attach();
            expect(doc.listenerCount('selectionchange')).toBe(1);

            kac.detach();

            expect(doc.listenerCount('selectionchange')).toBe(0);
        });
    });

    describe('the user scrolling the body while the keyboard is open', () => {
        it('stops listening to the gestures once detached', () => {
            const { panel, kac } = setup({ vvHeight: 800 });
            kac.attach();
            expect(panel.listenerCount('wheel')).toBe(1);
            expect(panel.listenerCount('touchmove')).toBe(1);

            kac.detach();

            expect(panel.listenerCount('wheel')).toBe(0);
            expect(panel.listenerCount('touchmove')).toBe(0);
        });
    });

    describe('measuring once the container has settled', () => {
        it('measures once for every ask made during the wait (the keyboard\'s events, a focus, the caret)', async () => {
            vi.useFakeTimers();
            const slide = new MockAnimation();
            const { win, container, scrolls, input, openKeyboard } = setupAnimated(871, slide);

            openKeyboard();
            win.dispatch('keyboardWillShow', { keyboardHeight: 300 });
            container.dispatch('focusin', { target: input });
            vi.advanceTimersByTime(50);
            container.ownerDocument.dispatch('selectionchange');
            input.bottom = 557;
            slide.end();
            await vi.runAllTimersAsync();

            expect(scrolls).toEqual([67]);
        });

        it('waits for every animation running in the container (the backdrop fading, the panel sliding)', async () => {
            const fade = new MockAnimation();
            const slide = new MockAnimation();
            const { panel, input, openKeyboard } = setupAnimated(871, fade, slide);

            openKeyboard();
            fade.end();
            await flush();
            expect(panel.lastScrollBy).toBeNull();

            input.bottom = 557;
            slide.end();
            await flush();
            expect(panel.lastScrollBy).toEqual({ top: 67, behavior: 'instant' });
        });

        it('measures after an animation cancelled (the sheet dragged by its handle)', async () => {
            const slide = new MockAnimation();
            const { panel, input, openKeyboard } = setupAnimated(871, slide);

            openKeyboard();
            input.bottom = 557;
            slide.cancel();
            await flush();

            expect(panel.lastScrollBy).toEqual({ top: 67, behavior: 'instant' });
        });

        it('measures at once when no animation runs, an endless one among them', () => {
            const spinner = new MockAnimation(Infinity);
            const paused = new MockAnimation(150, 'paused');
            const { panel, openKeyboard } = setupAnimated(557, spinner, paused);

            openKeyboard();

            expect(panel.lastScrollBy).toEqual({ top: 67, behavior: 'instant' });
        });
    });

    describe('measuring once what started during the wait has stopped too', () => {
        /**
         * The low sheet of a dialog that focuses its field as it opens, in a
         * 978px-tall window, on the native keyboard's events, as laid out
         * midway through the overlap's transition: the body from 729 to 863
         * (134px), the field's bottom at 789. At rest the body ends at 640,
         * above the keyboard's top (978 - 288 = 690), the field's bottom at 566.
         */
        function setupLowSheet() {
            const win = new MockWindow();
            win.innerHeight = 978;
            const container = new AnimatedContainer();
            const panel = new MockPanel();
            panel.rectBottom = 863;
            panel.rectHeight = 134;
            panel.scrollHeight = 134;
            panel.clientHeight = 134;
            const scrolls: number[] = [];
            const scrollBy = panel.scrollBy.bind(panel);
            panel.scrollBy = (o) => { scrolls.push(o.top); scrollBy(o); };
            const input = new MockInput(789);
            container.adopt(input);
            container.ownerDocument.activeElement = input;
            const kac = new KeyboardAwareContainer(container as any, win as any, panel as any);
            kac.attach();
            const settle = () => {
                panel.rectBottom = 640;
                input.bottom = 566;
            };
            return { win, container, panel, scrolls, input, kac, settle };
        }

        it('waits for the overlap\'s transition that took over from one cancelled', async () => {
            const toFirst = new MockAnimation(250);
            const { win, container, panel, scrolls, settle } = setupLowSheet();
            container.animations.push(toFirst);

            win.dispatch('keyboardWillShow', { keyboardHeight: 300 });
            const toSecond = new MockAnimation(250);
            container.animations.push(toSecond);
            win.dispatch('keyboardDidShow', { keyboardHeight: 288 });
            toFirst.cancel();
            await flush();
            expect(scrolls).toEqual([]);

            settle();
            toSecond.end();
            await flush();

            expect(scrolls).toEqual([]);
            expect(panel.style.paddingBottom).toBe('');
        });

        it('stops waiting when the keyboard closes, and waits afresh when it opens again', async () => {
            const first = new MockAnimation(250);
            const { win, container, input, scrolls, openKeyboard } = setupAnimated(871, first);

            openKeyboard();
            win.visualViewport!.height = 800;
            win.visualViewport!.dispatch('resize');
            const second = new MockAnimation(250);
            container.animations.push(second);
            openKeyboard(); // a wait of its own, not joined to the one given up
            first.end();
            await flush();
            expect(scrolls).toEqual([]);

            input.bottom = 557;
            second.end();
            await flush();
            expect(scrolls).toEqual([67]);
        });

        it('stops waiting when the container detaches, whatever starts afterwards', async () => {
            const first = new MockAnimation(250);
            const { container, input, scrolls, kac, openKeyboard } = setupAnimated(871, first);

            openKeyboard();
            kac.detach();
            const closing = new MockAnimation(150);
            container.animations.push(closing);
            input.bottom = 557;
            first.end();
            closing.end();
            await flush();

            expect(scrolls).toEqual([]);
        });
    });

    describe('detach', () => {
        it('removes every listener it registered in attach(), the window\'s keyboard staying listened to', () => {
            const { win, container, kac } = setup({ vvHeight: 800 });
            kac.attach();
            // KeyboardWatch listens to the window once, for every part that follows it.
            expect(win.visualViewport!.listenerCount('resize')).toBe(1);
            expect(win.visualViewport!.listenerCount('scroll')).toBe(1);
            expect(win.listenerCount('keyboardWillShow')).toBe(1);
            expect(container.listenerCount('focusin')).toBe(1);
            expect(container.listenerCount('focusout')).toBe(1);

            kac.detach();

            // The window is let go only by untrackAllKeyboards (the plugin unloading).
            expect(win.visualViewport!.listenerCount('resize')).toBe(1);
            expect(win.listenerCount('keyboardWillShow')).toBe(1);
            expect(container.listenerCount('focusin')).toBe(0);
            expect(container.listenerCount('focusout')).toBe(0);
        });
    });
});
