import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { KeyboardRoom } from '../../../src/utils/KeyboardRoom';
import { KEYBOARD_OVERLAP_VAR } from '../../../src/utils/RoomLayout';
import { PopoverShell } from '../../../src/views/sharedUI/PopoverShell';
import { OverlayShell } from '../../../src/views/sharedUI/OverlayShell';
import { FloatingOverlayHost } from '../../../src/timer/FloatingOverlayHost';
import { closeAllOverlays } from '../../../src/views/sharedUI/OverlayRegistry';
import { keyboardFollowerCount } from '../../../src/utils/KeyboardWatch';

/**
 * The parts that follow the on-screen keyboard: the overlay's keyboard
 * room, the anchored overlay's panel, the popover and the timer widget. Each is laid out again on each of the keyboard's events
 * (Capacitor's four, on Obsidian mobile) and on the visualViewport
 * resizing (Windows, Safari), reads the height the event told, and hears
 * nothing once it is closed.
 *
 * Vitest runs in `node` with no DOM: the window, its visualViewport and the
 * elements are stand-ins that keep what these parts touch. Each test has a
 * window of its own, so no window's keyboard is left over from another.
 */

class Target {
    private listeners = new Map<string, ((e: unknown) => void)[]>();
    addEventListener(type: string, fn: (e: unknown) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    removeEventListener(type: string, fn: (e: unknown) => void) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
    }
    fire(type: string, e: object = {}) {
        for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type, ...e });
    }
}

const WIN_W = 1000;
const WIN_H = 800;

class Viewport extends Target {
    width = WIN_W;
    height = WIN_H;
    offsetTop = 0;
}

class Win extends Target {
    innerWidth = WIN_W;
    innerHeight = WIN_H;
    scrollX = 0;
    scrollY = 0;
    visualViewport = new Viewport();
    /** No frame is run: what waits for one (the first focus, the widget's clamp) is not looked at here. */
    requestAnimationFrame() { return 0; }
    cancelAnimationFrame() {}
    getComputedStyle() { return { paddingBottom: '0px' }; }
}

/** An inline style, writing down in `log` the keyboard's overlap given to it and the max-height set on it. */
class Style {
    vars = new Map<string, string>();
    private max = '';
    constructor(private readonly log: string[], private readonly name: string) {}
    setProperty(prop: string, value: string) {
        this.vars.set(prop, value);
        this.log.push(`${this.name} ${prop}=${value}`);
    }
    removeProperty(prop: string) {
        this.vars.delete(prop);
        this.log.push(`${this.name} ${prop} removed`);
    }
    get maxHeight() { return this.max; }
    set maxHeight(v: string) {
        this.max = v;
        if (v) this.log.push(`${this.name} max-height=${v}`);
    }
}

/** An element: as tall as `NATURAL_H` (more than the window), so a panel placed by script has its max-height set to the room it is given. */
const NATURAL_H = 1000;

class El extends Target {
    children: El[] = [];
    classes: Set<string>;
    style: Style;
    className = '';
    offsetHeight = 0;
    tabIndex = 0;
    scrollTop = 0;
    constructor(readonly ownerDocument: Doc, cls = '') {
        super();
        this.classes = new Set(cls.split(/\s+/).filter(Boolean));
        this.style = new Style(ownerDocument.log, [...this.classes][0] ?? 'el');
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
    remove() {}
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
    getBoundingClientRect() {
        return { left: 0, top: 0, right: 200, bottom: NATURAL_H, width: 200, height: NATURAL_H } as DOMRect;
    }
    scrollTo() {}
    scrollBy() {}
}

class Doc extends Target {
    log: string[] = [];
    activeElement: unknown = null;
    body: El;
    constructor(readonly defaultView: Win) {
        super();
        this.body = new El(this, 'body');
    }
    createElement() { return new El(this); }
    getSelection() { return null; }
}

/** The field a popover or an anchored overlay opens below: near the window's top. */
function anchorIn(doc: Doc) {
    return {
        ownerDocument: doc,
        getBoundingClientRect: () => ({ left: 10, top: 100, right: 60, bottom: 120, width: 50, height: 20 }),
    };
}

/** The room a panel placed by script is given, from its max-height: the window's height less the keyboard's, 16px kept. */
function keyboardUnder(panel: El): number {
    const max = parseFloat(panel.style.maxHeight);
    return Number.isNaN(max) ? 0 : WIN_H - 16 - max;
}

/** A part opened in a window of its own, and how much of the window it has laid out the keyboard covering. */
interface Opened {
    win: Win;
    keyboard(): number;
    close(): void;
}

function openContainer(): Opened {
    const win = new Win();
    const doc = new Doc(win);
    const root = new El(doc, 'tv-overlay');
    const panel = root.createDiv('tv-overlay__panel');
    const body = panel.createDiv('tv-overlay__body');
    const room = new KeyboardRoom(root as never, win as never, panel as never, body as never);
    room.attach();
    return {
        win,
        keyboard: () => parseFloat(root.style.vars.get(KEYBOARD_OVERLAP_VAR) ?? '0'),
        close: () => room.detach(),
    };
}

function openPopover(): Opened {
    const win = new Win();
    const doc = new Doc(win);
    const shell = new PopoverShell();
    shell.open({
        anchor: { kind: 'element', element: anchorIn(doc) as never },
        className: 'tv-popover',
        build: () => {},
    });
    const el = shell.getEl() as unknown as El;
    return { win, keyboard: () => keyboardUnder(el), close: () => shell.close() };
}

const keymap = { pushScope() {}, popScope() {} };

function openAnchoredOverlay(): Opened & { doc: Doc } {
    const win = new Win();
    const doc = new Doc(win);
    const shell = new OverlayShell();
    shell.open({
        mode: 'anchored',
        anchor: { kind: 'element', element: anchorIn(doc) as never },
        build: () => {},
        keymap: keymap as never,
    });
    const panel = shell.getPanel() as unknown as El;
    return { win, doc, keyboard: () => keyboardUnder(panel), close: () => shell.close() };
}

/** The timer widget: in the window's bottom-right corner, 16px in, lifted by a translateY over the keyboard. */
class Widget extends Target {
    style = { left: '', top: '', right: '', bottom: '', transform: '', cursor: '' };
    remove() {}
    getBoundingClientRect(): DOMRect {
        const m = /translateY\((-?[\d.]+)px\)/.exec(this.style.transform);
        const top = WIN_H - 100 - 16 + (m ? parseFloat(m[1]) : 0);
        return { left: WIN_W - 216, top, right: WIN_W - 16, bottom: top + 100, width: 200, height: 100 } as DOMRect;
    }
}

function openWidget(): Opened {
    const win = new Win();
    const widget = new Widget();
    const doc = { body: { createDiv: () => widget } };
    const host = new FloatingOverlayHost();
    host.attach(win as never, doc as never, 'timer-widget');
    return {
        win,
        // Lifted, its bottom stands 8px above the keyboard's top.
        keyboard: () => (widget.style.transform ? WIN_H - widget.getBoundingClientRect().bottom - 8 : 0),
        close: () => host.detach(),
    };
}

const PARTS: [string, () => Opened][] = [
    ['the overlay\'s keyboard room (KeyboardRoom)', openContainer],
    ['the anchored overlay\'s panel (OverlayShell)', openAnchoredOverlay],
    ['the popover (PopoverShell)', openPopover],
    ['the timer widget (FloatingOverlayHost)', openWidget],
];

/** Ways the keyboard comes up, by 300px: a show of Capacitor's, or the visualViewport shrinking. */
const RAISES: [string, (win: Win, height: number) => void][] = [
    ['keyboardWillShow', (win, h) => win.fire('keyboardWillShow', { keyboardHeight: h })],
    ['keyboardDidShow', (win, h) => win.fire('keyboardDidShow', { keyboardHeight: h })],
    ['the visualViewport resizing', (win, h) => {
        win.visualViewport.height = WIN_H - h;
        win.visualViewport.fire('resize');
    }],
];

const HIDES = ['keyboardWillHide', 'keyboardDidHide'];

afterEach(() => {
    closeAllOverlays();
});

describe.each(PARTS)('%s follows the keyboard', (_name, open) => {
    it.each(RAISES)('is laid out again on %s, for the height it told', (_how, raise) => {
        const part = open();
        expect(part.keyboard()).toBe(0);

        raise(part.win, 300);

        expect(part.keyboard()).toBe(300);
        part.close();
    });

    it.each(RAISES)('hears nothing of %s once closed', (_how, raise) => {
        const part = open();
        part.close();

        raise(part.win, 300);

        expect(part.keyboard()).toBe(0);
    });

    it.each(HIDES)('is laid out again on %s', (hide) => {
        const part = open();
        part.win.fire('keyboardWillShow', { keyboardHeight: 300 });
        expect(part.keyboard()).toBe(300);

        part.win.fire(hide);

        expect(part.keyboard()).toBe(0);
        part.close();
    });

    it.each(HIDES)('hears nothing of %s once closed', (hide) => {
        const part = open();
        part.win.fire('keyboardWillShow', { keyboardHeight: 300 });
        part.close();

        part.win.fire(hide);

        expect(part.keyboard()).toBe(300);
    });
});

describe('the overlay\'s keyboard room and the visualViewport scrolling', () => {
    it('is given the overlap again as the visualViewport scrolls, its top moving down', () => {
        const part = openContainer();
        part.win.visualViewport.height = 500;
        part.win.visualViewport.fire('resize');
        expect(part.keyboard()).toBe(300);

        // The keyboard's top is the visualViewport's bottom: 100 + 500.
        part.win.visualViewport.offsetTop = 100;
        part.win.visualViewport.fire('scroll');

        expect(part.keyboard()).toBe(200);
        part.close();
    });

    it('hears no scroll once closed', () => {
        const part = openContainer();
        part.close();

        part.win.visualViewport.height = 500;
        part.win.visualViewport.fire('scroll');

        expect(part.keyboard()).toBe(0);
    });
});

describe.each(PARTS.slice(1))('%s and the visualViewport scrolling', (_name, open) => {
    it('is not laid out again as the visualViewport scrolls, though the keyboard\'s top moves with it', () => {
        const part = open();
        part.win.visualViewport.height = 500;
        part.win.visualViewport.fire('resize');
        expect(part.keyboard()).toBe(300);

        // The keyboard's top is now the visualViewport's bottom: 100 + 500.
        part.win.visualViewport.offsetTop = 100;
        part.win.visualViewport.fire('scroll');

        expect(part.keyboard()).toBe(300);
        part.close();
    });
});

describe('the popover bringing its focused field into view', () => {
    class Input {}
    const G = globalThis as Record<string, unknown>;
    let saved: unknown;
    beforeEach(() => {
        saved = G.HTMLInputElement;
        G.HTMLInputElement = Input;
    });
    afterEach(() => {
        G.HTMLInputElement = saved;
    });

    it('comes to rest as the visualViewport scrolls the field into view, not lifted again by each scroll', () => {
        // The keyboard covers the window below 750: a visualViewport 450 high,
        // scrolled 300 down. The popover, 443 high, opens at the window's
        // bottom, its focused field at its very top.
        const win = new Win();
        const vv = win.visualViewport;
        vv.height = 450;
        vv.offsetTop = 300;
        const PANEL_H = 443;
        const FIELD_H = 30;
        let scrolls = 0;
        const panel = {
            style: { maxHeight: '', top: '', left: '' },
            className: '',
            height: () => Math.min(PANEL_H, parseFloat(panel.style.maxHeight) || Infinity),
            top: () => parseFloat(panel.style.top) || 0,
            getBoundingClientRect: () => ({ left: 0, top: panel.top(), width: 200, height: panel.height() }) as DOMRect,
            contains: (node: unknown) => node === field,
            remove() {},
        };
        // Brought into view as the browser does (`block: 'nearest'`): by the
        // least scroll of the visualViewport, the window's height the most it goes down.
        const field = Object.assign(new Input(), {
            scrollIntoView() {
                const top = panel.top();
                let offset = vv.offsetTop;
                if (top < offset) offset = top;
                else if (top + FIELD_H > offset + vv.height) offset = top + FIELD_H - vv.height;
                offset = Math.max(0, Math.min(WIN_H - vv.height, offset));
                if (offset === vv.offsetTop) return;
                vv.offsetTop = offset;
                scrolls++;
                if (scrolls < 1000) vv.fire('scroll');
            },
        });
        const doc = {
            defaultView: win,
            activeElement: field,
            createElement: () => panel,
            body: { appendChild() {} },
            addEventListener() {},
            removeEventListener() {},
        };
        const shell = new PopoverShell();
        shell.open({
            anchor: { kind: 'event', event: { target: { ownerDocument: doc }, pageX: 10, pageY: 700 } as never },
            className: 'tv-popover',
            build: () => {},
        });
        vv.fire('resize');

        // Placed as it opens and as the visualViewport resizes, each placing
        // bringing the field into view by one scroll. Were each scroll to
        // place it again, it would follow the visualViewport up a pixel at a
        // time, the field hidden again each time by as much.
        expect(scrolls).toBe(2);
        expect(panel.top()).toBeGreaterThanOrEqual(vv.offsetTop);
        expect(panel.top() + FIELD_H).toBeLessThanOrEqual(vv.offsetTop + vv.height);
        shell.close();
    });
});

describe('the anchored overlay on a keyboard event', () => {
    it.each([...RAISES.map(([how]) => how), ...HIDES])('gives the overlap to the overlay before its panel is placed, on %s', (how) => {
        const part = openAnchoredOverlay();
        if (HIDES.includes(how)) {
            part.win.fire('keyboardWillShow', { keyboardHeight: 300 });
        }
        part.doc.log.length = 0;

        const raise = RAISES.find(([name]) => name === how)?.[1];
        if (raise) raise(part.win, 300);
        else part.win.fire(how);

        const told = HIDES.includes(how)
            ? `tv-overlay ${KEYBOARD_OVERLAP_VAR} removed`
            : `tv-overlay ${KEYBOARD_OVERLAP_VAR}=300px`;
        const placed = `tv-overlay__panel max-height=${HIDES.includes(how) ? WIN_H - 16 : WIN_H - 300 - 16}px`;
        // What else the root is given with the overlap (what lays out the
        // centred box) is written with it, before the panel is placed too.
        const log = part.doc.log;
        expect(log.filter((l) => l === told || !l.startsWith('tv-overlay '))).toEqual([told, placed]);
        expect(log[log.length - 1]).toBe(placed);
        part.close();
    });
});

describe.each(PARTS)('%s once closed', (_name, open) => {
    it('leaves the window\'s keyboard followed by nothing of it', () => {
        const part = open();
        expect(keyboardFollowerCount(part.win as never)).toBeGreaterThan(0);

        part.close();

        expect(keyboardFollowerCount(part.win as never)).toBe(0);
    });
});
