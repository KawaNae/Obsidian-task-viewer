import { describe, it, expect, afterEach } from 'vitest';
import { OverlayShell } from '../../../../src/views/sharedUI/OverlayShell';
import { closeAllOverlays } from '../../../../src/views/sharedUI/OverlayRegistry';

/**
 * An overlay closed while it still opens: its opening is over as it closes,
 * so what waits for it (`opening()`) goes on, and the focus goes back at
 * once to what had it before it opened, not after the opening it no longer
 * has.
 *
 * Vitest runs in `node` with no DOM: the window, the document and the
 * elements are stand-ins that keep what `OverlayShell` touches. The window
 * runs its frames when the test says, and the panel's animation coming in
 * runs until the test ends.
 */

class Target {
    private listeners = new Map<string, ((e: unknown) => void)[]>();
    addEventListener(type: string, fn: (e: unknown) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    removeEventListener(type: string, fn: (e: unknown) => void) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
    }
}

class Win extends Target {
    innerWidth = 1000;
    innerHeight = 800;
    scrollX = 0;
    scrollY = 0;
    visualViewport = Object.assign(new Target(), { width: 1000, height: 800, offsetTop: 0 });
    private frames: (() => void)[] = [];
    requestAnimationFrame(fn: () => void) { this.frames.push(fn); return this.frames.length; }
    cancelAnimationFrame() {}
    getComputedStyle() { return { paddingBottom: '0px' }; }
    /** Run the frames asked for so far. */
    frame() {
        const frames = this.frames;
        this.frames = [];
        for (const fn of frames) fn();
    }
}

/** An animation still running, which does not end while the test runs. */
const RUNNING = {
    playState: 'running',
    effect: { getComputedTiming: () => ({ endTime: 150 }) },
    finished: new Promise<never>(() => {}),
};

class El extends Target {
    children: El[] = [];
    classes: Set<string>;
    style = { setProperty() {}, removeProperty() {}, maxHeight: '' };
    offsetHeight = 0;
    tabIndex = 0;
    isConnected = true;
    /** What runs on it: the panel coming in, once the test says. */
    animations: unknown[] = [];
    constructor(readonly ownerDocument: Doc, cls = '') {
        super();
        this.classes = new Set(cls.split(/\s+/).filter(Boolean));
    }
    createDiv(o: { cls?: string } | string = {}): El {
        const el = new El(this.ownerDocument, typeof o === 'string' ? o : o.cls ?? '');
        this.children.push(el);
        return el;
    }
    createEl(_tag: string, o: { cls?: string } = {}): El { return this.createDiv(o); }
    createSpan(o: { cls?: string } = {}): El { return this.createDiv(o); }
    appendChild(el: El) { this.children.push(el); }
    setAttribute() {}
    addClass(...cls: string[]) { cls.forEach((c) => this.classes.add(c)); }
    remove() { this.isConnected = false; }
    querySelector(sel: string): El | null {
        const cls = sel.replace(/^\./, '');
        for (const child of this.children) {
            if (child.classes.has(cls)) return child;
            const deeper = child.querySelector(sel);
            if (deeper) return deeper;
        }
        return null;
    }
    contains(node: unknown): boolean {
        return node === this || this.children.some((c) => c.contains(node));
    }
    getAnimations() { return this.animations; }
    getBoundingClientRect() {
        return { left: 0, top: 0, right: 200, bottom: 300, width: 200, height: 300 } as DOMRect;
    }
    focus() { this.ownerDocument.activeElement = this; }
    blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
    scrollTo() {}
    scrollBy() {}
}

class Doc extends Target {
    activeElement: unknown;
    body: El;
    constructor(readonly defaultView: Win) {
        super();
        this.body = new El(this, 'body');
        this.activeElement = this.body;
    }
    createElement() { return new El(this); }
    getSelection() { return null; }
}

const keymap = { pushScope() {}, popScope() {} };

/**
 * An anchored overlay opened in a window of its own, from an editor holding
 * the focus, its panel coming in past the frame after it opened.
 */
function openFromEditor() {
    const win = new Win();
    const doc = new Doc(win);
    const editor = doc.body.createDiv('editor');
    editor.focus();
    const shell = new OverlayShell();
    shell.open({
        mode: 'anchored',
        anchor: {
            kind: 'element',
            element: {
                ownerDocument: doc,
                getBoundingClientRect: () => ({ left: 10, top: 100, right: 60, bottom: 120, width: 50, height: 20 }),
            } as never,
        },
        build: () => {},
        keymap: keymap as never,
    });
    const panel = shell.getPanel() as unknown as El;
    panel.animations = [RUNNING];
    win.frame();
    return { win, doc, editor, panel, shell };
}

/** Let the promises settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
    closeAllOverlays();
});

describe('an overlay closed while it opens', () => {
    it('ends its opening: what waits for it goes on', async () => {
        const { shell } = openFromEditor();
        const opening = shell.opening();
        expect(opening).not.toBeNull();
        let opened = false;
        void opening!.then(() => { opened = true; });
        await flush();
        expect(opened).toBe(false);

        shell.close();
        await flush();
        expect(opened).toBe(true);
    });

    it('gives the focus back at once, the panel holding it as it opened', () => {
        const { doc, editor, panel, shell } = openFromEditor();
        expect(doc.activeElement).toBe(panel);

        shell.close();
        expect(doc.activeElement).toBe(editor);
    });
});
