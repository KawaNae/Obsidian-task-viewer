/**
 * Visual spacing around timeline grid boundaries.
 * Desired appearance at task boundaries:
 * task edge -> 1px gap -> 1px grid line -> 1px gap -> adjacent task edge
 */
export const GAP_BEFORE_LINE_PX = 1;
export const LINE_THICKNESS_PX = 1;
export const GAP_AFTER_LINE_PX = 1;

/**
 * Display-space transform values derived from the spacing model above.
 * Rendering applies: top + 1px, height - 3px.
 */
export const DISPLAY_TOP_OFFSET_PX = GAP_BEFORE_LINE_PX;
export const DISPLAY_HEIGHT_SHRINK_PX =
    GAP_BEFORE_LINE_PX + LINE_THICKNESS_PX + GAP_AFTER_LINE_PX;

export function toDisplayTopPx(logicalTopPx: number): number {
    return logicalTopPx + DISPLAY_TOP_OFFSET_PX;
}

export function toDisplayHeightPx(logicalHeightPx: number): number {
    return Math.max(0, logicalHeightPx - DISPLAY_HEIGHT_SHRINK_PX);
}

export function toLogicalTopPx(displayTopPx: number): number {
    return displayTopPx - DISPLAY_TOP_OFFSET_PX;
}

export function toLogicalHeightPx(displayHeightPx: number): number {
    return displayHeightPx + DISPLAY_HEIGHT_SHRINK_PX;
}
