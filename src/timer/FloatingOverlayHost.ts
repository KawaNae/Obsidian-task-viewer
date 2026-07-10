/**
 * Window-scoped floating overlay container.
 *
 * Owns the DOM container element for a floating widget (timer widget today;
 * could be reused for other window-anchored overlays). Encapsulates:
 *   - container creation / disposal in a specific window's body
 *   - drag-to-move (pointer capture, viewport-relative coordinates)
 *   - resize-driven viewport clamp so the widget never gets stranded off-screen
 *   - drag-end notification used by the observer to defer window migration
 *
 * The widget's logical state (timers, intervals, render content) lives outside
 * this host, in plugin scope. attach()/detach() only move the DOM. Position
 * is preserved across attaches so a widget that was dragged in one window
 * keeps its coordinates when migrated to another (clamp re-runs against the
 * new viewport in case the destination window is smaller).
 */

import { trackKeyboard, keyboardTop } from '../utils/KeyboardState';

const DEFAULT_OFFSET = 24;

export interface FloatingOverlayHostOptions {
    /**
     * Selectors inside the container whose clicks must not start a drag (they
     * are interactive: buttons, pin badge, inputs). The drag handler ignores
     * pointerdown when target.closest(selector) matches any of these.
     */
    nonDraggableSelectors: string[];
}

export class FloatingOverlayHost {
    private container: HTMLElement | null = null;
    private win: Window | null = null;
    private doc: Document | null = null;
    private resizeHandler: (() => void) | null = null;
    private vvResizeHandler: (() => void) | null = null;
    private kbHandler: (() => void) | null = null;
    private dragging = false;
    private dragOffset = { x: 0, y: 0 };
    private onDragEndCb: (() => void) | null = null;
    /**
     * null = use CSS-default position (bottom-right corner). Once the user
     * drags the widget, an explicit {left, top} is recorded and re-applied
     * on every attach so the widget tracks the user's choice across windows.
     */
    private userPosition: { left: number; top: number } | null = null;

    constructor(private opts: FloatingOverlayHostOptions) {}

    attach(win: Window, doc: Document, className: string): HTMLElement {
        if (this.container) {
            // Defensive: previous attach was not balanced. Detach to keep
            // listeners and DOM consistent.
            this.detach();
        }
        this.win = win;
        this.doc = doc;
        this.container = doc.body.createDiv(className);
        this.applyPosition();
        this.setupDrag();
        this.resizeHandler = () => this.clampToViewport();
        win.addEventListener('resize', this.resizeHandler);

        // 仮想キーボード退避: 被る分だけ transform で持ち上げ、閉じたら復元。
        // clampToViewport（left/top の恒久書き換え）とは独立に動く。
        // 検知は KeyboardState と同じ二本立て（vv = Windows/Safari、
        // Capacitor イベント = Obsidian mobile）。
        trackKeyboard(win);
        this.kbHandler = () => this.avoidKeyboard();
        const vv = win.visualViewport;
        if (vv) {
            this.vvResizeHandler = () => this.avoidKeyboard();
            vv.addEventListener('resize', this.vvResizeHandler);
        }
        win.addEventListener('keyboardWillShow', this.kbHandler);
        win.addEventListener('keyboardDidShow', this.kbHandler);
        win.addEventListener('keyboardWillHide', this.kbHandler);
        win.addEventListener('keyboardDidHide', this.kbHandler);
        // Clamp once after attach in case the new viewport is smaller than
        // the old one and the user-position would land off-screen.
        // Defer to next frame so layout (size) is stable.
        win.requestAnimationFrame(() => this.clampToViewport());
        return this.container;
    }

    detach(): void {
        if (this.win && this.resizeHandler) {
            this.win.removeEventListener('resize', this.resizeHandler);
        }
        if (this.win?.visualViewport && this.vvResizeHandler) {
            this.win.visualViewport.removeEventListener('resize', this.vvResizeHandler);
        }
        this.vvResizeHandler = null;
        if (this.win && this.kbHandler) {
            this.win.removeEventListener('keyboardWillShow', this.kbHandler);
            this.win.removeEventListener('keyboardDidShow', this.kbHandler);
            this.win.removeEventListener('keyboardWillHide', this.kbHandler);
            this.win.removeEventListener('keyboardDidHide', this.kbHandler);
        }
        this.kbHandler = null;
        if (this.container) {
            this.container.remove();
        }
        this.container = null;
        this.win = null;
        this.doc = null;
        this.resizeHandler = null;
        this.dragging = false;
    }

    getContainer(): HTMLElement | null {
        return this.container;
    }

    getWin(): Window | null {
        return this.win;
    }

    getDoc(): Document | null {
        return this.doc;
    }

    isDragInProgress(): boolean {
        return this.dragging;
    }

    /**
     * Called whenever a drag completes. Used by the observer to flush a
     * deferred window migration that was queued during the drag.
     */
    setOnDragEnd(cb: (() => void) | null): void {
        this.onDragEndCb = cb;
    }

    /**
     * キーボードが widget に被る分だけ transform で持ち上げる。被らなければ
     * transform なし。left/top（ドラッグ座標）は触らないので、キーボードが
     * 閉じれば自然に元の位置へ戻る。
     */
    private avoidKeyboard(): void {
        if (!this.container || !this.win) return;
        // 素の位置で測るため一旦リセット（同期処理内なので描画は挟まらない）
        this.container.style.transform = '';
        const kbTop = keyboardTop(this.win);
        const rect = this.container.getBoundingClientRect();
        // 上端が画面外に出ない範囲で持ち上げる
        const shift = Math.min(rect.bottom - kbTop + 8, rect.top - 8);
        if (shift > 0) {
            this.container.style.transform = `translateY(-${shift}px)`;
        }
    }

    clampToViewport(): void {
        if (!this.container || !this.win || !this.userPosition) return;
        const rect = this.container.getBoundingClientRect();
        const winW = Math.max(rect.width + 16, this.win.innerWidth);
        // キーボードは avoidKeyboard が transform で退避するため、ここでは
        // 見ない（vv を混ぜると Windows でドラッグ座標が恒久的に書き換わる）
        const winH = Math.max(rect.height + 16, this.win.innerHeight);
        let { left, top } = this.userPosition;
        if (left + rect.width > winW - 8) left = winW - rect.width - 8;
        if (top + rect.height > winH - 8) top = winH - rect.height - 8;
        left = Math.max(8, left);
        top = Math.max(8, top);
        if (left !== this.userPosition.left || top !== this.userPosition.top) {
            this.userPosition = { left, top };
            this.applyPosition();
        }
    }

    private applyPosition(): void {
        if (!this.container) return;
        if (this.userPosition) {
            this.container.style.left = `${this.userPosition.left}px`;
            this.container.style.top = `${this.userPosition.top}px`;
            this.container.style.right = 'auto';
            this.container.style.bottom = 'auto';
        } else {
            // Default corner-anchored position: keep the badge inside the
            // viewport since it sticks out beyond the widget's border.
            this.container.style.right = `${DEFAULT_OFFSET}px`;
            this.container.style.bottom = `${DEFAULT_OFFSET}px`;
            this.container.style.left = '';
            this.container.style.top = '';
        }
    }

    private setupDrag(): void {
        if (!this.container) return;
        const header = this.container;

        header.addEventListener('pointerdown', (e) => {
            const target = e.target as HTMLElement;
            for (const sel of this.opts.nonDraggableSelectors) {
                if (target.closest(sel)) return;
            }

            this.dragging = true;
            // キーボード退避 transform を除いた layout 座標で掴む（transform は
            // ドラッグ中も維持され、drag 終了時に再計算される）
            const t = this.container!.style.transform;
            this.container!.style.transform = '';
            const rect = this.container!.getBoundingClientRect();
            this.container!.style.transform = t;
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            this.container!.style.cursor = 'grabbing';
            header.setPointerCapture(e.pointerId);
        });

        header.addEventListener('pointermove', (e) => {
            if (!this.dragging || !this.container) return;
            const left = e.clientX - this.dragOffset.x;
            const top = e.clientY - this.dragOffset.y;
            this.userPosition = { left, top };
            this.applyPosition();
        });

        const endDrag = (e: PointerEvent) => {
            if (!this.dragging) return;
            this.dragging = false;
            if (this.container) this.container.style.cursor = 'grab';
            try {
                header.releasePointerCapture(e.pointerId);
            } catch {
                // Capture may already be released if pointer left the window.
            }
            this.clampToViewport();
            this.avoidKeyboard();
            this.onDragEndCb?.();
        };
        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);
    }
}
