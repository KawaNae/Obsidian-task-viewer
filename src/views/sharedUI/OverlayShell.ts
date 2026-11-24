/**
 * Unified overlay shell for all root-level overlay UIs.
 *
 * Provides a standard DOM skeleton (root > backdrop > panel > handle + close
 * + head + body + foot), shared lifecycle (open/close with animation), and
 * mode-based presentation:
 *
 *   - 'anchored': desktop = JS-positioned popover, phone = bottom-sheet
 *   - 'centered': desktop = CSS-centered dialog, phone = bottom-sheet
 *
 * Phone detection is CSS-driven via Obsidian's `.is-phone` class on body.
 * The same DOM serves both presentations; CSS switches layout, and JS
 * skips positioning when the handle is visible (phone indicator).
 *
 * The body alone scrolls. Above it and below it the panel has a place that
 * does not (`OverlayFrame`): a dialog puts its title in the head and its row
 * of buttons in the foot, so both stay in sight however long the body is,
 * in the sheet and in the box alike. A place shows only while it holds a
 * child without the `hidden` attribute: a dialog that puts nothing there,
 * or whose row is hidden for now, has no head or foot to see, nor its line.
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
 * the panel the focus raises no on-screen keyboard. While the panel still
 * opens (its animation: the sheet sliding up, the box popping in: the
 * overlay's `opening`) or a menu of the plugin is still on the screen, the
 * focus waits on the panel, and goes where the body asks once they are
 * done (`placeFirstFocus`, `FocusPlacement`). Closed with the focus still in
 * it, the overlay gives the focus back to what had it before.
 *
 * Escape and the user's "back" (Android's back gesture, the desktop mouse's
 * back button: `HistoryBack`) step back alike: a child popover open closes
 * first, else the overlay is asked to close.
 *
 * Overlays opened over one another (a dialog opened from the hub) are each
 * a layer of the body, in the order they opened, and the top one alone
 * takes what the user does: a press outside it, Escape (`takeEscape`), and
 * the back, which Obsidian gives to the top of its stack, where an overlay
 * is put as it opens.
 */

import { setIcon, type Keymap } from 'obsidian';
import type { PopoverAnchor } from './PopoverShell';
import { positionElement, resolveHost } from './PopoverShell';
import type { PopoverStack } from './PopoverStack';
import { overlayAbove, registerOverlay, unregisterOverlay, type ClosableOverlay } from './OverlayRegistry';
import { inLayerAbove } from './LayerOrder';
import { HotkeyShield } from './HotkeyShield';
import { CloseGate, type CloseAnswer } from './CloseGate';
import { holdHistoryBack } from './HistoryBack';
import { KeyboardAwareContainer } from '../../utils/KeyboardAwareContainer';
import { watchKeyboard } from '../../utils/KeyboardWatch';
import { runningAnimations, whenStopped } from '../../utils/Animations';
import { focusField, type FieldFocus, type Focusable } from '../../utils/FieldFocus';
import { placeFocus } from './FocusPlacement';
import { t } from '../../i18n';

export type OverlayMode = 'anchored' | 'centered';
export type { CloseAnswer };

export type { Focusable, FieldFocus, SelectionOnFocus } from '../../utils/FieldFocus';

/** The places of the panel around its body that do not scroll with it. */
export interface OverlayFrame {
    /** Above the body: the dialog's title. */
    head: HTMLElement;
    /** Below the body: the dialog's row of buttons. */
    foot: HTMLElement;
}

export interface OverlayOpenOpts {
    mode: OverlayMode;
    anchor?: PopoverAnchor;
    panelClass?: string;
    /** Build the body, and what stays in sight around it in `frame`. */
    build: (bodyEl: HTMLElement, frame: OverlayFrame) => void;
    /**
     * Obsidian's keymap (`app.keymap`): its hotkeys are kept out while the
     * focus is in the overlay, its child popovers among it (`HotkeyShield`),
     * so a key pressed in the overlay does not act on the note behind.
     * Escape and the keys of the fields still work. Every overlay keeps them
     * out; one that must not would say so by an option of its own.
     */
    keymap: Keymap;
    /**
     * What the focus goes to once the overlay has opened: a frame after it
     * opens (the frame of the window it stands in, so a popout's), or once
     * its open animation has ended and the plugin's menus have gone, the
     * panel holding the focus until then (`placeFirstFocus`). The body says how a text field's text is met
     * there, all of it selected or the caret after it, as the field's kind
     * asks: the shell knows no field. Not given, or naming nothing, the
     * panel itself takes the focus.
     */
    initialFocus?: () => FieldFocus | null;
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

/** The child popovers an overlay steps back through (`PopoverStack`). */
export type ChildPopovers = Pick<PopoverStack, 'isOpen' | 'closeAll'>;

/**
 * Escape or the back: a child popover open closes first, else the overlay
 * is asked to close (`requestClose`).
 */
export function stepBack(childStack: ChildPopovers | null, requestClose: () => void): void {
    if (childStack?.isOpen()) {
        childStack.closeAll();
    } else {
        requestClose();
    }
}

/**
 * A key the overlay's document has, in the capture phase, as the overlay
 * takes it: an Escape steps back (`step`) and goes no further, unless
 * another overlay stands above this one (`overlayAbove`), whose Escape it
 * is, or the body takes it itself (`yieldsEscape`).
 *
 * Every overlay listens on the document, in the order they opened, so the
 * one under hears the key first and finds the one above still open.
 */
export function takeEscape(
    e: KeyboardEvent,
    overlay: ClosableOverlay,
    yieldsEscape: ((e: KeyboardEvent) => boolean) | undefined,
    step: () => void,
): void {
    if (e.key !== 'Escape') return;
    if (overlayAbove(overlay)) return;
    if (yieldsEscape?.(e)) return;
    e.stopPropagation();
    step();
}

/** An overlay opening, as its first focus sees it (`placeFirstFocus`). */
export interface OpeningOverlay {
    panel: HTMLElement;
    doc: Document;
    /** Whether the overlay is still open on this panel: not closed, nor opened again on another body. */
    isCurrent: () => boolean;
    /** Whether `node` is in the overlay's surface. */
    holds: (node: Node | null) => boolean;
    /** What the body asks the focus to go to, and how its text is met (`initialFocus`), asked when it goes. */
    target: () => FieldFocus | null;
}

/** An overlay's opening (`watchOpening`). */
export interface Opening {
    /** What settles once the overlay has opened; null once it has. */
    pending(): Promise<void> | null;
    /** The overlay closed: its opening is over. */
    end(): void;
}

/**
 * An overlay's opening: from its opening (the body built after it opens)
 * to the frame after (`win`'s frame), then until the animations of `parts`
 * running at that frame have stopped, ended or cancelled (the sheet dragged
 * by its handle): the panel sliding up or popping in, the backdrop fading
 * in. Theirs alone: what animates in the body (a field's focus ring) is no
 * part of the overlay's coming in, nor what starts on them once they have
 * come in (the panel following the keyboard). With nothing running then,
 * or where the DOM cannot list what runs, it has opened at that frame.
 *
 * `atFrame` is called at that frame, once the opening is known to wait or
 * not: the overlay's first focus.
 */
export function watchOpening(win: Window, parts: readonly Element[], atFrame: () => void): Opening {
    let settle!: () => void;
    let pending: Promise<void> | null = new Promise<void>((resolve) => { settle = resolve; });
    const end = () => {
        if (!pending) return;
        pending = null;
        settle();
    };
    win.requestAnimationFrame(() => {
        if (pending) {
            const moving = parts.flatMap((part) => runningAnimations(part, { subtree: false }));
            if (moving.length === 0) end();
            else void whenStopped(moving).then(end);
        }
        atFrame();
    });
    return { pending: () => pending, end };
}

/**
 * The first focus of an overlay, a frame after it opens: on what the body
 * asks (`initialFocus`), once the plugin's menus have gone and its overlays
 * this one among them have opened (`placeFocus`).
 *
 * A field focused while the panel still moves raises the on-screen keyboard
 * with the field where it stands midway, and WebKit scrolls the body by that
 * place (on iPad the sheet sliding up from below the window had its body
 * scrolled to the end); one focused while a menu's sheet still slides away
 * has the sheet rise with the keyboard. Meanwhile the panel holds the focus,
 * which raises no keyboard and keeps the hotkeys out. The focus the user
 * moved meanwhile to another part of the surface is left there, and an
 * overlay closed or opened again meanwhile is not focused.
 */
export function placeFirstFocus(overlay: OpeningOverlay): void {
    if (!overlay.isCurrent()) return;
    const first: Focusable = { focus: () => focusFirst(overlay) };
    placeFocus({ to: first }, {
        hold: overlay.panel,
        stillWanted: () => {
            if (!overlay.isCurrent()) return false;
            const active = overlay.doc.activeElement;
            return active === overlay.panel || !overlay.holds(active);
        },
    });
}

/**
 * Put the focus on what the body asks, its text met as the body says
 * (`focusField`), and on the panel when it names nothing or the focus did
 * not go into the surface (an element hidden, or disabled).
 */
function focusFirst({ panel, doc, holds, target }: OpeningOverlay): void {
    const to = target();
    if (to) focusField(to, { preventScroll: true });
    if (!holds(doc.activeElement)) panel.focus({ preventScroll: true });
}

export class OverlayShell implements ClosableOverlay {
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
    private openingWatch: Opening | null = null;

    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
    private resizeHandler: (() => void) | null = null;
    /** Stops following the keyboard, while an anchored panel follows it. */
    private unwatchKeyboard: (() => void) | null = null;
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

        const head = panel.createDiv({ cls: 'tv-overlay__head' });
        const body = panel.createDiv({ cls: 'tv-overlay__body' });
        const foot = panel.createDiv({ cls: 'tv-overlay__foot' });

        opts.build(body, { head, foot });

        // Keyboard awareness (mobile)
        this.kbAware = new KeyboardAwareContainer(root, hostWin, body);
        this.kbAware.attach();

        // Anchored: position panel near anchor
        if (opts.mode === 'anchored') {
            this.repositionIfAnchored();
            this.setupAnchoredTracking(hostWin);
        }

        // Swipe dismiss
        this.setupSwipeToDismiss(handle, panel, root, body);

        // Escape
        const yieldsEscape = opts.yieldsEscape;
        this.escapeHandler = (e: KeyboardEvent) => takeEscape(e, this, yieldsEscape, () => this.stepBack());
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

        const initialFocus = opts.initialFocus;
        this.openingWatch = watchOpening(hostWin, [backdrop, panel], () => placeFirstFocus({
            panel,
            doc: hostDoc,
            isCurrent: () => this.panelEl === panel,
            holds: (node) => this.holds(node),
            target: () => initialFocus?.() ?? null,
        }));

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

    private stepBack(): void {
        stepBack(this.childStack, () => { void this.requestClose(); });
    }

    /** Close now, asking nothing: the window or the plugin going away, or the body closing itself. */
    close(): void {
        if (!this.rootEl || this.closing) return;
        this.closing = true;
        unregisterOverlay(this);
        this.openingWatch?.end();
        this.openingWatch = null;
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

    /** The element on the body the overlay stands in, while it is open. */
    layer(): Node | null {
        return this.isOpen() ? this.rootEl : null;
    }

    /** While it opens, what settles once it has opened (`watchOpening`). */
    opening(): Promise<void> | null {
        return this.isOpen() ? this.openingWatch?.pending() ?? null : null;
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

        // Followed after the overlay's keyboard awareness, which began to as
        // the overlay opened: the panel is placed once the overlay has been
        // given the keyboard's overlap. Not as the visualViewport scrolls:
        // the panel is placed by the keyboard's top, which a scroll moves,
        // but following it has not been tried on a device whose
        // visualViewport scrolls under the keyboard.
        this.unwatchKeyboard = watchKeyboard(hostWin, (change) => {
            if (change.cause === 'viewportScroll') return;
            this.repositionIfAnchored();
        });
    }

    private teardownAnchoredTracking(): void {
        if (!this.hostWin) return;
        if (this.resizeHandler) {
            this.hostWin.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        this.unwatchKeyboard?.();
        this.unwatchKeyboard = null;
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
