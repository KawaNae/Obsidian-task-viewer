import { logDebug } from '../log/log';
import { trackKeyboard, nativeKeyboardHeight, keyboardTop } from './KeyboardState';

/**
 * Mobile virtual keyboard awareness for fixed-position containers.
 *
 * Never moves the container or the panel itself. When the keyboard
 * covers the focused input, the panel's height is locked at its
 * current value and just enough bottom padding is injected to create
 * scroll room, then the contents are scrolled so the input's bottom
 * sits at the keyboard's top edge. Everything (height / padding /
 * scrollTop) is restored when the keyboard closes.
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
    /** panel inline styles + scrollTop as they were before we touched them */
    private saved: { height: string; paddingBottom: string; scrollTop: number } | null = null;
    /** CSS-computed padding-bottom (px) captured before inline override */
    private basePad = 0;
    /** cumulative injected scroll room (px) */
    private extraPad = 0;
    private keyboardOpen = false;
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
            if (!(target instanceof HTMLInputElement ||
                  target instanceof HTMLTextAreaElement)) return;
            if (this.blurTimer) { clearTimeout(this.blurTimer); this.blurTimer = null; }
            if (this.focusTimer) clearTimeout(this.focusTimer);
            this.focusTimer = setTimeout(() => {
                this.focusTimer = null;
                if (this.keyboardOpen && this.activeInput() === target) {
                    this.ensureAboveKeyboard(target);
                }
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
            const active = this.activeInput();
            if (active) this.ensureAboveKeyboard(active);
        } else if (wasOpen) {
            this.restore();
        }
    }

    /** container 内のフォーカス中 input/textarea（なければ null） */
    private activeInput(): HTMLElement | null {
        const active = this.container.ownerDocument.activeElement;
        if (this.container.contains(active) &&
            (active instanceof HTMLInputElement ||
             active instanceof HTMLTextAreaElement)) {
            return active;
        }
        return null;
    }

    /**
     * target の下端がキーボード上端より下にある場合のみ、不足分ちょうどを
     * パネル内スクロールで解消する。パネルの高さは lock するので、padding
     * 注入でパネル自体が成長・移動することはない。
     */
    private ensureAboveKeyboard(target: HTMLElement): void {
        const panel = this.scrollTarget;
        if (!panel) return;

        const kbTop = keyboardTop(this.win);
        const overshoot =
            target.getBoundingClientRect().bottom - kbTop + 10;
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

        this.extraPad += overshoot;
        panel.style.paddingBottom = `${this.basePad + this.extraPad}px`;
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
        this.restore();
        this.vvHandler = null;
        this.kbHandler = null;
        this.focusHandler = null;
        this.blurHandler = null;
        this.blurTimer = null;
        this.focusTimer = null;
        this.keyboardOpen = false;
        this.scrollTarget = null;
    }
}
