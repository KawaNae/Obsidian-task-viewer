import { logDebug } from '../log/log';
import { trackKeyboard, nativeKeyboardHeight, keyboardTop } from './KeyboardState';
import { runningAnimations, whenStopped } from './Animations';

/** The CSS variable on the container: how much of the window the keyboard covers (px). */
export const KEYBOARD_OVERLAP_VAR = '--tv-keyboard-overlap';

/**
 * Mobile virtual keyboard awareness for fixed-position containers.
 *
 * While the keyboard covers the window, the container is told how much of
 * it the keyboard covers, as the CSS variable `--tv-keyboard-overlap` on it
 * (`max(0, innerHeight - keyboardTop)`). The container still covers the
 * whole window; the stylesheet ends the room its panel lays out its
 * contents in that far above the window's bottom: the box is centred above
 * the keyboard, and the sheet, its surface running on under the keyboard,
 * has its contents stand on it, so the panel's last row (its buttons) sits
 * right over the keyboard. The panel's contents shrink with that room, and
 * its body scrolls inside. With no keyboard, nothing is set and the
 * container lays out as ever.
 *
 * What is typed at is kept in sight in the body: when it stands below the
 * body's visible bottom (or the keyboard's top, if higher), the body is
 * scrolled by what it lacks. The body is above the keyboard and holds the
 * field, so its own scroll room is enough: nothing is padded, and its
 * height is not locked. When the keyboard closes, the body's scrollTop is
 * put back where it stood as the keyboard opened, whoever scrolled it
 * meanwhile (this, or the browser revealing a field focused by script).
 *
 * A field is an input, a textarea, or an editable element
 * (contenteditable: a CodeMirror editor's content). What is typed at is
 * the field's bottom for an input or a textarea, and the caret for an
 * editable element, whose lines may run below the visible bottom however
 * tall it grows: the caret is followed as it moves (`selectionchange`, which
 * the DOM fires for any editable element, CodeMirror's own selection
 * among them), so no editor has to tell of its caret.
 *
 * Where the field stands is read once the container has settled: an
 * animation running in it as the measure is asked for (the sheet sliding
 * up, the box popping in) moves the field it holds, and a position read
 * midway is not where the field comes to rest (on iPad the sheet's 150 ms
 * slide was read with the field still below the window, and the panel
 * scrolled 565 px where 67 would do), and the room shrinking above the
 * keyboard moves its bottom over a transition. Every measure (the keyboard opening
 * or moving, a field focused, the caret moving) goes through
 * `measureWhenSettled`, which waits for those animations to end, then
 * measures the field focused at that moment, if the keyboard is still open
 * and the container still attached. Animations that start later are not
 * waited for: a container closing detaches before its close animation.
 * Where the DOM cannot list them (`getAnimations`), it measures at once.
 *
 * Keyboard detection is dual-source (state は KeyboardState に集約):
 * - visualViewport resize — Windows / Safari 系。`innerHeight - vv.height`
 *   が縮む環境
 * - Capacitor Keyboard events (`keyboardWillShow` 等の window イベント、
 *   `keyboardHeight` 付き) — Obsidian mobile (Android/iOS)。WebView が
 *   リサイズされず visualViewport が一切変化しないため、ネイティブ側の
 *   通知が唯一の検知源（実機観測: ih=vvH のまま、
 *   keyboardWillShow h=336 のみ発火）
 */
export class KeyboardAwareContainer {
    private vvHandler: (() => void) | null = null;
    private kbHandler: (() => void) | null = null;
    private focusHandler: ((e: FocusEvent) => void) | null = null;
    private blurHandler: (() => void) | null = null;
    private blurTimer: ReturnType<typeof setTimeout> | null = null;
    private focusTimer: ReturnType<typeof setTimeout> | null = null;
    private selectionHandler: (() => void) | null = null;
    private selectionFrame: number | null = null;
    /** The body's scrollTop as the keyboard opened, or as it was first scrolled for it. */
    private savedScrollTop: number | null = null;
    /** The overlap last given to the container (px), 0 while none is set. */
    private overlap = 0;
    private keyboardOpen = false;
    /** A measure waits for the container's animations to end (`measureWhenSettled`). */
    private settling = false;
    /** Counted up on each detach, so a wait begun before it measures nothing. */
    private attachment = 0;
    scrollTarget: HTMLElement | null = null;

    constructor(
        private container: HTMLElement,
        private win: Window,
    ) {}

    attach(): void {
        trackKeyboard(this.win);

        const vv = this.win.visualViewport;
        if (vv) {
            this.vvHandler = () => this.syncState();
            vv.addEventListener('resize', this.vvHandler);
            vv.addEventListener('scroll', this.vvHandler);
        }

        // Capacitor Keyboard プラグイン（Obsidian mobile）。高さの追跡は
        // KeyboardState が常駐で行うので、ここでは再計算のトリガーだけ受ける。
        // 非 Capacitor 環境ではこれらのイベントは発火しない。
        this.kbHandler = () => this.syncState();
        this.win.addEventListener('keyboardWillShow', this.kbHandler);
        this.win.addEventListener('keyboardDidShow', this.kbHandler);
        this.win.addEventListener('keyboardWillHide', this.kbHandler);
        this.win.addEventListener('keyboardDidHide', this.kbHandler);

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

        // Where the body stood as the keyboard opened is where it goes back
        // to: a field focused afterwards may have the browser scroll the
        // body to it before it is measured, the body having shrunk.
        if (this.keyboardOpen && !wasOpen && this.savedScrollTop === null && this.scrollTarget) {
            this.savedScrollTop = this.scrollTarget.scrollTop;
        }

        this.setOverlap(this.keyboardOpen
            ? Math.max(0, this.win.innerHeight - keyboardTop(this.win))
            : 0);

        if (this.keyboardOpen) {
            this.measureWhenSettled();
        } else if (wasOpen) {
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
     * Measure the focused field once the animations running in the container
     * now have ended, at once when none runs. A measure asked for while one
     * waits joins it: the wait measures what is current when it ends.
     */
    private measureWhenSettled(): void {
        if (this.settling) return;
        const moving = runningAnimations(this.container);
        if (moving.length === 0) {
            this.measure();
            return;
        }
        this.settling = true;
        const attachment = this.attachment;
        void whenStopped(moving).then(() => {
            if (attachment !== this.attachment) return;
            this.settling = false;
            this.measure();
        });
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
     * keyboard's top where that is higher (a panel the stylesheet does not
     * lift: an anchored popover, placed by script), scroll the body by what
     * it lacks. Nothing when it is in sight.
     */
    private ensureAboveKeyboard(target: HTMLElement): void {
        const panel = this.scrollTarget;
        if (!panel) return;

        const kbTop = keyboardTop(this.win);
        const limit = Math.min(kbTop, panel.getBoundingClientRect().bottom);
        const bottom = target.isContentEditable
            ? (caretRect(target)?.bottom ?? target.getBoundingClientRect().bottom)
            : target.getBoundingClientRect().bottom;
        const overshoot = bottom - limit + 10;
        if (overshoot <= 0) return;
        logDebug(`[kb] scroll overshoot=${Math.round(overshoot)} limit=${Math.round(limit)} kbTop=${Math.round(kbTop)}`);

        if (this.savedScrollTop === null) this.savedScrollTop = panel.scrollTop;
        panel.scrollBy({ top: overshoot, behavior: 'instant' });
    }

    /** Put the body's scroll back where it was before the keyboard moved it. */
    private restore(): void {
        if (this.savedScrollTop === null || !this.scrollTarget) return;
        logDebug('[kb] restore');
        this.scrollTarget.scrollTo({ top: this.savedScrollTop, behavior: 'instant' });
        this.savedScrollTop = null;
    }

    detach(): void {
        const vv = this.win.visualViewport;
        if (vv && this.vvHandler) {
            vv.removeEventListener('resize', this.vvHandler);
            vv.removeEventListener('scroll', this.vvHandler);
        }
        if (this.kbHandler) {
            this.win.removeEventListener('keyboardWillShow', this.kbHandler);
            this.win.removeEventListener('keyboardDidShow', this.kbHandler);
            this.win.removeEventListener('keyboardWillHide', this.kbHandler);
            this.win.removeEventListener('keyboardDidHide', this.kbHandler);
        }
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
        // The overlap given to the container is left on it: a container
        // closing over the open keyboard leaves where it stands.
        this.restore();
        this.vvHandler = null;
        this.kbHandler = null;
        this.focusHandler = null;
        this.blurHandler = null;
        this.blurTimer = null;
        this.focusTimer = null;
        this.selectionHandler = null;
        this.selectionFrame = null;
        this.keyboardOpen = false;
        this.settling = false;
        this.attachment++;
        this.scrollTarget = null;
    }
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
