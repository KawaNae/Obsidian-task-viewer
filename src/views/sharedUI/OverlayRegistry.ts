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
 * DOM-free on purpose: the unit suite runs on `environment: 'node'`, and
 * this is the part worth testing.
 */

export interface ClosableOverlay {
    close(): void;
}

const openOverlays = new Set<ClosableOverlay>();

export function registerOverlay(overlay: ClosableOverlay): void {
    openOverlays.add(overlay);
}

export function unregisterOverlay(overlay: ClosableOverlay): void {
    openOverlays.delete(overlay);
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
