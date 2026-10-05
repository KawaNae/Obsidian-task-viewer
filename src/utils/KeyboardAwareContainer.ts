import { logDebug } from '../log/log';
import { trackKeyboard, nativeKeyboardHeight, keyboardTop } from './KeyboardState';

/**
 * Mobile virtual keyboard awareness for fixed-position containers.
 *
 * Never moves the container or the panel itself. When the keyboard
 * covers the focused field, the panel's height is locked at its
 * current value, bottom padding is injected where the panel lacks the
 * scroll room, and the contents are scrolled so what is typed at sits
 * at the keyboard's top edge. Everything (height / padding / scrollTop)
 * is restored when the keyboard closes.
 *
 * A field is an input, a textarea, or an editable element
 * (contenteditable: a CodeMirror editor's content). What is typed at is
 * the field's bottom for an input or a textarea, and the caret for an
 * editable element, whose lines may run below the keyboard however tall
 * it grows: the caret is followed as it moves (`selectionchange`, which
 * the DOM fires for any editable element, CodeMirror's own selection
 * among them), so no editor has to tell of its caret.
 *
 * Where the field stands is read once the container has settled: an
 * animation running in it as the measure is asked for (the sheet sliding
 * up, the box popping in) moves the field it holds, and a position read
 * midway is not where the field comes to rest (on iPad the sheet's 150 ms
 * slide was read with the field still below the window, and the panel
 * scrolled 565 px where 67 would do). Every measure (the keyboard opening
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
 *   通知が唯一の検知源（実機観測 2026-07-08: ih=vvH のまま、
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
    /** panel inline styles + scrollTop as they were before we touched them */
    private saved: { height: string; paddingBottom: string; scrollTop: number } | null = null;
    /** CSS-computed padding-bottom (px) captured before inline override */
    private basePad = 0;
    /** cumulative injected scroll room (px) */
    private extraPad = 0;
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

        if (this.keyboardOpen) {
            this.measureWhenSettled();
        } else if (wasOpen) {
            this.restore();
        }
    }

    /**
     * Measure the focused field once the animations running in the container
     * now have ended, at once when none runs. A measure asked for while one
     * waits joins it: the wait measures what is current when it ends.
     */
    private measureWhenSettled(): void {
        if (this.settling) return;
        const moving = this.runningAnimations();
        if (moving.length === 0) {
            this.measure();
            return;
        }
        this.settling = true;
        const attachment = this.attachment;
        // A cancelled animation (the sheet dragged by its handle) rejects
        // `finished`: it has stopped moving all the same.
        void Promise.allSettled(moving.map((a) => a.finished)).then(() => {
            if (attachment !== this.attachment) return;
            this.settling = false;
            this.measure();
        });
    }

    /**
     * The animations running in the container and what is in it that will
     * end (an endless one, a spinner, would keep the field from ever being
     * measured). None where the DOM cannot list them.
     */
    private runningAnimations(): Animation[] {
        if (typeof this.container.getAnimations !== 'function') return [];
        return this.container.getAnimations({ subtree: true }).filter((a) =>
            a.playState === 'running'
            && Number.isFinite(Number(a.effect?.getComputedTiming().endTime ?? Infinity)));
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
     * 打つ位置（input/textarea は欄の下端、編集可能な要素は字句）がキーボード
     * 上端より下にある場合のみ、不足分ちょうどをパネル内スクロールで解消する。
     * パネルの高さは lock するので、padding 注入でパネル自体が成長・移動する
     * ことはない。padding はスクロールの余地が足りない分だけ足す。
     */
    private ensureAboveKeyboard(target: HTMLElement): void {
        const panel = this.scrollTarget;
        if (!panel) return;

        const kbTop = keyboardTop(this.win);
        const bottom = target.isContentEditable
            ? (caretRect(target)?.bottom ?? target.getBoundingClientRect().bottom)
            : target.getBoundingClientRect().bottom;
        const overshoot = bottom - kbTop + 10;
        if (overshoot <= 0) return; // 被っていない → 何もしない
        logDebug(`[kb] scroll overshoot=${Math.round(overshoot)} kbTop=${Math.round(kbTop)}`);

        if (!this.saved) {
            this.saved = {
                height: panel.style.height,
                paddingBottom: panel.style.paddingBottom,
                scrollTop: panel.scrollTop,
            };
            this.basePad = parseFloat(
                this.win.getComputedStyle(panel).paddingBottom) || 0;
            this.extraPad = 0;
            // 高さを現在値で固定 — 以降の padding はスクロール余地にだけ効く
            panel.style.height = `${panel.getBoundingClientRect().height}px`;
        }

        const room = Math.max(0, (panel.scrollHeight - panel.clientHeight - panel.scrollTop) || 0);
        if (overshoot > room) {
            this.extraPad += overshoot - room;
            panel.style.paddingBottom = `${this.basePad + this.extraPad}px`;
        }
        panel.scrollBy({ top: overshoot, behavior: 'instant' });
    }

    private restore(): void {
        if (!this.saved || !this.scrollTarget) return;
        logDebug('[kb] restore');
        const panel = this.scrollTarget;
        panel.style.height = this.saved.height;
        panel.style.paddingBottom = this.saved.paddingBottom;
        panel.scrollTo({ top: this.saved.scrollTop, behavior: 'instant' });
        this.saved = null;
        this.extraPad = 0;
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
