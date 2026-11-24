/**
 * Registry of root-level overlays that are currently open.
 *
 * OverlayShell mounts its DOM on `hostDoc.body`, outside every container
 * Obsidian tears down for us, so an overlay left open survives `onunload`.
 * The stale panel stays wired to the previous plugin instance: its writes
 * reach the file but the new instance sees them as external edits, so a
 * completed flow task is written as done without firing its command (#165).
 *
 * The registry gives `onunload` one place to close them all. Membership is
 * module-scoped, and a plugin reload re-evaluates the module, so an old
 * instance's `closeAllOverlays()` only ever sees its own overlays.
 *
 * It is also where an overlay finds whether it is the top one: overlays
 * opened over one another stand on the body in the order they opened
 * (`LayerOrder`), and an Escape is the top one's alone (`overlayAbove`).
 *
 * And it is where a focus put on a field finds the overlays still opening
 * (`whenOverlaysOpened`), whose panel would move under the field focused.
 *
 * DOM-free on purpose: the unit suite runs on `environment: 'node'`, and
 * this is the part worth testing. The order is read from the nodes' parent
 * and next sibling only.
 */

import { inLayerAbove } from './LayerOrder';

export interface ClosableOverlay {
    close(): void;
    /** The element on the body the overlay stands in (its layer), while it is open. */
    layer(): Node | null;
    /**
     * While the overlay is opening, what settles once it has opened: from
     * its opening until its open animation (its panel and its backdrop
     * coming in) has stopped. Null once opened, and while it closes.
     */
    opening(): Promise<void> | null;
}

const openOverlays = new Set<ClosableOverlay>();

export function registerOverlay(overlay: ClosableOverlay): void {
    openOverlays.add(overlay);
}

export function unregisterOverlay(overlay: ClosableOverlay): void {
    openOverlays.delete(overlay);
}

/**
 * Whether another open overlay stands above `overlay`: on the same body,
 * put there after it. One in another window's body is above none here.
 */
export function overlayAbove(overlay: ClosableOverlay): boolean {
    const layer = overlay.layer();
    if (!layer) return false;
    for (const other of openOverlays) {
        const at = other.layer();
        if (at && inLayerAbove(layer, at)) return true;
    }
    return false;
}

/**
 * Settles once every overlay opening now has opened; null when none is
 * opening, so the caller can act at once.
 */
export function whenOverlaysOpened(): Promise<void> | null {
    const opening = [...openOverlays].map((o) => o.opening()).filter((p): p is Promise<void> => p !== null);
    if (opening.length === 0) return null;
    return Promise.all(opening).then(() => undefined);
}

/**
 * Close every open overlay. Iterates a snapshot so a `close()` that
 * unregisters itself (the normal path) cannot cut the walk short, and
 * isolates each one so a thrower cannot leave the rest open.
 */
export function closeAllOverlays(): void {
    const overlays = [...openOverlays];
    openOverlays.clear();
    for (const overlay of overlays) {
        try {
            overlay.close();
        } catch {
            // Teardown of one overlay must not strand the others.
        }
    }
}

/** Open overlay count. Tests only. */
export function openOverlayCount(): number {
    return openOverlays.size;
}
