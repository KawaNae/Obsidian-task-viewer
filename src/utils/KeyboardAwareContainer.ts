import { logDebug } from '../log/log';
import { watchKeyboard, nativeKeyboardHeight, keyboardTop, keyboardOverlap, type KeyboardChange } from './KeyboardWatch';
import { runningAnimations, whenStopped } from './Animations';

/** The CSS variable on the container: how much of the window the keyboard covers (px). */
export const KEYBOARD_OVERLAP_VAR = '--tv-keyboard-overlap';

/**
 * How many times a wait for the container to come to rest lists its
 * animations again: far past the few that run as the keyboard rises (the
 * sheet's slide, a field's focus ring, the overlap's transition), so it is
 * reached only where animations never stop starting.
 */
const SETTLE_ROUNDS = 10;

/**
 * Mobile virtual keyboard awareness for fixed-position containers.
 *
 * While the keyboard covers the window, the container is told how much of
 * it the keyboard covers, as the CSS variable `--tv-keyboard-overlap` on it
 * (`max(0, innerHeight - keyboardTop)`). The container still covers the
 * whole window. The stylesheet has the sheet's contents stand on the
 * keyboard, its surface running on under it, so the panel's last row (its
 * buttons) sits right over the keyboard and the body shrinks and scrolls
 * inside, the room kept above the sheet giving way to the keyboard; the box
 * keeps its size and its place in the window's middle, and rises only by
 * what it lacks to end 32px above the keyboard, as far up as 32px from the
 * window's top, the keyboard covering the lower part of a box taller than
 * the room above it. With no keyboard, nothing is set and the container
 * lays out as ever.
 *
 * What is typed at is kept in sight in the body: when it stands below the
 * body's visible bottom, or the keyboard's top where that is higher, the
 * body is scrolled by what it lacks. Where the body ends above the keyboard
 * (the sheet), its own scroll room is enough. Where the keyboard covers the
 * body's lower part (a tall box), the body's height is locked at its current
 * value and its bottom is padded by what it lacks of the scroll room, so
 * the padding neither grows nor moves the box. The lock is a max-height as well as a
 * height: a flex item whose basis falls back to its content (`flex: 1` in a
 * column of no set height) takes no height, and would grow by the padding,
 * while a max-height bounds it however it is laid out. Which of the two it is is read from
 * where the body ends, not from the layout. When the keyboard closes, the
 * focus leaves the fields, or the container detaches, the height and the
 * padding are put back, and the body's scrollTop goes back where it stood
 * as the keyboard opened (or as the container attached over an open
 * keyboard): what this, or the browser revealing a field focused by
 * script, scrolled it by for the keyboard is given back. Once the user
 * scrolls the body (a wheel, a finger moving on it) that position is
 * dropped, and the body stays where the user took it; a later scroll for
 * a field goes back to where it stood just before. A `scroll` event cannot
 * tell the user's scroll from these, so the gestures are listened to.
 *
 * A field is an input, a textarea, or an editable element
 * (contenteditable: a CodeMirror editor's content). What is typed at is
 * the field's bottom for an input or a textarea, and the caret for an
 * editable element, whose lines may run below the visible bottom however
 * tall it grows: the caret is followed as it moves (`selectionchange`, which
 * the DOM fires for any editable element, CodeMirror's own selection
 * among them), so no editor has to tell of its caret.
 *
 * Where the field stands is read once the container has come to rest: an
 * animation running in it (the sheet sliding up, the box popping in, the
 * room above the keyboard moving over the overlap's transition) moves the
 * field it holds, and a position read midway is not where the field comes
 * to rest (on iPad the sheet's 150 ms slide was read with the field still
 * below the window, and the panel scrolled 565 px where 67 would do).
 * Every measure (the keyboard opening or moving, a field focused, the
 * caret moving) goes through `measureWhenSettled`, which waits until no
 * animation that will end runs in the container, then measures the field
 * focused at that moment. The animations are listed again each time those
 * waited for have stopped, and waited for again while any runs: a measure
 * asked for during a wait joins it, so the wait has to take in what started
 * meanwhile. On iPad a field focused as a low sheet opened had its wait
 * begun on the field's focus ring; the keyboard's show, coming while it ran,
 * joined that wait, which ended with the ring before the overlap's
 * transition, and the sheet read on its way up had its body locked, padded
 * and scrolled for a keyboard it ends above, the field put out of sight
 * above the body. The wait ends without a measure when the keyboard closes
 * or the container detaches; a container closing detaches before its close
 * animation, which is never waited for. Where the DOM cannot list the
 * animations (`getAnimations`), it measures at once; past a bound on the
 * times they are listed, it measures however things stand.
 *
 * The keyboard is told two ways, both followed through `KeyboardWatch`:
 * - the visualViewport resizing or scrolling (Windows, Safari): the window's
 *   `innerHeight - vv.height` grows
 * - Capacitor's events on the window (`keyboardWillShow` and the like, with
 *   a `keyboardHeight`), on Obsidian mobile (Android, iOS): the WebView is
 *   not resized and the visualViewport never changes, so they are all that
 *   tells it (seen on a device: ih=vvH throughout, only
 *   keyboardWillShow h=336 fired)
 */
export class KeyboardAwareContainer {
    /** Stops following the keyboard, while it is followed. */
    private unwatch: (() => void) | null = null;
    private focusHandler: ((e: FocusEvent) => void) | null = null;
    private blurHandler: (() => void) | null = null;
    private blurTimer: ReturnType<typeof setTimeout> | null = null;
    private focusTimer: ReturnType<typeof setTimeout> | null = null;
    private selectionHandler: (() => void) | null = null;
    private selectionFrame: number | null = null;
    private userScrollHandler: (() => void) | null = null;
    /** The body's scrollTop as the keyboard opened, or as it was first scrolled for it. */
    private savedScrollTop: number | null = null;
    /** The body's inline height, max-height and padding before it was locked and padded, while it is. */
    private savedStyle: { height: string; maxHeight: string; paddingBottom: string } | null = null;
    /** The body's padding-bottom from the stylesheet as it was locked (px). */
    private basePad = 0;
    /** The scroll room added to the body's bottom while it is locked (px). */
    private extraPad = 0;
    /** The overlap last given to the container (px), 0 while none is set. */
    private overlap = 0;
    private keyboardOpen = false;
    /** A measure waits for the container to come to rest (`measureWhenSettled`). */
    private settling = false;
    /** Counted up on each wait begun or given up, so a wait no longer current measures nothing. */
    private wait = 0;
    /** For the log: when the wait under way began (ms), and what each of its rounds waited for. */
    private waitLog: { start: number; rounds: string[] } | null = null;

    /**
     * `scrollTarget` is the body that scrolls in the container. It is given
     * here, before `attach`, so a keyboard already open as the container
     * attaches has the body's scrollTop kept from the start.
     */
    constructor(
        private readonly container: HTMLElement,
        private readonly win: Window,
        private readonly scrollTarget: HTMLElement,
    ) {}

    attach(): void {
        // The keyboard's height is kept by KeyboardWatch before this is
        // told, so it is laid out again for the height just told.
        this.unwatch = watchKeyboard(this.win, (change: KeyboardChange) => {
            if (change.cause !== 'viewportResize' && change.cause !== 'viewportScroll') {
                logDebug(`[kb] ${change.cause} h=${change.height ?? '-'} ih=${this.win.innerHeight}`);
            }
            this.syncState();
        });

        // キーボード表示中のフィールド間フォーカス移動（検知イベントは
        // 再発火しない）
        this.focusHandler = (e: FocusEvent) => {
            const target = e.target;
            if (!isField(target)) return;
            if (this.blurTimer) { clearTimeout(this.blurTimer); this.blurTimer = null; }
            if (this.focusTimer) clearTimeout(this.focusTimer);
            this.focusTimer = setTimeout(() => {
                this.focusTimer = null;
                this.measureWhenSettled();
            }, 50);
        };
        this.container.addEventListener('focusin', this.focusHandler);

        this.blurHandler = () => {
            if (this.blurTimer) clearTimeout(this.blurTimer);
            this.blurTimer = setTimeout(() => {
                if (!this.activeInput()) this.restore();
            }, 200);
        };
        this.container.addEventListener('focusout', this.blurHandler);

        // The caret of an editable field moving while the keyboard is open
        // (typing on to a new line, a tap further down): once a frame.
        this.selectionHandler = () => {
            if (!this.keyboardOpen || this.selectionFrame !== null) return;
            const follow = () => {
                this.selectionFrame = null;
                this.measureWhenSettled();
            };
            if (typeof this.win.requestAnimationFrame === 'function') {
                this.selectionFrame = this.win.requestAnimationFrame(follow);
            } else {
                follow();
            }
        };
        this.container.ownerDocument.addEventListener('selectionchange', this.selectionHandler);

        // The user scrolling the body: where it stood for the keyboard is
        // no longer where it goes back to.
        this.userScrollHandler = () => { this.savedScrollTop = null; };
        this.scrollTarget.addEventListener('wheel', this.userScrollHandler, { passive: true });
        this.scrollTarget.addEventListener('touchmove', this.userScrollHandler, { passive: true });

        // A keyboard already open as the container attaches (a dialog opened
        // from another while typing) is laid out above at once.
        this.syncState();
    }

    /** 両検知源から開閉状態を再計算し、必要な補正/復元を行う */
    private syncState(): void {
        const vv = this.win.visualViewport;
        const vvKb = vv ? this.win.innerHeight - vv.height : 0;
        const nativeKb = nativeKeyboardHeight(this.win);
        const wasOpen = this.keyboardOpen;
        this.keyboardOpen = vvKb > 50 || nativeKb > 50;

        if (this.keyboardOpen !== wasOpen) {
            logDebug(
                `[kb] ${this.keyboardOpen ? 'open' : 'close'}` +
                ` vvKb=${Math.round(vvKb)} native=${nativeKb}` +
                ` ih=${this.win.innerHeight}`);
        }

        // Where the body stood as the keyboard opened (the attach, for a
        // keyboard already open) is where it goes back to: a field focused afterwards may have the browser scroll the
        // body to it before it is measured, the body having shrunk.
        if (this.keyboardOpen && !wasOpen && this.savedScrollTop === null) {
            this.savedScrollTop = this.scrollTarget.scrollTop;
        }

        this.setOverlap(this.keyboardOpen ? keyboardOverlap(this.win) : 0);

        if (this.keyboardOpen) {
            this.measureWhenSettled();
        } else if (wasOpen) {
            this.endWait();
            this.restore();
        }
    }

    /** Tell the container how much of the window the keyboard covers; none at 0. */
    private setOverlap(px: number): void {
        const rounded = Math.round(px);
        if (rounded === this.overlap) return;
        this.overlap = rounded;
        const style = this.container.style;
        if (rounded > 0) {
            style.setProperty(KEYBOARD_OVERLAP_VAR, `${rounded}px`);
        } else {
            style.removeProperty(KEYBOARD_OVERLAP_VAR);
        }
    }

    /** How much of the window the keyboard covers, as last given to the container (px). */
    keyboardOverlap(): number {
        return this.overlap;
    }

    /**
     * Measure the focused field once the container has come to rest, at
     * once when it is. A measure asked for while one waits joins it: the
     * wait measures what is current when it ends.
     */
    private measureWhenSettled(): void {
        if (this.settling) return;
        this.settling = true;
        this.waitLog = { start: now(this.win), rounds: [] };
        this.settle(++this.wait, 0);
    }

    /**
     * One step of a wait: list the animations running in the container,
     * and wait for them to stop, then list them again; measure once none
     * runs.
     */
    private settle(wait: number, rounds: number): void {
        if (wait !== this.wait) return;
        const moving = rounds < SETTLE_ROUNDS ? runningAnimations(this.container, { subtree: true }) : [];
        if (moving.length > 0) {
            this.waitLog?.rounds.push(`[${moving.map(describeAnimation).join(' ')}]`);
            void whenStopped(moving).then(() => this.settle(wait, rounds + 1));
            return;
        }
        this.settling = false;
        this.logWait('settled');
        this.measure();
    }

    /** Give up the wait under way, if any: it measures nothing. */
    private endWait(): void {
        if (this.settling) this.logWait('given up');
        this.settling = false;
        this.wait++;
    }

    /** One line for a wait that waited (a round), as it ends. */
    private logWait(how: string): void {
        const log = this.waitLog;
        this.waitLog = null;
        if (!log || log.rounds.length === 0) return;
        logDebug(
            `[kb] ${how} after=${Math.round(now(this.win) - log.start)}ms` +
            ` rounds=${log.rounds.join('')}`);
    }

    /** Keep the field focused in the container above the keyboard, while it is open. */
    private measure(): void {
        if (!this.keyboardOpen) return;
        const active = this.activeInput();
        if (active) this.ensureAboveKeyboard(active);
    }

    /** container 内のフォーカス中の欄（なければ null） */
    private activeInput(): HTMLElement | null {
        const active = this.container.ownerDocument.activeElement;
        if (this.container.contains(active) && isField(active)) {
            return active;
        }
        return null;
    }

    /**
     * When what is typed at (an input's or a textarea's bottom, an editable
     * element's caret) stands below the body's visible bottom, or below the
     * keyboard's top where that is higher, scroll the body by what it lacks.
     * Nothing when it is in sight. Where the keyboard covers the body's
     * bottom, the body's height is locked first, and its bottom padded by
     * what it lacks of the scroll room, so the padding adds scroll room only.
     */
    private ensureAboveKeyboard(target: HTMLElement): void {
        const panel = this.scrollTarget;
        const kbTop = keyboardTop(this.win);
        const panelRect = panel.getBoundingClientRect();
        const limit = Math.min(kbTop, panelRect.bottom);
        const bottom = target.isContentEditable
            ? (caretRect(target)?.bottom ?? target.getBoundingClientRect().bottom)
            : target.getBoundingClientRect().bottom;
        const overshoot = bottom - limit + 10;
        if (overshoot <= 0) return;
        const covered = kbTop < panelRect.bottom;
        logDebug(
            `[kb] scroll overshoot=${Math.round(overshoot)} limit=${Math.round(limit)}` +
            ` kbTop=${Math.round(kbTop)} covered=${covered}` +
            ` bodyBottom=${Math.round(panelRect.bottom)} field=${Math.round(bottom)}`);

        if (this.savedScrollTop === null) this.savedScrollTop = panel.scrollTop;
        if (covered) {
            if (!this.savedStyle) {
                this.savedStyle = {
                    height: panel.style.height,
                    maxHeight: panel.style.maxHeight,
                    paddingBottom: panel.style.paddingBottom,
                };
                this.basePad = parseFloat(this.win.getComputedStyle(panel).paddingBottom) || 0;
                this.extraPad = 0;
                const locked = `${panelRect.height}px`;
                panel.style.height = locked;
                panel.style.maxHeight = locked;
            }
            const room = Math.max(0, (panel.scrollHeight - panel.clientHeight - panel.scrollTop) || 0);
            if (overshoot > room) {
                this.extraPad += overshoot - room;
                panel.style.paddingBottom = `${this.basePad + this.extraPad}px`;
            }
        }
        panel.scrollBy({ top: overshoot, behavior: 'instant' });
    }

    /** Put the body's height, padding and scroll back where they were before the keyboard moved them. */
    private restore(): void {
        const panel = this.scrollTarget;
        if (this.savedStyle) {
            panel.style.height = this.savedStyle.height;
            panel.style.maxHeight = this.savedStyle.maxHeight;
            panel.style.paddingBottom = this.savedStyle.paddingBottom;
            this.savedStyle = null;
            this.extraPad = 0;
        }
        if (this.savedScrollTop === null) return;
        logDebug('[kb] restore');
        panel.scrollTo({ top: this.savedScrollTop, behavior: 'instant' });
        this.savedScrollTop = null;
    }

    detach(): void {
        this.unwatch?.();
        this.unwatch = null;
        if (this.focusHandler) {
            this.container.removeEventListener('focusin', this.focusHandler);
        }
        if (this.blurHandler) {
            this.container.removeEventListener('focusout', this.blurHandler);
        }
        if (this.blurTimer) clearTimeout(this.blurTimer);
        if (this.focusTimer) clearTimeout(this.focusTimer);
        if (this.selectionHandler) {
            this.container.ownerDocument.removeEventListener('selectionchange', this.selectionHandler);
        }
        if (this.selectionFrame !== null) this.win.cancelAnimationFrame(this.selectionFrame);
        if (this.userScrollHandler) {
            this.scrollTarget.removeEventListener('wheel', this.userScrollHandler);
            this.scrollTarget.removeEventListener('touchmove', this.userScrollHandler);
        }
        // The overlap given to the container is left on it: a container
        // closing over the open keyboard leaves where it stands.
        this.restore();
        this.focusHandler = null;
        this.blurHandler = null;
        this.blurTimer = null;
        this.focusTimer = null;
        this.selectionHandler = null;
        this.selectionFrame = null;
        this.userScrollHandler = null;
        this.keyboardOpen = false;
        this.endWait();
    }
}

/** The window's clock (ms), for the log. */
function now(win: Window): number {
    return win.performance?.now() ?? Date.now();
}

/** For the log: what an animation moves (a transition's property, an animation's name) and on what (its target's class). */
function describeAnimation(a: Animation): string {
    const what = (a as Animation & { transitionProperty?: string }).transitionProperty
        ?? (a as Animation & { animationName?: string }).animationName
        ?? a.constructor.name;
    const target = (a.effect as KeyframeEffect | null)?.target;
    const cls = target?.getAttribute?.('class')?.trim().split(/\s+/)[0] ?? '?';
    return `${what}@${cls}`;
}

/** An input, a textarea, or an editable element (contenteditable, and what is in one). */
function isField(node: EventTarget | null): node is HTMLElement {
    return node instanceof HTMLInputElement
        || node instanceof HTMLTextAreaElement
        || (node as HTMLElement | null)?.isContentEditable === true;
}

/**
 * Where the caret of an editable field stands: the selection's focus, as
 * the DOM lays it out, when it is in `field`. A caret between elements (an
 * empty line) has no box of its own, and stands for the element it is in.
 */
export function caretRect(field: HTMLElement): DOMRect | null {
    const doc = field.ownerDocument;
    const selection = doc.getSelection();
    const node = selection?.focusNode ?? null;
    if (!selection || !node || !field.contains(node)) return null;
    const range = doc.createRange();
    range.setStart(node, selection.focusOffset);
    range.collapse(true);
    const rects = range.getClientRects();
    const last = rects.length > 0 ? rects[rects.length - 1] : null;
    if (last && last.height > 0) return last;
    const el = node.nodeType === 1 ? node as Element : node.parentElement;
    return el ? el.getBoundingClientRect() : null;
}
