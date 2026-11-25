/**
 * A dialog laid out as the stylesheet lays it out, for the part that keeps
 * the field typed at in sight over the on-screen keyboard.
 *
 * Every rect is derived from one model of the layout, never set by hand:
 * the window's height, the dialog's shape (the phone's sheet or the
 * desktop's centered box), the body's content, its scrollTop, the height and
 * the padding written on it inline, and the overlap of the keyboard as it is
 * shown. The part under test reads the rects as a browser would give them,
 * however it moves the body (`scrollBy`, `scrollTo`, a write to
 * `scrollTop`), and wherever in a move it reads them.
 *
 * The overlap the part writes on the root (`--tv-keyboard-overlap`) is not
 * what is laid out at once: the stylesheet registers it (`@property`) and has
 * it move over a 250ms transition, which the root lists among its animations
 * while it runs. The model keeps the two apart: what was written last
 * (`writtenOverlap`) and what is shown at the time read (`shownOverlap`).
 * As a browser does, the root's inline `transition: none` cancels the
 * transition under way, the overlap shown jumping to what is written, and
 * has what is written while it holds shown at once; a write once the
 * transition is let run again moves from what is shown then.
 *
 * Time is one fake clock (vitest's fake timers): `setTimeout`, `Date`, the
 * window's `performance.now()` and its animation frames (every 16ms) run on
 * it, and so do the animations. A test tells the keyboard, focuses fields
 * and scrolls, then lets everything run until nothing waits (`settle`) and
 * reads where things stand.
 */
import { vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { KeyboardRoom } from '../../../src/utils/KeyboardRoom';
import { trackKeyboard, untrackAllKeyboards, type KeyboardCause } from '../../../src/utils/KeyboardWatch';

export const OVERLAP_VAR = '--tv-keyboard-overlap';

/** The room kept between the box and the window's edges, and the least kept above the sheet (`--tv-overlay-edge`). */
const EDGE = 32;
/** The room kept above the sheet with no keyboard (`--tv-sheet-room-above`). */
const SHEET_ROOM_ABOVE = 120;
/** The overlap's transition (`.tv-overlay { transition: --tv-keyboard-overlap 250ms … }`). */
const OVERLAP_MS = 250;
/** How long an overlay's panel takes to come in (`tv-overlay-slide`, `tv-overlay-pop`). */
const OPENING_MS = 150;
/** How long a field's focus ring takes. */
const RING_MS = 150;
/** One animation frame. */
const FRAME_MS = 16;
/** On iPad, `keyboardDidShow` comes about this long after `keyboardWillShow`. */
const IPAD_DID_SHOW_MS = 440;
/** On iPad, `keyboardDidHide` comes 1 to 6ms after `keyboardWillHide`. */
const IPAD_DID_HIDE_MS = 3;

/** CSS's cubic-bezier() timing function. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
    const at = (a: number, b: number, s: number) =>
        3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s;
    return (t: number) => {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 50; i++) {
            const mid = (lo + hi) / 2;
            if (at(x1, x2, mid) < t) lo = mid; else hi = mid;
        }
        return at(y1, y2, (lo + hi) / 2);
    };
}

const OVERLAP_EASE = cubicBezier(0.25, 0.1, 0.25, 1);
const SLIDE_EASE = cubicBezier(0, 0.55, 0.45, 1);
const POP_EASE = cubicBezier(0.33, 1, 0.68, 1);

function px(value: string): number | null {
    const m = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
    return m ? Number(m[1]) : null;
}

// --- The DOM, as far as the part reads it ---

type Listener = (e: any) => void;

class FakeTarget {
    private listeners = new Map<string, Listener[]>();
    /** How many listen to `type`. */
    listenerCount(type: string): number {
        return this.listeners.get(type)?.length ?? 0;
    }
    addEventListener(type: string, fn: Listener): void {
        const list = this.listeners.get(type) ?? [];
        if (!list.includes(fn)) list.push(fn);
        this.listeners.set(type, list);
    }
    removeEventListener(type: string, fn: Listener): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
    }
    /** Tell the listeners of `type`, with `init` as the event's fields. */
    fire(type: string, init: Record<string, unknown> = {}): void {
        const e = { type, target: this, ...init };
        for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
    }
}

class FakeNode extends FakeTarget {
    nodeType = 1;
    parentElement: FakeNode | null = null;
    /** The animations running on this element (not those of what is in it). */
    readonly animations: FakeAnimation[] = [];
    readonly children: FakeNode[] = [];
    constructor(readonly ownerDocument: FakeDocument, readonly className = '') { super(); }
    append(child: FakeNode): void {
        child.parentElement = this;
        this.children.push(child);
    }
    contains(node: unknown): boolean {
        let n = node as { parentElement?: unknown } | null;
        while (n) {
            if (n === this) return true;
            n = (n.parentElement ?? null) as { parentElement?: unknown } | null;
        }
        return false;
    }
    getAttribute(name: string): string | null {
        return name === 'class' ? this.className : null;
    }
    getAnimations(opts?: { subtree?: boolean }): FakeAnimation[] {
        const own = this.animations.filter((a) => a.playState === 'running');
        if (!opts?.subtree) return own;
        return [...own, ...this.children.flatMap((c) => c.getAnimations({ subtree: true }))];
    }
}

/** Set as `HTMLInputElement` and `HTMLTextAreaElement` while the tests run: the node environment has no DOM. */
class FakeInputElement extends FakeNode {}
class FakeTextAreaElement extends FakeNode {}

/** An animation on an element: a CSS animation, or a transition of a property. */
export class FakeAnimation {
    playState: 'running' | 'finished' | 'idle' = 'running';
    readonly finished: Promise<FakeAnimation>;
    readonly effect: { target: FakeNode; getComputedTiming: () => { endTime: number } };
    readonly transitionProperty?: string;
    readonly animationName?: string;
    readonly start: number;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private settleWith!: { end: () => void; cancel: () => void };

    constructor(
        private readonly clock: () => number,
        target: FakeNode,
        readonly duration: number,
        what: { transition: string } | { animation: string },
    ) {
        this.start = clock();
        if ('transition' in what) this.transitionProperty = what.transition;
        else this.animationName = what.animation;
        this.effect = { target, getComputedTiming: () => ({ endTime: duration }) };
        this.finished = new Promise((resolve, reject) => {
            this.settleWith = {
                end: () => resolve(this),
                cancel: () => reject(new Error('AbortError')),
            };
        });
        this.finished.catch(() => {});
        target.animations.push(this);
        if (Number.isFinite(duration)) {
            this.timer = setTimeout(() => this.finish(), duration);
        }
    }

    /** How far it has come, 0 to 1. */
    progress(): number {
        if (this.playState !== 'running') return 1;
        return Math.min(1, Math.max(0, (this.clock() - this.start) / this.duration));
    }

    finish(): void {
        if (this.playState !== 'running') return;
        if (this.timer !== null) clearTimeout(this.timer);
        this.playState = 'finished';
        this.drop();
        this.settleWith.end();
    }

    cancel(): void {
        if (this.playState !== 'running') return;
        if (this.timer !== null) clearTimeout(this.timer);
        this.playState = 'idle';
        this.drop();
        this.settleWith.cancel();
    }

    private drop(): void {
        const list = this.effect.target.animations;
        const i = list.indexOf(this);
        if (i >= 0) list.splice(i, 1);
    }
}

class FakeDocument extends FakeTarget {
    activeElement: FakeNode | null = null;
    selection: { focusNode: unknown; focusOffset: number } | null = null;
    getSelection() { return this.selection; }
    createRange() {
        let node: unknown = null;
        return {
            setStart(n: unknown) { node = n; },
            collapse() {},
            getClientRects() {
                return node instanceof CaretText ? [node.rect()] : [];
            },
        };
    }
}

/** The root's inline style: the CSS variables written on it, and its transition. */
class RootStyle {
    readonly vars = new Map<string, string>();
    private transitionValue = '';
    constructor(private readonly onWrite: (name: string) => void, private readonly onTransition: () => void) {}
    get transition(): string { return this.transitionValue; }
    set transition(v: string) {
        this.transitionValue = v;
        this.onTransition();
    }
    setProperty(name: string, value: string): void {
        this.vars.set(name, value);
        this.onWrite(name);
    }
    removeProperty(name: string): string {
        const old = this.vars.get(name) ?? '';
        this.vars.delete(name);
        this.onWrite(name);
        return old;
    }
    getPropertyValue(name: string): string {
        return this.vars.get(name) ?? '';
    }
}

/** The body's inline style, as far as the part writes it. */
class BodyStyle {
    height = '';
    maxHeight = '';
    paddingBottom = '';
}

function rect(top: number, bottom: number): DOMRect {
    return { top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() { return {}; } } as DOMRect;
}

/** The body that scrolls in the dialog. */
class FakeBody extends FakeNode {
    readonly style = new BodyStyle();
    constructor(doc: FakeDocument, private readonly room: Room) { super(doc, 'tv-overlay__body'); }
    get scrollTop(): number { return this.room.readScrollTop(); }
    set scrollTop(v: number) { this.room.writeScrollTop(v); }
    get scrollHeight(): number { return this.room.layout().scrollHeight; }
    get clientHeight(): number { return this.room.layout().bodyHeight; }
    getBoundingClientRect(): DOMRect {
        const l = this.room.layout();
        return rect(l.bodyTop, l.bodyBottom);
    }
    scrollBy(opts: { top?: number } | number, y?: number): void {
        const dy = typeof opts === 'number' ? (y ?? 0) : (opts.top ?? 0);
        this.room.writeScrollTop(this.room.readScrollTop() + dy);
    }
    scrollTo(opts: { top?: number } | number, y?: number): void {
        const top = typeof opts === 'number' ? (y ?? 0) : opts.top;
        if (top !== undefined) this.room.writeScrollTop(top);
    }
}

/** An input or a textarea in the body: its bottom stands `at` px from the top of the body's content. */
export class FakeField extends FakeInputElement {
    constructor(doc: FakeDocument, private readonly room: Room, public at: number, readonly height: number) {
        super(doc, 'tv-field');
    }
    getBoundingClientRect(): DOMRect {
        const bottom = this.room.contentToClient(this.at);
        return rect(bottom - this.height, bottom);
    }
    /** Move the field in the body's content (what is above it grew or shrank). */
    moveTo(at: number): void { this.at = at; }
}

export class FakeTextArea extends FakeTextAreaElement {
    constructor(doc: FakeDocument, private readonly room: Room, public at: number, readonly height: number) {
        super(doc, 'tv-field');
    }
    getBoundingClientRect(): DOMRect {
        const bottom = this.room.contentToClient(this.at);
        return rect(bottom - this.height, bottom);
    }
}

/** The text the caret stands in, in an editable field: its line's bottom `at` px into the body's content. */
class CaretText {
    nodeType = 3;
    constructor(readonly parentElement: FakeEditable, private readonly room: Room, public at: number) {}
    rect(): DOMRect {
        const bottom = this.room.contentToClient(this.at);
        return rect(bottom - 20, bottom);
    }
}

/** A line of an editable field with nothing in it: the caret in it has no box of its own. */
class EmptyLine extends FakeNode {
    constructor(doc: FakeDocument, private readonly room: Room, public at: number) { super(doc, 'cm-line'); }
    getBoundingClientRect(): DOMRect {
        const bottom = this.room.contentToClient(this.at);
        return rect(bottom - 20, bottom);
    }
}

/** An editable element (a CodeMirror editor's content), from the body's content top to `at`. */
export class FakeEditable extends FakeNode {
    readonly isContentEditable = true;
    constructor(doc: FakeDocument, private readonly room: Room, public at: number) { super(doc, 'cm-content'); }
    getBoundingClientRect(): DOMRect {
        return rect(this.room.contentToClient(0), this.room.contentToClient(this.at));
    }
    /**
     * Put the caret on a line whose bottom is `at` px into the body's content
     * (on an empty line, with `empty`), and tell it as the DOM does
     * (`selectionchange`).
     */
    caretTo(at: number, { empty = false }: { empty?: boolean } = {}): void {
        if (empty) {
            const line = new EmptyLine(this.ownerDocument, this.room, at);
            this.append(line);
            this.ownerDocument.selection = { focusNode: line, focusOffset: 0 };
        } else {
            this.ownerDocument.selection = { focusNode: new CaretText(this, this.room, at), focusOffset: 0 };
        }
        this.ownerDocument.fire('selectionchange');
    }
    /** Where the caret's line ends in the window (px). */
    caretBottom(): number {
        const node = this.ownerDocument.selection?.focusNode;
        if (node instanceof CaretText || node instanceof EmptyLine) return this.room.contentToClient(node.at);
        return this.getBoundingClientRect().bottom;
    }
}

class FakeViewport extends FakeTarget {
    constructor(public height: number, public offsetTop = 0) { super(); }
}

class FakeWindow extends FakeTarget {
    visualViewport: FakeViewport | undefined;
    readonly performance: { now: () => number };
    constructor(public innerHeight: number, private readonly room: Room, clock: () => number) {
        super();
        this.performance = { now: clock };
    }
    requestAnimationFrame(cb: (t: number) => void): number { return this.room.requestFrame(cb); }
    cancelAnimationFrame(id: number): void { this.room.cancelFrame(id); }
    getComputedStyle(el: unknown) {
        const room = this.room;
        return {
            get paddingBottom() { return `${room.bodyPadding()}px`; },
            getPropertyValue(name: string) {
                return el === room.root && name === OVERLAP_VAR ? `${room.shownOverlap()}px` : '';
            },
        } as unknown as CSSStyleDeclaration;
    }
}

// --- The model ---

/**
 * The dialog's shape.
 * - `centered`: the desktop's box. The panel is `panel` tall, at most the
 *   window less 64px, its body `bodyHeight` tall starting `bodyOffset` below
 *   the panel's top; the body is all that shrinks where the panel is bound.
 *   The panel stands at max(32, min((H - h) / 2, H - K - 32 - h)).
 * - `sheet`: the phone's sheet. `above` and `below` are what the panel holds
 *   above and under its body (the head, the row of buttons and their
 *   margins). Its contents stand on the keyboard (the panel's bottom padding
 *   is the overlap), the panel at most H - max(32, 120 - K) tall, and the
 *   body as tall as its content until that bound shrinks it.
 */
export type RoomShape =
    | { kind: 'centered'; panel: number; bodyOffset: number; bodyHeight: number }
    | { kind: 'sheet'; above: number; below: number };

export interface RoomOptions {
    /** The window's innerHeight (px). 800 when not given. */
    height?: number;
    shape: RoomShape;
    /** The body's content, above its bottom padding (px). */
    content: number;
    /** The body's bottom padding from the stylesheet (px). */
    padding?: number;
    /**
     * In the box, a part of the body's content out of sight that ends this
     * far into it but is cut to the room the body leaves above its padding
     * (a pane kept for the panel's height): the content reaches the lower of
     * `content` and that part's end, so a padding shortens the part by as
     * much until it ends above `content`.
     */
    fills?: number;
    /** Whether the window has a visualViewport. */
    viewport?: boolean;
    /** Whether the overlap moves over its transition: not where the browser cannot register it (`@property`). */
    transitions?: boolean;
}

/** Where the panel and the body stand (client px). */
export interface RoomLayout {
    panelTop: number;
    panelBottom: number;
    bodyTop: number;
    bodyBottom: number;
    /** The body's visible height (its clientHeight). */
    bodyHeight: number;
    scrollHeight: number;
}

/** The part mounted on a room. */
export interface Mounted {
    detach(): void;
}

export class Room {
    readonly H: number;
    readonly shape: RoomShape;
    readonly content: number;
    readonly basePadding: number;
    readonly fills: number;
    readonly doc: FakeDocument;
    readonly win: FakeWindow;
    readonly root: FakeNode & { style: RootStyle };
    readonly panel: FakeNode;
    readonly body: FakeBody;

    private readonly t0: number;
    private scroll = 0;
    /** The overlap last written on the root, 0 while none is (px). */
    private written = 0;
    /** The overlap the transition under way starts from, and the transition. */
    private overlapFrom = 0;
    private overlapMove: FakeAnimation | null = null;
    /** The root is laid out once it is in a frame: what is written before then is shown at once, with no transition. */
    private styled = false;
    private opening: FakeAnimation | null = null;
    private readonly transitions: boolean;
    private nativeHeight = 0;
    private mounted: Mounted | null = null;

    private frames: { id: number; cb: (t: number) => void }[] = [];
    /** Told at the end of each frame, once its callbacks have run. */
    private frameWatchers: ((frame: number) => void)[] = [];
    private frameCount = 0;
    private nextFrameId = 1;
    private frameTimer: ReturnType<typeof setTimeout> | null = null;
    private scrollPending = false;

    constructor(opts: RoomOptions) {
        this.H = opts.height ?? 800;
        this.shape = opts.shape;
        this.content = opts.content;
        this.basePadding = opts.padding ?? 0;
        this.fills = opts.fills ?? 0;
        this.transitions = opts.transitions ?? true;
        this.t0 = Date.now();
        const clock = () => this.now();
        this.doc = new FakeDocument();
        this.win = new FakeWindow(this.H, this, clock);
        if (opts.viewport !== false) this.win.visualViewport = new FakeViewport(this.H);
        const root = new FakeNode(this.doc, 'tv-overlay') as FakeNode & { style: RootStyle };
        root.style = new RootStyle(
            (name) => { if (name === OVERLAP_VAR) this.overlapWritten(); },
            () => this.transitionWritten(),
        );
        this.root = root;
        this.panel = new FakeNode(this.doc, 'tv-overlay__panel');
        this.body = new FakeBody(this.doc, this);
        this.root.append(this.panel);
        this.panel.append(this.body);
        // The plugin listens to the main window's keyboard from its load.
        trackKeyboard(this.win as unknown as Window);
    }

    /** The fake clock, from the room's making (ms). */
    now(): number { return Date.now() - this.t0; }

    // --- What is in the body ---

    /** An input whose bottom stands `at` px into the body's content. */
    field(at: number, { height = 30 }: { height?: number } = {}): FakeField {
        const f = new FakeField(this.doc, this, at, height);
        this.body.append(f);
        return f;
    }

    textarea(at: number, { height = 60 }: { height?: number } = {}): FakeTextArea {
        const f = new FakeTextArea(this.doc, this, at, height);
        this.body.append(f);
        return f;
    }

    /** An editable field running from the body's content top to `at`, its caret on the line ending at `caret`. */
    editable(at: number, caret: number, opts: { empty?: boolean } = {}): FakeEditable {
        const f = new FakeEditable(this.doc, this, at);
        this.body.append(f);
        f.caretTo(caret, opts);
        return f;
    }

    // --- The part under test ---

    /**
     * Make the part and attach it: the one place it is made. The root is
     * laid out from the next frame on, so an overlap written as it attaches
     * is shown at once; with `laidOut`, it was laid out before (the body
     * built reading the layout, as the hub's does), so that overlap moves
     * over the transition from none.
     */
    mount({ movesWithOverlap = true, laidOut = false }: { movesWithOverlap?: boolean; laidOut?: boolean } = {}): Mounted {
        const part = new KeyboardRoom(
            this.root as unknown as HTMLElement,
            this.win as unknown as Window,
            this.body as unknown as HTMLElement,
            { opening: () => this.opened(), movesWithOverlap: () => movesWithOverlap },
        );
        if (laidOut) this.styled = true;
        part.attach();
        this.styled = true;
        this.mounted = { detach: () => part.detach() };
        return this.mounted;
    }

    detach(): void {
        this.mounted?.detach();
    }

    // --- The keyboard ---

    /** One of Capacitor's events, with the `keyboardHeight` it carries. */
    native(cause: Exclude<KeyboardCause, 'viewportResize' | 'viewportScroll'>, height?: number): void {
        if (cause === 'keyboardWillHide' || cause === 'keyboardDidHide') this.nativeHeight = 0;
        else if (typeof height === 'number' && height >= 0) this.nativeHeight = height;
        this.win.fire(cause, height === undefined ? {} : { keyboardHeight: height });
    }

    /** The keyboard rising as iPad tells it: `keyboardWillShow`, then `keyboardDidShow` 440ms later. */
    iPadShow(height: number): void {
        this.native('keyboardWillShow', height);
        setTimeout(() => this.native('keyboardDidShow', height), IPAD_DID_SHOW_MS);
    }

    /** The keyboard going as iPad tells it: `keyboardWillHide`, then `keyboardDidHide` 3ms later. */
    iPadHide(): void {
        this.native('keyboardWillHide');
        setTimeout(() => this.native('keyboardDidHide'), IPAD_DID_HIDE_MS);
    }

    /** The visualViewport resized to `height` (Safari, Windows), its top at `offsetTop`. */
    viewport(height: number, offsetTop = 0): void {
        const vv = this.requireViewport();
        vv.height = height;
        vv.offsetTop = offsetTop;
        vv.fire('resize');
    }

    /** The visualViewport scrolled, its top now at `offsetTop`. */
    viewportScroll(offsetTop: number): void {
        const vv = this.requireViewport();
        vv.offsetTop = offsetTop;
        vv.fire('scroll');
    }

    private requireViewport(): FakeViewport {
        if (!this.win.visualViewport) throw new Error('the room was made with no visualViewport');
        return this.win.visualViewport;
    }

    /** The keyboard's top in the window (client px), the higher of the two ways it is told; the window's bottom with none. */
    keyboardTop(): number {
        const vv = this.win.visualViewport;
        const vvTop = vv ? vv.offsetTop + vv.height : Infinity;
        const nativeTop = this.nativeHeight > 0 ? this.H - this.nativeHeight : Infinity;
        const top = Math.min(vvTop, nativeTop);
        return top === Infinity ? this.H : top;
    }

    // --- The overlap on the root ---

    /** What the part last wrote on the root, as written; undefined while none is. */
    writtenOverlap(): string | undefined {
        return this.root.style.vars.get(OVERLAP_VAR);
    }

    /** The overlap the stylesheet lays out now, midway through its transition or at rest (px). */
    shownOverlap(): number {
        const move = this.overlapMove;
        if (!move || move.playState !== 'running') return this.written;
        return this.overlapFrom + (this.written - this.overlapFrom) * OVERLAP_EASE(move.progress());
    }

    /** A write on the root: the overlap moves from where it is shown to what was written. */
    private overlapWritten(): void {
        const value = this.root.style.vars.get(OVERLAP_VAR);
        const to = value === undefined ? 0 : (px(value) ?? 0);
        const from = this.shownOverlap();
        this.overlapMove?.cancel();
        this.overlapMove = null;
        this.written = to;
        if (!this.styled || !this.transitions || this.root.style.transition === 'none' || from === to) return;
        this.overlapFrom = from;
        this.overlapMove = new FakeAnimation(() => this.now(), this.root, OVERLAP_MS, { transition: OVERLAP_VAR });
    }

    /** The root's transition held off: the one under way is cancelled, what is written shown at once. */
    private transitionWritten(): void {
        if (this.root.style.transition !== 'none') return;
        this.overlapMove?.cancel();
        this.overlapMove = null;
    }

    /** Whether the overlap moves over its transition now. */
    overlapMoving(): boolean {
        return this.overlapMove?.playState === 'running';
    }

    // --- Other things that move in the root ---

    /** The panel coming in as the overlay opens: the sheet sliding up, the box popping in. */
    open(ms = OPENING_MS): FakeAnimation {
        this.opening = new FakeAnimation(() => this.now(), this.panel, ms,
            { animation: this.shape.kind === 'sheet' ? 'tv-overlay-slide' : 'tv-overlay-pop' });
        return this.opening;
    }

    /** What has the panel coming in, while it does; null once it is in. */
    opened(): Promise<void> | null {
        const a = this.opening;
        if (!a || a.playState !== 'running') return null;
        return a.finished.then(() => undefined, () => undefined);
    }

    /** A field's focus ring (its box-shadow's transition). */
    ring(field: FakeNode, ms = RING_MS): FakeAnimation {
        return new FakeAnimation(() => this.now(), field, ms, { transition: 'box-shadow' });
    }

    /** Any other animation on `on`, `ms` long (Infinity for one that never ends). */
    animate(on: FakeNode, ms: number, name = 'other'): FakeAnimation {
        return new FakeAnimation(() => this.now(), on, ms, { animation: name });
    }

    // --- Focus ---

    /** Focus `field`, as the DOM tells it: the field focused before leaves first. */
    focus(field: FakeNode, { ring = false }: { ring?: boolean } = {}): void {
        const before = this.doc.activeElement;
        if (before === field) return;
        this.doc.activeElement = field;
        if (before && this.root.contains(before)) this.root.fire('focusout', { target: before });
        if (ring) this.ring(field);
        if (this.root.contains(field)) this.root.fire('focusin', { target: field });
    }

    /** The focus leaving the fields (to nothing). */
    blur(): void {
        const before = this.doc.activeElement;
        this.doc.activeElement = null;
        if (before && this.root.contains(before)) this.root.fire('focusout', { target: before });
    }

    // --- Scrolling ---

    get scrollTop(): number { return this.readScrollTop(); }
    set scrollTop(v: number) { this.writeScrollTop(v); }

    /** The browser scrolling the body by itself (a field revealed, a fling going on): only `scroll` tells it. */
    browserScroll(top: number): void {
        this.writeScrollTop(top);
    }

    /** The user scrolling the body to `top` by a wheel or a finger moving on it. */
    userScroll(gesture: 'wheel' | 'touchmove', top: number): void {
        this.body.fire(gesture);
        this.writeScrollTop(top);
    }

    /** The body's scrollTop, kept within what it can scroll as it is laid out now, as a browser keeps it. */
    readScrollTop(): number {
        this.scroll = this.clampScroll(this.scroll);
        return this.scroll;
    }

    writeScrollTop(v: number): void {
        const before = this.readScrollTop();
        this.scroll = this.clampScroll(v);
        if (this.scroll !== before) this.queueScrollEvent();
    }

    private clampScroll(v: number): number {
        const l = this.layout();
        return Math.min(Math.max(0, v), Math.max(0, l.scrollHeight - l.bodyHeight));
    }

    /** The body's `scroll` is told at the next frame, before its frame callbacks run. */
    private queueScrollEvent(): void {
        this.scrollPending = true;
        this.scheduleFrame();
    }

    // --- Frames ---

    requestFrame(cb: (t: number) => void): number {
        const id = this.nextFrameId++;
        this.frames.push({ id, cb });
        this.scheduleFrame();
        return id;
    }

    cancelFrame(id: number): void {
        this.frames = this.frames.filter((f) => f.id !== id);
    }

    /** How many frame callbacks are asked for and not yet run. */
    framesAsked(): number {
        return this.frames.length;
    }

    /**
     * Have `fn` told at the end of each frame that runs, once its callbacks
     * have run, with the frame's number counted from this call.
     */
    watchFrames(fn: (frame: number) => void): void {
        this.frameCount = 0;
        this.frameWatchers.push(fn);
    }

    private scheduleFrame(): void {
        if (this.frameTimer !== null) return;
        const t = this.now();
        const wait = FRAME_MS - (t % FRAME_MS) || FRAME_MS;
        this.frameTimer = setTimeout(() => this.runFrame(), wait);
    }

    private runFrame(): void {
        this.frameTimer = null;
        if (this.scrollPending) {
            this.scrollPending = false;
            this.body.fire('scroll');
        }
        const due = this.frames;
        this.frames = [];
        const t = this.now();
        for (const f of due) f.cb(t);
        const n = this.frameCount++;
        for (const fn of this.frameWatchers) fn(n);
    }

    // --- Time ---

    /** Let `ms` pass on the fake clock, running what comes due. */
    async advance(ms: number): Promise<void> {
        await vi.advanceTimersByTimeAsync(ms);
    }

    /** Run every timer, frame and animation, and what they start, until nothing waits. */
    async settle(): Promise<void> {
        for (let i = 0; i < 100; i++) {
            await vi.runAllTimersAsync();
            for (let j = 0; j < 10; j++) await Promise.resolve();
            if (vi.getTimerCount() === 0) return;
        }
        throw new Error('the room did not come to rest');
    }

    // --- Where things stand ---

    /** The body's bottom padding as laid out: what is written inline, or the stylesheet's (px). */
    bodyPadding(): number {
        return px(this.body.style.paddingBottom) ?? this.basePadding;
    }

    /** The body's inline height, max-height and bottom padding, as written. */
    inline(): { height: string; maxHeight: string; paddingBottom: string } {
        const s = this.body.style;
        return { height: s.height, maxHeight: s.maxHeight, paddingBottom: s.paddingBottom };
    }

    /** Where the panel and the body stand now: under the overlap shown, the panel moved as far as it has come in. */
    layout(): RoomLayout {
        const l = this.layoutAt(this.shownOverlap());
        const a = this.opening;
        if (!a || a.playState !== 'running') return l;
        if (this.shape.kind === 'sheet') {
            const dy = (1 - SLIDE_EASE(a.progress())) * (l.panelBottom - l.panelTop);
            return { ...l, panelTop: l.panelTop + dy, panelBottom: l.panelBottom + dy, bodyTop: l.bodyTop + dy, bodyBottom: l.bodyBottom + dy };
        }
        const scale = 0.96 + 0.04 * POP_EASE(a.progress());
        const mid = (l.panelTop + l.panelBottom) / 2;
        const at = (y: number) => mid + (y - mid) * scale;
        return { ...l, panelTop: at(l.panelTop), panelBottom: at(l.panelBottom), bodyTop: at(l.bodyTop), bodyBottom: at(l.bodyBottom) };
    }

    /**
     * Where the panel and the body stand at rest under an overlap of
     * `overlap` px, with the body's inline height and padding as they are
     * now: the stylesheet's layout, in one place.
     */
    layoutAt(overlap: number): RoomLayout {
        const H = this.H;
        const pad = this.bodyPadding();
        const s = this.body.style;
        const lockedHeight = (natural: number) => {
            const h = px(s.height);
            const max = px(s.maxHeight);
            let out = h ?? natural;
            if (max !== null) out = Math.min(out, max);
            return out;
        };
        if (this.shape.kind === 'centered') {
            const { panel, bodyOffset, bodyHeight } = this.shape;
            const h = Math.min(panel, H - 2 * EDGE);
            const free = H - 2 * EDGE - h;
            const panelTop = EDGE + Math.max(0, Math.min(free / 2, free - overlap));
            const height = lockedHeight(bodyHeight - (panel - h));
            const bodyTop = panelTop + bodyOffset;
            const content = Math.max(this.content, Math.min(this.fills, height - pad));
            return {
                panelTop, panelBottom: panelTop + h,
                bodyTop, bodyBottom: bodyTop + height, bodyHeight: height,
                scrollHeight: Math.max(height, content + pad),
            };
        }
        const { above, below } = this.shape;
        const maxPanel = H - Math.max(EDGE, SHEET_ROOM_ABOVE - overlap);
        const room = maxPanel - overlap - above - below;
        const height = lockedHeight(Math.max(0, Math.min(this.content + pad, room)));
        const bodyBottom = H - overlap - below;
        const bodyTop = bodyBottom - height;
        return {
            panelTop: Math.max(H - maxPanel, bodyTop - above), panelBottom: H,
            bodyTop, bodyBottom, bodyHeight: height,
            scrollHeight: Math.max(height, this.content + pad),
        };
    }

    /** Where a point `at` px into the body's content stands in the window now (client px). */
    contentToClient(at: number): number {
        return this.layout().bodyTop + at - this.readScrollTop();
    }

    /** Where what is typed at in `field` ends in the window now: an input's bottom, an editable field's caret. */
    bottomOf(field: FakeNode): number {
        if (field instanceof FakeEditable) return field.caretBottom();
        return (field as FakeField).getBoundingClientRect().bottom;
    }

    /** The higher of the keyboard's top and the body's visible bottom, now (client px). */
    edge(): number {
        return Math.min(this.keyboardTop(), this.layout().bodyBottom);
    }
}

/**
 * The hooks every file using rooms needs: the DOM's field classes set while
 * it runs (the node environment has none), fake timers for each test, and
 * the windows' keyboards let go after it.
 */
export function useKeyboardRoomHarness(): void {
    let saved: { input: unknown; textarea: unknown } | null = null;
    beforeAll(() => {
        const g = globalThis as Record<string, unknown>;
        saved = { input: g.HTMLInputElement, textarea: g.HTMLTextAreaElement };
        g.HTMLInputElement = FakeInputElement;
        g.HTMLTextAreaElement = FakeTextAreaElement;
    });
    afterAll(() => {
        const g = globalThis as Record<string, unknown>;
        g.HTMLInputElement = saved?.input;
        g.HTMLTextAreaElement = saved?.textarea;
    });
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    });
    afterEach(() => {
        untrackAllKeyboards();
        vi.useRealTimers();
    });
}

/** A room laid out as `opts` says, its part not yet mounted. */
export function makeRoom(opts: RoomOptions): Room {
    return new Room(opts);
}
