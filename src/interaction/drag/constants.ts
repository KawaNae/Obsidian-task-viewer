/**
 * Classes applied to a `.task-card` only while an active drag gesture owns it.
 *
 * Ownership rule: the active gesture is the sole owner — it applies these on
 * onDown/onMove and removes them on EVERY terminal (pointerup / pointercancel /
 * lost-capture). The render path never owns them; `CardReconciler` strips them
 * from reused cards so a missed gesture-end cannot leave a card stuck invisible.
 *
 * Single source of truth shared by the gestures (apply/clear), GhostRenderer
 * (the cloned ghost must not inherit them) and CardReconciler (sanitize reuse).
 */
export const TRANSIENT_DRAG_CLASSES = [
    'is-dragging',
    'is-drag-hidden',
    'is-drag-source-dimmed',
    'is-drag-source-faint',
] as const;
