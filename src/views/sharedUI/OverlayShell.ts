/**
 * Unified overlay shell for all root-level overlay UIs.
 *
 * Provides a standard DOM skeleton (root > backdrop > panel > handle + close + body),
 * shared lifecycle (open/close with animation), and mode-based presentation:
 *
 *   - 'anchored': desktop = JS-positioned popover, phone = bottom-sheet
 *   - 'centered': desktop = CSS-centered dialog, phone = bottom-sheet
 *
 * Phone detection is CSS-driven via Obsidian's `.is-phone` class on body.
 * The same DOM serves both presentations; CSS switches layout, and JS
 * skips positioning when the handle is visible (phone indicator).
 *
 * Child popovers (dropdowns, suggests) continue to use PopoverShell via
 * PopoverStack. OverlayShell coordinates with an optional childStack for
 * outside-click and Escape handling.
 */

import { setIcon } from 'obsidian';
import type { PopoverAnchor } from './PopoverShell';
import { positionElement, resolveHost } from './PopoverShell';
import type { PopoverStack } from './PopoverStack';
import { KeyboardAwareContainer } from '../../utils/KeyboardAwareContainer';
import { trackKeyboard } from '../../utils/KeyboardState';
import { t } from '../../i18n';

export type OverlayMode = 'anchored' | 'centered';

export interface OverlayOpenOpts {
    mode: OverlayMode;
    anchor?: PopoverAnchor;
    panelClass?: string;
    build: (bodyEl: HTMLElement) => void;
    onClose?: () => void;
    childStack?: PopoverStack;
    hostDoc?: Document;
}

export class OverlayShell {
    private rootEl: HTMLElement | null = null;
    private panelEl: HTMLElement | null = null;
    private bodyEl: HTMLElement | null = null;
    private handleEl: HTMLElement | null = null;
    private hostDoc: Document | null = null;
    private hostWin: Window | null = null;
    private mode: OverlayMode = 'anchored';
    private anchor: PopoverAnchor | null = null;
    private childStack: PopoverStack | null = null;
    private onCloseCb: (() => void) | null = null;
    private closing = false;
    private kbAware: KeyboardAwareContainer | null = null;

    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
    private resizeHandler: (() => void) | null = null;
    private vvResizeHandler: (() => void) | null = null;
    private kbHandler: (() => void) | null = null;
    private pageHideHandler: (() => void) | null = null;

    open(opts: OverlayOpenOpts): void {
        if (this.rootEl) this.close();

        this.mode = opts.mode;
        this.anchor = opts.anchor ?? null;
        this.childStack = opts.childStack ?? null;
        this.onCloseCb = opts.onClose ?? null;
        this.closing = false;

        // Resolve host document (popout-aware)
        let hostDoc: Document;
        let hostWin: Window;
        if (opts.mode === 'anchored' && opts.anchor) {
            ({ hostDoc, hostWin } = resolveHost(opts.anchor));
        } else {
            hostDoc = opts.hostDoc
                ?? (globalThis as { activeDocument?: Document }).activeDocument
                ?? document;
            hostWin = hostDoc.defaultView ?? window;
        }
        this.hostDoc = hostDoc;
        this.hostWin = hostWin;

        // DOM skeleton
        const cls = `tv-overlay tv-overlay--${opts.mode} tv-ctrl`;
        const root = hostDoc.body.createDiv({ cls });
        this.rootEl = root;

        root.createDiv({ cls: 'tv-overlay__backdrop' });

        const panelCls = opts.panelClass
            ? `tv-overlay__panel ${opts.panelClass}`
            : 'tv-overlay__panel';
        const panel = root.createDiv({ cls: panelCls });
        this.panelEl = panel;

        const handle = panel.createDiv({ cls: 'tv-overlay__handle' });
        this.handleEl = handle;

        const closeBtn = panel.createEl('button', { cls: 'tv-overlay__close' });
        setIcon(closeBtn.createSpan(), 'x');
        closeBtn.setAttribute('aria-label', t('modal.cancel'));
        closeBtn.addEventListener('click', () => this.close());

        const body = panel.createDiv({ cls: 'tv-overlay__body' });
        this.bodyEl = body;

        opts.build(body);

        // Keyboard awareness (mobile)
        this.kbAware = new KeyboardAwareContainer(root, hostWin);
        this.kbAware.attach();
        this.kbAware.scrollTarget = body;

        // Anchored: position panel near anchor
        if (opts.mode === 'anchored') {
            this.repositionIfAnchored();
            this.setupAnchoredTracking(hostWin);
        }

        // Swipe dismiss
        this.setupSwipeToDismiss(handle, panel, root, body);

        // Escape
        this.escapeHandler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            if (this.childStack?.isOpen()) {
                this.childStack.closeAll();
            } else {
                this.close();
            }
        };
        hostDoc.addEventListener('keydown', this.escapeHandler, true);

        // Outside-click
        this.outsideClickHandler = (e: MouseEvent) => {
            const target = e.target as Node;
            if (this.panelEl?.contains(target)) return;
            if (this.childStack?.containsTarget(target)) return;
            this.close();
        };
        hostDoc.addEventListener('pointerdown', this.outsideClickHandler, true);

        // Pagehide (popout window close)
        this.pageHideHandler = () => this.close();
        hostWin.addEventListener('pagehide', this.pageHideHandler);
    }

    close(): void {
        if (!this.rootEl || this.closing) return;
        this.closing = true;

        // Logical teardown (immediate — overlay is inert from here)
        this.kbAware?.detach();
        this.kbAware = null;
        this.childStack?.closeAll();
        this.childStack = null;

        if (this.escapeHandler && this.hostDoc) {
            this.hostDoc.removeEventListener('keydown', this.escapeHandler, true);
        }
        if (this.outsideClickHandler && this.hostDoc) {
            this.hostDoc.removeEventListener('pointerdown', this.outsideClickHandler, true);
        }
        this.teardownAnchoredTracking();
        if (this.pageHideHandler && this.hostWin) {
            this.hostWin.removeEventListener('pagehide', this.pageHideHandler);
        }
        this.escapeHandler = null;
        this.outsideClickHandler = null;
        this.pageHideHandler = null;

        const cb = this.onCloseCb;
        this.onCloseCb = null;
        this.hostDoc = null;
        this.hostWin = null;
        this.panelEl = null;
        this.bodyEl = null;
        this.handleEl = null;
        this.anchor = null;

        cb?.();

        // Visual teardown (animated)
        const root = this.rootEl;
        this.rootEl = null;

        const isPhone = this.isCurrentlyPhone(root);
        const hasAnimation = this.mode === 'centered' || isPhone;

        if (hasAnimation) {
            const panel = root.querySelector<HTMLElement>('.tv-overlay__panel');
            root.addClass('is-closing');
            let done = false;
            const finish = () => { if (done) return; done = true; root.remove(); };
            panel?.addEventListener('animationend', finish);
            window.setTimeout(finish, 200);
        } else {
            root.remove();
        }
    }

    isOpen(): boolean {
        return this.rootEl !== null && !this.closing;
    }

    refresh(build: (bodyEl: HTMLElement) => void): void {
        if (!this.bodyEl) return;
        this.bodyEl.empty();
        build(this.bodyEl);
        this.repositionIfAnchored();
    }

    getPanel(): HTMLElement | null { return this.panelEl; }
    getBody(): HTMLElement | null { return this.bodyEl; }
    getHostDoc(): Document | null { return this.hostDoc; }
    getHostWin(): Window | null { return this.hostWin; }

    // ── Anchored positioning ──

    private repositionIfAnchored(): void {
        if (this.mode !== 'anchored') return;
        if (!this.panelEl || !this.hostWin || !this.anchor) return;
        if (this.handleEl && this.handleEl.offsetHeight > 0) return;
        positionElement(this.panelEl, this.anchor, this.hostWin);
    }

    private setupAnchoredTracking(hostWin: Window): void {
        this.resizeHandler = () => this.repositionIfAnchored();
        hostWin.addEventListener('resize', this.resizeHandler);

        const vv = hostWin.visualViewport;
        if (vv) {
            this.vvResizeHandler = () => this.repositionIfAnchored();
            vv.addEventListener('resize', this.vvResizeHandler);
        }

        trackKeyboard(hostWin);
        this.kbHandler = () => this.repositionIfAnchored();
        hostWin.addEventListener('keyboardWillShow', this.kbHandler);
        hostWin.addEventListener('keyboardDidShow', this.kbHandler);
        hostWin.addEventListener('keyboardWillHide', this.kbHandler);
        hostWin.addEventListener('keyboardDidHide', this.kbHandler);
    }

    private teardownAnchoredTracking(): void {
        if (!this.hostWin) return;
        if (this.resizeHandler) {
            this.hostWin.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        if (this.vvResizeHandler && this.hostWin.visualViewport) {
            this.hostWin.visualViewport.removeEventListener('resize', this.vvResizeHandler);
            this.vvResizeHandler = null;
        }
        if (this.kbHandler) {
            this.hostWin.removeEventListener('keyboardWillShow', this.kbHandler);
            this.hostWin.removeEventListener('keyboardDidShow', this.kbHandler);
            this.hostWin.removeEventListener('keyboardWillHide', this.kbHandler);
            this.hostWin.removeEventListener('keyboardDidHide', this.kbHandler);
            this.kbHandler = null;
        }
    }

    // ── Swipe dismiss ──

    private setupSwipeToDismiss(
        handle: HTMLElement,
        panel: HTMLElement,
        root: HTMLElement,
        body: HTMLElement,
    ): void {
        let startY = 0;
        let dy = 0;
        let dragging = false;

        const backdrop = root.querySelector<HTMLElement>('.tv-overlay__backdrop');

        const beginDrag = (clientY: number) => {
            startY = clientY;
            dy = 0;
            dragging = true;
            panel.style.transition = 'none';
            panel.style.animation = 'none';
            if (backdrop) {
                backdrop.style.transition = 'none';
            }
        };

        const moveDrag = (clientY: number) => {
            dy = Math.max(0, clientY - startY);
            panel.style.transform = `translateY(${dy}px)`;
            if (backdrop) {
                backdrop.style.opacity = String(1 - Math.min(dy / 300, 0.6));
            }
        };

        const endDrag = () => {
            if (!dragging) return;
            dragging = false;
            if (dy > 80) {
                panel.style.transition = 'transform 150ms ease-in';
                panel.style.transform = 'translateY(100%)';
                if (backdrop) {
                    backdrop.style.transition = 'opacity 150ms ease-in';
                    backdrop.style.opacity = '0';
                }
                window.setTimeout(() => this.close(), 160);
            } else {
                panel.style.transition = 'transform 150ms ease-out';
                panel.style.transform = '';
                if (backdrop) {
                    backdrop.style.transition = 'opacity 150ms ease-out';
                    backdrop.style.opacity = '';
                }
            }
        };

        handle.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0) return;
            beginDrag(e.clientY);
            handle.setPointerCapture(e.pointerId);
        });
        handle.addEventListener('pointermove', (e: PointerEvent) => {
            if (dragging) moveDrag(e.clientY);
        });
        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);

        let touchStartY = 0;
        let overscrolling = false;
        let isBottomSheet = false;

        body.addEventListener('touchstart', (e) => {
            touchStartY = e.touches[0].clientY;
            overscrolling = false;
            isBottomSheet = handle.offsetHeight > 0;
        }, { passive: true });

        body.addEventListener('touchmove', (e) => {
            if (!isBottomSheet) return;
            const currentY = e.touches[0].clientY;
            if (overscrolling) {
                e.preventDefault();
                moveDrag(currentY);
                return;
            }
            if (body.scrollTop <= 0 && currentY - touchStartY > 5) {
                overscrolling = true;
                beginDrag(currentY);
                e.preventDefault();
            }
        }, { passive: false });

        const onTouchEnd = () => {
            if (overscrolling) { endDrag(); overscrolling = false; }
        };
        body.addEventListener('touchend', onTouchEnd);
        body.addEventListener('touchcancel', onTouchEnd);
    }

    // ── Helpers ──

    private isCurrentlyPhone(root: HTMLElement): boolean {
        const handle = root.querySelector<HTMLElement>('.tv-overlay__handle');
        return (handle?.offsetHeight ?? 0) > 0;
    }
}
