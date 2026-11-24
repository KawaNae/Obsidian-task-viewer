import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { KeyboardAwareContainer } from '../../../src/utils/KeyboardAwareContainer';
import { trackKeyboard, untrackAllKeyboards } from '../../../src/utils/KeyboardWatch';

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

    describe('visualViewport-based detection', () => {
        it('locks the body\'s height, pads what it lacks and scrolls it, when the keyboard covers the body and the focused input (the box)', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750); // near the bottom of an 800px-tall screen
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 500; // 300px keyboard
            win.visualViewport!.dispatch('resize');

            // keyboardTop = offsetTop(0) + height(500) = 500; overshoot = 750 - 500 + 10 = 260
            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
            expect(panel.style.paddingBottom).toBe('260px');
            expect(panel.style.height).toBe('400px'); // locked at the body's height as it was measured
            expect(panel.style.maxHeight).toBe('400px'); // and bounded there, a flex item taking no height
        });

        it('scrolls by the body\'s visible bottom where it ends above the keyboard (the sheet), padding nothing and locking no height', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(450);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.rectBottom = 420; // the row of buttons stands under the body, above the keyboard
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            // 450 - 420 + 10 = 40, though the field is above the keyboard's top (500)
            expect(panel.lastScrollBy).toEqual({ top: 40, behavior: 'instant' });
            expect(panel.style.paddingBottom).toBe('');
            expect(panel.style.height).toBe('');
            expect(panel.style.maxHeight).toBe('');
        });

        it('does nothing to a body the keyboard covers while the focused input is above the keyboard (the box\'s first field)', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(200);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toBeNull();
            expect(panel.style.paddingBottom).toBe('');
            expect(panel.style.height).toBe('');
        });

        it('does nothing when the focused input does not overlap the keyboard', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(100); // well above where the keyboard will sit
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toBeNull();
            expect(panel.style.paddingBottom).toBe('');
        });

        it('does not treat a viewport shrink of less than a pixel as the keyboard opening', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(795);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 799.4; // what a zoom leaves between the two heights
            win.visualViewport!.dispatch('resize');

            expect(container.overlap()).toBeUndefined();
            expect(panel.lastScrollBy).toBeNull();
        });

        it('treats a viewport shrink of a pixel as the keyboard opening, and measures', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(795); // 4px above where the keyboard's top comes
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 799;
            win.visualViewport!.dispatch('resize');

            expect(container.overlap()).toBe('1px');
            expect(kac.keyboardOverlap()).toBe(1);
            // The field is kept 10px above the keyboard's top: 795 - 799 + 10.
            expect(panel.lastScrollBy).not.toBeNull();
        });

        it('puts the body\'s height, padding and scrollTop back when the keyboard closes', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.style.height = 'auto';
            panel.style.maxHeight = '90%';
            panel.style.paddingBottom = '8px';
            panel.scrollTop = 5;
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize'); // opens, saves 'auto'/'8px'/5 before locking and scrolling
            expect(panel.style.height).toBe('400px');

            win.visualViewport!.height = 800;
            win.visualViewport!.dispatch('resize'); // closes

            expect(panel.style.height).toBe('auto');
            expect(panel.style.maxHeight).toBe('90%');
            expect(panel.style.paddingBottom).toBe('8px');
            expect(panel.lastScrollTo).toEqual({ top: 5, behavior: 'instant' });
        });

        it('pads only what the body lacks of the scroll room', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.scrollHeight = 500; // 100px left to scroll
            panel.computedPaddingBottom = 12;
            kac.attach();

            win.visualViewport!.height = 500; // overshoot 260
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
            expect(panel.style.paddingBottom).toBe('172px'); // the stylesheet's 12 and the 160 lacking
        });

        it('pads nothing where the body has the scroll room', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.scrollHeight = 700; // 300px left to scroll
            kac.attach();

            win.visualViewport!.height = 500; // overshoot 260
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
            expect(panel.style.paddingBottom).toBe('');
            expect(panel.style.height).toBe('400px');
        });

        it('locks, pads and puts back afresh on a second opening of the keyboard, from where the body stands then', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.scrollTop = 5;
            kac.attach();

            win.visualViewport!.height = 500; // overshoot 260
            win.visualViewport!.dispatch('resize');
            win.visualViewport!.height = 800;
            win.visualViewport!.dispatch('resize');
            expect(panel.lastScrollTo).toEqual({ top: 5, behavior: 'instant' });

            panel.scrollTop = 40; // scrolled with the keyboard closed
            panel.rectHeight = 300; // the body laid out shorter meanwhile
            panel.style.paddingBottom = '8px';
            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            expect(panel.style.height).toBe('300px');
            expect(panel.style.maxHeight).toBe('300px');
            expect(panel.style.paddingBottom).toBe('260px');

            win.visualViewport!.height = 800;
            win.visualViewport!.dispatch('resize');

            expect(panel.style.height).toBe('');
            expect(panel.style.maxHeight).toBe('');
            expect(panel.style.paddingBottom).toBe('8px');
            expect(panel.lastScrollTo).toEqual({ top: 40, behavior: 'instant' });
        });

        it('adds to the padding across repeated measures without locking the height again', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 500; // overshoot 260
            win.visualViewport!.dispatch('resize');
            expect(panel.style.paddingBottom).toBe('260px');

            panel.rectHeight = 300; // what a second lock would take
            input.bottom = 600; // the field the next measure finds, 110 below the keyboard's top
            win.visualViewport!.dispatch('resize');

            expect(panel.style.height).toBe('400px');
            expect(panel.style.maxHeight).toBe('400px');
            expect(panel.style.paddingBottom).toBe('370px');
        });

    });

    describe('the room above the keyboard', () => {
        it('gives the container how much of the window the keyboard covers while it is open', () => {
            const { win, container, kac } = setup({ vvHeight: 800 });
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            expect(container.overlap()).toBe('300px');
            expect(kac.keyboardOverlap()).toBe(300);
        });

        it('gives the native keyboard\'s height, where the viewport does not shrink', () => {
            const { win, container, kac } = setup({ withVisualViewport: false });
            kac.attach();

            win.dispatch('keyboardWillShow', { keyboardHeight: 336 });

            expect(container.overlap()).toBe('336px');
        });

        it('takes the overlap off once the keyboard closes', () => {
            const { win, container, kac } = setup({ withVisualViewport: false });
            kac.attach();

            win.dispatch('keyboardWillShow', { keyboardHeight: 336 });
            win.dispatch('keyboardWillHide');

            expect(container.overlap()).toBeUndefined();
            expect(kac.keyboardOverlap()).toBe(0);
        });

        it('takes the overlap off on a show of height 0, the window no longer over the keyboard', () => {
            const { win, container, kac } = setup({ withVisualViewport: false });
            kac.attach();

            win.dispatch('keyboardDidShow', { keyboardHeight: 340 });
            win.dispatch('keyboardDidShow', { keyboardHeight: 0 });

            expect(container.overlap()).toBeUndefined();
        });

        it('gives a show told a height of 31 its overlap, and takes it off on the hide', () => {
            const { win, container, panel, kac } = setup({ withVisualViewport: false });
            const input = new MockInput(790); // under where a 31px keyboard's top stands
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.scrollTop = 40;
            kac.attach();

            win.dispatch('keyboardWillShow', { keyboardHeight: 31 });

            expect(container.overlap()).toBe('31px');
            expect(kac.keyboardOverlap()).toBe(31);
            expect(panel.lastScrollBy).not.toBeNull();

            win.dispatch('keyboardWillHide');

            expect(container.overlap()).toBeUndefined();
            expect(kac.keyboardOverlap()).toBe(0);
            expect(panel.scrollTop).toBe(40);
        });

        it('sets nothing while no keyboard covers the window', () => {
            const { win, container, kac } = setup({ vvHeight: 800 });
            kac.attach();

            win.visualViewport!.dispatch('resize'); // the viewport as tall as the window

            expect(container.overlap()).toBeUndefined();
            expect(kac.keyboardOverlap()).toBe(0);
        });

        it('takes the body back where it stood each time an overlap of 5px comes and goes', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(792); // 3px under where a 5px keyboard's top stands
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.scrollTop = 40;
            kac.attach();

            for (let i = 0; i < 2; i++) {
                win.visualViewport!.height = 795;
                win.visualViewport!.dispatch('resize');

                expect(container.overlap()).toBe('5px');
                expect(panel.scrollTop).not.toBe(40);

                win.visualViewport!.height = 800;
                win.visualViewport!.dispatch('resize');

                expect(container.overlap()).toBeUndefined();
                expect(panel.scrollTop).toBe(40);
                expect(panel.style.height).toBe('');
                expect(panel.style.paddingBottom).toBe('');
            }
        });

        it('takes the keyboard as gone once the viewport, scrolled down, ends at the window\'s bottom', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.scrollTop = 40;
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');
            expect(container.overlap()).toBe('300px');

            // The viewport, no taller, scrolled down by 300px: its bottom is the window's.
            win.visualViewport!.offsetTop = 300;
            win.visualViewport!.dispatch('scroll');

            expect(container.overlap()).toBeUndefined();
            expect(kac.keyboardOverlap()).toBe(0);
            expect(panel.scrollTop).toBe(40);
        });

        it('lays out above a keyboard already open as it attaches', () => {
            const { win, container, kac } = setup({ vvHeight: 500 });
            kac.attach();

            expect(container.overlap()).toBe('300px');
        });
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

        it('keeps the caret above the keyboard, not the field\'s bottom', () => {
            const { win, panel, kac } = editable(1400, 700);
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            // caret 700 - keyboardTop 500 + 10 = 210 (the field's bottom would give 910)
            expect(panel.lastScrollBy).toEqual({ top: 210, behavior: 'instant' });
        });

        it('does nothing while the caret is above the keyboard, however far the field runs below it', () => {
            const { win, panel, kac } = editable(1400, 300);
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toBeNull();
        });

        it('follows the caret as the selection moves while the keyboard is open', () => {
            const { win, doc, panel, text, kac } = editable(1400, 300);
            kac.attach();
            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');
            expect(panel.lastScrollBy).toBeNull();

            text.caretBottom = 560; // typed on to a line under the keyboard's edge
            doc.dispatch('selectionchange');

            expect(panel.lastScrollBy).toEqual({ top: 70, behavior: 'instant' });
        });

        it('does not follow the selection while the keyboard is closed', () => {
            const { doc, panel, text, kac } = editable(1400, 300);
            kac.attach();

            text.caretBottom = 900;
            doc.dispatch('selectionchange');

            expect(panel.lastScrollBy).toBeNull();
        });

        it('takes the line the caret is in where the caret has no box of its own (an empty line)', () => {
            const { win, doc, field, panel, kac } = editable(650, null);
            doc.selection = { focusNode: field, focusOffset: 0 };
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toEqual({ top: 160, behavior: 'instant' });
        });

        it('stops following the selection once detached', () => {
            const { doc, kac } = editable(1400, 300);
            kac.attach();
            expect(doc.listenerCount('selectionchange')).toBe(1);

            kac.detach();

            expect(doc.listenerCount('selectionchange')).toBe(0);
        });
    });

    describe('native (Capacitor) keyboard events', () => {
        it('opens on keyboardWillShow with a keyboardHeight and reacts even with no visualViewport', () => {
            const { win, container, panel, kac } = setup({ withVisualViewport: false });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.dispatch('keyboardWillShow', { keyboardHeight: 300 });

            // keyboardTop = innerHeight(800) - native(300) = 500; overshoot = 750-500+10=260
            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
        });

        it('closes and restores on keyboardWillHide', () => {
            const { win, container, panel, kac } = setup({ withVisualViewport: false });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.scrollTop = 3;
            kac.attach();

            win.dispatch('keyboardWillShow', { keyboardHeight: 300 });
            win.dispatch('keyboardWillHide');

            expect(panel.lastScrollTo).toEqual({ top: 3, behavior: 'instant' });
        });
    });

    describe('focus/blur debouncing', () => {
        beforeEach(() => vi.useFakeTimers());

        it('re-corrects for a newly focused input while the keyboard is already open (after the 50ms debounce)', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const inputA = new MockInput(200); // does not overlap
            const inputB = new MockInput(750); // overlaps
            container.adopt(inputA);
            container.adopt(inputB);
            container.ownerDocument.activeElement = inputA;
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize'); // keyboard opens, inputA doesn't need correction
            expect(panel.lastScrollBy).toBeNull();

            container.ownerDocument.activeElement = inputB;
            container.dispatch('focusin', { target: inputB });
            vi.advanceTimersByTime(50);

            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
        });

        it('puts the body back where it was as the keyboard opened, when focusing a field scrolled it first', () => {
            const { win, container, panel, kac } = setup({ withVisualViewport: false });
            panel.rectBottom = 460; // the body, shrunk above the keyboard
            panel.scrollHeight = 600;
            const input = new MockInput(800);
            container.adopt(input);
            kac.attach();

            win.dispatch('keyboardWillShow', { keyboardHeight: 336 }); // nothing focused yet

            // focus() scrolls the body itself to show the field at its bottom edge
            container.ownerDocument.activeElement = input;
            panel.scrollTop = 32;
            input.bottom = 460;
            container.dispatch('focusin', { target: input });
            vi.advanceTimersByTime(50);
            expect(panel.lastScrollBy).toEqual({ top: 10, behavior: 'instant' });

            win.dispatch('keyboardWillHide');

            expect(panel.lastScrollTo).toEqual({ top: 0, behavior: 'instant' });
        });

        it('puts the body back where it stood as the container attached over an open keyboard, when the first focus scrolled it', () => {
            const { win, container, panel, kac } = setup({ withVisualViewport: false });
            trackKeyboard(win as any);
            win.dispatch('keyboardDidShow', { keyboardHeight: 336 }); // typing elsewhere before the dialog opens
            panel.rectBottom = 460; // the body, shrunk above the keyboard
            panel.scrollHeight = 600;
            const input = new MockInput(800);
            container.adopt(input);
            kac.attach();

            // the first focus has the browser scroll the body to the field
            container.ownerDocument.activeElement = input;
            panel.scrollTop = 32;
            input.bottom = 470;
            container.dispatch('focusin', { target: input });
            vi.advanceTimersByTime(50);
            expect(panel.lastScrollBy).toEqual({ top: 20, behavior: 'instant' });

            win.dispatch('keyboardDidHide');

            expect(panel.lastScrollTo).toEqual({ top: 0, behavior: 'instant' });
        });

        it('restores 200ms after focus leaves the container with no input focused', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            panel.scrollTop = 7;
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();
            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize'); // opens + corrects

            expect(panel.style.height).toBe('400px');

            container.ownerDocument.activeElement = null;
            container.dispatch('focusout');
            vi.advanceTimersByTime(200);

            expect(panel.style.height).toBe('');
            expect(panel.style.maxHeight).toBe('');
            expect(panel.style.paddingBottom).toBe('');
            expect(panel.lastScrollTo).toEqual({ top: 7, behavior: 'instant' });
        });

        it('does not restore on focusout if focus moved to another input inside the container', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const inputA = new MockInput(750);
            const inputB = new MockInput(750);
            container.adopt(inputA);
            container.adopt(inputB);
            container.ownerDocument.activeElement = inputA;
            kac.attach();
            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            container.ownerDocument.activeElement = inputB; // focus moved before the blur timer fires
            container.dispatch('focusout');
            vi.advanceTimersByTime(200);

            expect(panel.lastScrollTo).toBeNull(); // still scrolled, not restored
            expect(panel.style.height).toBe('400px');
        });
    });

    describe('the user scrolling the body while the keyboard is open', () => {
        beforeEach(() => vi.useFakeTimers());

        /** The box: the keyboard opened over a focused field, the body locked, padded and scrolled 260 for it from 5. */
        function openedOverField() {
            const env = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            env.container.ownerDocument.activeElement = input;
            env.container.adopt(input);
            env.panel.style.paddingBottom = '8px';
            env.panel.scrollTop = 5;
            env.kac.attach();
            env.win.visualViewport!.height = 500;
            env.win.visualViewport!.dispatch('resize');
            expect(env.panel.scrollTop).toBe(265);
            const closeKeyboard = () => {
                env.win.visualViewport!.height = 800;
                env.win.visualViewport!.dispatch('resize');
            };
            return { ...env, input, closeKeyboard };
        }

        for (const gesture of ['wheel', 'touchmove']) {
            it(`leaves the body where the user took it by a ${gesture} on it, the height and the padding put back`, () => {
                const { panel, closeKeyboard } = openedOverField();

                panel.dispatch(gesture);
                panel.scrollTop = 120;
                closeKeyboard();

                expect(panel.lastScrollTo).toBeNull();
                expect(panel.scrollTop).toBe(120);
                expect(panel.style.height).toBe('');
                expect(panel.style.maxHeight).toBe('');
                expect(panel.style.paddingBottom).toBe('8px');
            });
        }

        it('leaves the body where the user took it when the focus leaves the fields', () => {
            const { container, panel } = openedOverField();

            panel.dispatch('touchmove');
            panel.scrollTop = 120;
            container.ownerDocument.activeElement = null;
            container.dispatch('focusout');
            vi.advanceTimersByTime(200);

            expect(panel.lastScrollTo).toBeNull();
            expect(panel.style.height).toBe('');
            expect(panel.style.paddingBottom).toBe('8px');
        });

        it('leaves the body where the user took it when the container detaches', () => {
            const { panel, kac } = openedOverField();

            panel.dispatch('wheel');
            panel.scrollTop = 120;
            kac.detach();

            expect(panel.lastScrollTo).toBeNull();
            expect(panel.style.height).toBe('');
            expect(panel.style.paddingBottom).toBe('8px');
        });

        it('goes back to where the user took the body when it is scrolled for a field afterwards', () => {
            const { container, panel, closeKeyboard } = openedOverField();

            panel.dispatch('wheel');
            panel.scrollTop = 120;
            const below = new MockInput(700); // 210 below the keyboard's top
            container.adopt(below);
            container.ownerDocument.activeElement = below;
            container.dispatch('focusin', { target: below });
            vi.advanceTimersByTime(50);
            expect(panel.scrollTop).toBe(330);

            closeKeyboard();

            expect(panel.lastScrollTo).toEqual({ top: 120, behavior: 'instant' });
        });

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
        it('puts the box\'s body back as it stood when the keyboard opened, the browser having scrolled it to the field before the measure', async () => {
            const pop = new MockAnimation(250); // the overlap moving over the keyboard's slide
            const { win, panel, scrolls, input } = setupAnimated(700, pop);
            panel.scrollHeight = 900;

            win.dispatch('keyboardDidShow', { keyboardHeight: 428 }); // innerHeight 800: kbTop 372
            // the browser keeps the focused field in sight before the measure
            panel.scrollTop = 150;
            input.bottom = 550;
            expect(scrolls).toEqual([]); // not while the overlap still moves
            pop.end();
            await flush();
            // 550 - 372 + 10 = 188; 350 left to scroll, so nothing is padded
            expect(scrolls).toEqual([188]);
            expect(panel.style.height).toBe('400px');
            expect(panel.style.paddingBottom).toBe('');

            win.dispatch('keyboardDidHide');

            expect(panel.style.height).toBe('');
            expect(panel.lastScrollTo).toEqual({ top: 0, behavior: 'instant' });
        });

        it('does not measure while the sheet slides up, and measures where the field comes to rest once it ends', async () => {
            const slide = new MockAnimation();
            const { container, panel, input, openKeyboard } = setupAnimated(871, slide);

            openKeyboard(); // midway the field is still below the window
            expect(container.subtreeAsked).toBe(true);
            await flush();
            expect(panel.lastScrollBy).toBeNull();

            input.bottom = 557; // the sheet in place
            slide.end();
            await flush();

            // 557 - 500 + 10 = 67, not the 381 the field midway would give
            expect(panel.lastScrollBy).toEqual({ top: 67, behavior: 'instant' });
        });

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

        it('measures nothing when the keyboard closed during the wait', async () => {
            const slide = new MockAnimation();
            const { win, panel, input, openKeyboard } = setupAnimated(871, slide);

            openKeyboard();
            win.visualViewport!.height = 800;
            win.visualViewport!.dispatch('resize');
            input.bottom = 557;
            slide.end();
            await flush();

            expect(panel.lastScrollBy).toBeNull();
        });

        it('measures nothing when the container was detached (closed) during the wait', async () => {
            const slide = new MockAnimation();
            const { panel, input, kac, openKeyboard } = setupAnimated(871, slide);

            openKeyboard();
            kac.detach();
            input.bottom = 557;
            slide.end();
            await flush();

            expect(panel.lastScrollBy).toBeNull();
        });

        it('measures the field focused when the wait ends, not the one focused when it began', async () => {
            const slide = new MockAnimation();
            const { container, panel, input, openKeyboard } = setupAnimated(871, slide);
            const other = new MockInput(600);
            container.adopt(other);

            openKeyboard();
            container.ownerDocument.activeElement = other;
            input.bottom = 557;
            slide.end();
            await flush();

            expect(panel.lastScrollBy).toEqual({ top: 110, behavior: 'instant' });
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

        it('waits for the overlap\'s transition that started while it waited for the focused field\'s, the show joining that wait (the low sheet)', async () => {
            vi.useFakeTimers();
            const { win, container, panel, scrolls, input, settle } = setupLowSheet();
            const focusRing = new MockAnimation(150);
            container.animations.push(focusRing);

            container.dispatch('focusin', { target: input });
            vi.advanceTimersByTime(50); // the wait begins on the field's focus ring
            vi.advanceTimersByTime(60);
            const toKeyboard = new MockAnimation(250);
            container.animations.push(toKeyboard);
            win.dispatch('keyboardWillShow', { keyboardHeight: 288 }); // joins that wait
            vi.advanceTimersByTime(44);
            focusRing.end();
            await vi.advanceTimersByTimeAsync(0);
            expect(scrolls).toEqual([]); // not the 109 the sheet on its way up gives

            settle();
            toKeyboard.end();
            await vi.advanceTimersByTimeAsync(0);

            expect(scrolls).toEqual([]);
            expect(panel.style.height).toBe('');
            expect(panel.style.maxHeight).toBe('');
            expect(panel.style.paddingBottom).toBe('');
        });

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

        it('measures where the field comes to rest in the box once the animations started meanwhile have stopped', async () => {
            const focusRing = new MockAnimation(100);
            const { container, input, scrolls, openKeyboard } = setupAnimated(871, focusRing);

            openKeyboard();
            const toKeyboard = new MockAnimation(250);
            container.animations.push(toKeyboard);
            focusRing.end();
            await flush();
            expect(scrolls).toEqual([]);

            input.bottom = 557;
            toKeyboard.end();
            await flush();

            expect(scrolls).toEqual([67]); // 557 - 500 + 10, not the 381 midway
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
        it('stops reacting to visualViewport/native events and restores state', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();
            win.visualViewport!.height = 500;
            panel.scrollTop = 0;
            win.visualViewport!.dispatch('resize');
            expect(panel.lastScrollBy).not.toBeNull();

            kac.detach();

            expect(panel.lastScrollTo).toEqual({ top: 0, behavior: 'instant' }); // restore() ran as part of detach
            expect(panel.style.height).toBe('');
            expect(panel.style.maxHeight).toBe('');
            expect(panel.style.paddingBottom).toBe('');

            // Further events must not reach the (now-detached) handlers.
            panel.lastScrollBy = null;
            win.visualViewport!.height = 300;
            win.visualViewport!.dispatch('resize');
            expect(panel.lastScrollBy).toBeNull();
        });

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
