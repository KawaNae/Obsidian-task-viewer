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
 * Escape handling.
 *
 * The overlay's surface is its panel and what opens on top of it while it
 * is open (`LayerOrder`): the child popovers, and the lists and menus
 * Obsidian opens from a field in the panel on the body (an input suggest's
 * list). A press outside the surface asks to close; the focus in it keeps
 * Obsidian's hotkeys out (`HotkeyShield`).
 *
 * Every overlay holds the focus the same way, so that the hotkeys are kept
 * out from the moment it is open: a frame after it opens, the shell puts
 * the focus where the body asks (`initialFocus`), or on the panel itself
 * when the body names nothing or what it named did not take the focus. On
 * the panel the focus raises no on-screen keyboard. Closed with the focus
 * still in it, the overlay gives the focus back to what had it before.
 *
 * Escape and the user's "back" (Android's back gesture, the desktop mouse's
 * back button: `HistoryBack`) step back alike: a child popover open closes
 * first, else the overlay is asked to close.
 */

import { setIcon, type Keymap } from 'obsidian';
import type { PopoverAnchor } from './PopoverShell';
import { positionElement, resolveHost } from './PopoverShell';
import type { PopoverStack } from './PopoverStack';
import { registerOverlay, unregisterOverlay } from './OverlayRegistry';
import { inLayerAbove } from './LayerOrder';
import { HotkeyShield } from './HotkeyShield';
import { CloseGate, type CloseAnswer } from './CloseGate';
import { holdHistoryBack } from './HistoryBack';
import { KeyboardAwareContainer } from '../../utils/KeyboardAwareContainer';
import { trackKeyboard } from '../../utils/KeyboardState';
import { t } from '../../i18n';

export type OverlayMode = 'anchored' | 'centered';
export type { CloseAnswer };

/**
 * What an overlay's first focus goes to: an element of the body, or a part
 * of it that focuses itself (a CodeMirror editor, which puts its caret).
 */
export interface Focusable {
    focus(options?: FocusOptions): void;
}

export interface OverlayOpenOpts {
    mode: OverlayMode;
    anchor?: PopoverAnchor;
    panelClass?: string;
    build: (bodyEl: HTMLElement) => void;
    /**
     * Obsidian's keymap (`app.keymap`): its hotkeys are kept out while the
     * focus is in the overlay, its child popovers among it (`HotkeyShield`),
     * so a key pressed in the overlay does not act on the note behind.
     * Escape and the keys of the fields still work. Every overlay keeps them
     * out; one that must not would say so by an option of its own.
     */
    keymap: Keymap;
    /**
     * What the focus goes to a frame after the overlay opens (the frame of
     * the window it stands in, so a popout's). A text field's text is
     * selected, so what is typed replaces it. Not given, or naming nothing,
     * the panel itself takes the focus.
     */
    initialFocus?: () => Focusable | null;
    onClose?: () => void;
    /**
     * Asked before a close the user asks for (the close button, Escape, the
     * back, a click outside, a swipe, another overlay taking its place:
     * `requestClose`), and answered as a {@link CloseAnswer}. While a
     * promise it answered waits, a further close asked for waits on it too.
     * Not asked where nothing can be kept open — the window going away, the
     * plugin unloading — which close at once (`close`).
     */
    beforeClose?: () => CloseAnswer;
    /**
     * Whether the body takes this Escape itself (a completion list of an
     * editor in it closing), so the overlay neither closes nor stops it.
     */
    yieldsEscape?: (e: KeyboardEvent) => boolean;
    /**
     * Whether the body takes this back itself (a completion list of an editor
     * in it closing, as `yieldsEscape` lets an Escape do), so the overlay
     * neither closes nor asks. The back is no key, so the body acts on it here.
     */
    takesBack?: () => boolean;
    childStack?: PopoverStack;
    hostDoc?: Document;
}

export class OverlayShell {
    private rootEl: HTMLElement | null = null;
    private panelEl: HTMLElement | null = null;
    private handleEl: HTMLElement | null = null;
    private hostDoc: Document | null = null;
    private hostWin: Window | null = null;
    private mode: OverlayMode = 'anchored';
    private anchor: PopoverAnchor | null = null;
    private childStack: PopoverStack | null = null;
    private onCloseCb: (() => void) | null = null;
    private beforeCloseCb: (() => CloseAnswer) | null = null;
    private closing = false;
    private readonly gate = new CloseGate({
        isOpen: () => this.isOpen(),
        ask: () => this.beforeCloseCb?.() ?? 'close',
        close: () => this.close(),
    });
    /** What had the focus when the overlay opened, given it back on close. */
    private focusBefore: Element | null = null;
    private kbAware: KeyboardAwareContainer | null = null;
    private hotkeys: HotkeyShield | null = null;
    private releaseBack: (() => void) | null = null;

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
        this.beforeCloseCb = opts.beforeClose ?? null;
        this.closing = false;
        this.gate.reset();

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
        this.focusBefore = hostDoc.activeElement;

        // DOM skeleton
        const cls = `tv-overlay tv-overlay--${opts.mode} tv-ctrl`;
        const root = hostDoc.body.createDiv({ cls });
        this.rootEl = root;

        const backdrop = root.createDiv({ cls: 'tv-overlay__backdrop' });
        // タップスルー防止: 閉じは document の pointerdown（capture）で始まる
        // ため、その後の touchend / 合成 mouse click が下の UI に届かないよう
        // backdrop で吸収する。touchend の preventDefault は合成 mouse
        // イベント（mousedown/mouseup/click）の発生自体を抑止する
        backdrop.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
        // A mouse press on the backdrop moves no focus: a close refused
        // there has put the focus where the body wants it (`beforeClose`),
        // and the press's default would take it to the document's body.
        backdrop.addEventListener('mousedown', (e) => e.preventDefault());
        backdrop.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        const panelCls = opts.panelClass
            ? `tv-overlay__panel ${opts.panelClass}`
            : 'tv-overlay__panel';
        const panel = root.createDiv({ cls: panelCls });
        // Focusable by script only: the focus held when the body names no field.
        panel.tabIndex = -1;
        this.panelEl = panel;

        const handle = panel.createDiv({ cls: 'tv-overlay__handle' });
        this.handleEl = handle;

        const closeBtn = panel.createEl('button', { cls: 'tv-icon-btn tv-overlay__close' });
        setIcon(closeBtn.createSpan(), 'x');
        closeBtn.setAttribute('aria-label', t('modal.cancel'));
        closeBtn.addEventListener('click', () => { void this.requestClose(); });

        const body = panel.createDiv({ cls: 'tv-overlay__body' });

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
        const yieldsEscape = opts.yieldsEscape;
        this.escapeHandler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (yieldsEscape?.(e)) return;
            e.stopPropagation();
            this.stepBack();
        };
        hostDoc.addEventListener('keydown', this.escapeHandler, true);

        // Back (Android's back, the mouse's back button): as Escape.
        const takesBack = opts.takesBack;
        this.releaseBack = holdHistoryBack(() => {
            if (takesBack?.()) return;
            this.stepBack();
        });

        // Outside-click
        this.outsideClickHandler = (e: MouseEvent) => {
            if (this.holds(e.target as Node | null)) return;
            void this.requestClose();
        };
        hostDoc.addEventListener('pointerdown', this.outsideClickHandler, true);

        // Hotkeys: kept out while the focus is in the surface.
        this.hotkeys = new HotkeyShield(opts.keymap, hostDoc, (node) => this.holds(node));

        // The first focus, a frame later: one put during the open animation
        // can be lost.
        const initialFocus = opts.initialFocus;
        hostWin.requestAnimationFrame(() => {
            if (this.panelEl !== panel) return;
            this.focusFirst(panel, hostDoc, initialFocus?.() ?? null);
        });

        // Pagehide (popout window close): nothing to keep open for, so not asked.
        this.pageHideHandler = () => this.close();
        hostWin.addEventListener('pagehide', this.pageHideHandler);

        // The DOM lives on hostDoc.body, which no plugin teardown reaches.
        // Register so onunload can close what is still open (#165).
        registerOverlay(this);
    }

    /**
     * Close as the user asked, unless `beforeClose` keeps it open. An answer
     * already given closes, or keeps it open, before this returns.
     * @returns whether it closed (or was not open).
     */
    requestClose(): Promise<boolean> {
        return this.gate.request();
    }

    /**
     * Put the focus on `target`, a text field with its text selected, and
     * on the panel when there is no target or the focus did not go into the
     * surface (an element hidden, or disabled).
     */
    private focusFirst(panel: HTMLElement, doc: Document, target: Focusable | null): void {
        if (target) {
            target.focus({ preventScroll: true });
            const field = target as Partial<HTMLInputElement>;
            if (doc.activeElement === (target as unknown) && typeof field.select === 'function') field.select();
        }
        if (!this.holds(doc.activeElement)) panel.focus({ preventScroll: true });
    }

    /**
     * Whether `node` is in the overlay's surface: in its panel, in a child
     * popover, or in a layer opened on top of it (an input suggest's list
     * Obsidian puts on the body). Its backdrop, and what stood before it,
     * are outside.
     */
    private holds(node: Node | null): boolean {
        if (node === null || !this.rootEl) return false;
        return (this.panelEl?.contains(node) ?? false)
            || (this.childStack?.containsTarget(node) ?? false)
            || inLayerAbove(this.rootEl, node);
    }

    /** Escape or the back: a child popover open closes first, else the overlay is asked to close. */
    private stepBack(): void {
        if (this.childStack?.isOpen()) {
            this.childStack.closeAll();
        } else {
            void this.requestClose();
        }
    }

    /** Close now, asking nothing: the window or the plugin going away, or the body closing itself. */
    close(): void {
        if (!this.rootEl || this.closing) return;
        this.closing = true;
        unregisterOverlay(this);
        this.giveFocusBack();

        // Logical teardown (immediate — overlay is inert from here)
        this.kbAware?.detach();
        this.kbAware = null;
        this.hotkeys?.detach();
        this.hotkeys = null;
        this.releaseBack?.();
        this.releaseBack = null;
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
        this.beforeCloseCb = null;
        this.gate.reset();
        this.focusBefore = null;
        this.hostDoc = null;
        this.hostWin = null;
        this.panelEl = null;
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

    /**
     * Give the focus back to what had it when the overlay opened, if the
     * focus is still the overlay's (in its surface, or lost to the body) and
     * that element is still there. A focus that went elsewhere meanwhile (a
     * note opened from the overlay) is left where it is.
     */
    private giveFocusBack(): void {
        const doc = this.hostDoc;
        const before = this.focusBefore as (Element & Partial<HTMLElement>) | null;
        if (!doc || !before || !before.isConnected || typeof before.focus !== 'function') return;
        const active = doc.activeElement;
        if (active !== null && active !== doc.body && !this.holds(active)) return;
        before.focus({ preventScroll: true });
    }

    isOpen(): boolean {
        return this.rootEl !== null && !this.closing;
    }

    getPanel(): HTMLElement | null { return this.panelEl; }

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

        const slideOut = () => {
            panel.style.transition = 'transform 150ms ease-in';
            panel.style.transform = 'translateY(100%)';
            if (backdrop) {
                backdrop.style.transition = 'opacity 150ms ease-in';
                backdrop.style.opacity = '0';
            }
            // Already asked: the panel is on its way out.
            window.setTimeout(() => this.close(), 160);
        };
        const snapBack = () => {
            panel.style.transition = 'transform 150ms ease-out';
            panel.style.transform = '';
            if (backdrop) {
                backdrop.style.transition = 'opacity 150ms ease-out';
                backdrop.style.opacity = '';
            }
        };

        // A swipe far enough asks to close. Answered at once with 'close',
        // the panel slides out; else it goes back in place, and an answer
        // waited for closes it as any close does.
        const endDrag = () => {
            if (!dragging) return;
            dragging = false;
            let slid = false;
            if (dy > 80) void this.gate.request(() => { slid = true; slideOut(); });
            if (!slid) snapBack();
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

        // Pulling the body down from its top drags the sheet, unless the
        // touch began in a field: there it is the field's, to select text
        // or scroll it, and the sheet stays put.
        let touchStartY = 0;
        let overscrolling = false;
        let isBottomSheet = false;
        let inField = false;

        body.addEventListener('touchstart', (e) => {
            touchStartY = e.touches[0].clientY;
            overscrolling = false;
            isBottomSheet = handle.offsetHeight > 0;
            inField = isInField(e.target);
        }, { passive: true });

        body.addEventListener('touchmove', (e) => {
            if (!isBottomSheet || inField) return;
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

/** Whether a touch began in a field: an input, a textarea, or an editable element (a CodeMirror editor's content). */
function isInField(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof el.closest !== 'function') return false;
    return el.isContentEditable || el.closest('input, textarea') !== null;
}
