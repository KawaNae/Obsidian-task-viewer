/**
 * Classes applied to a `.task-card` only while an active drag gesture owns it.
 *
 * Ownership rule: the active gesture is the sole owner — it applies these on
 * onDown/onMove and releases them on EVERY terminal (pointerup / pointercancel /
 * lost-capture). The render path never applies them; `CardReconciler` strips
 * them from reused cards so a missed gesture-end cannot leave a card stuck
 * invisible.
 *
 * Release is not unconditional: on a committed drop it goes through
 * {@link DropReveal}, which keeps `is-drag-hidden` on any source card the
 * gesture could not redraw at the committed geometry. Revealing such a card
 * would paint it at its pre-drop position until the next render lands. Those
 * cards are handed to the render instead — which is exactly the reconciler
 * strip above, so the "stuck invisible" guarantee still holds.
 *
 * Single source of truth shared by the gestures (apply), DropReveal (release),
 * GhostRenderer (the cloned ghost must not inherit them) and CardReconciler
 * (sanitize reuse).
 */
export const TRANSIENT_DRAG_CLASSES = [
    'is-dragging',
    'is-drag-hidden',
    'is-drag-source-dimmed',
    'is-drag-source-faint',
] as const;
