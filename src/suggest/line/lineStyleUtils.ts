/**
 * Shared constants and helpers for line style suggestions.
 */

import { rankCandidates } from '../rankCandidates';

export const LINE_STYLES = ['solid', 'dashed', 'dotted', 'double', 'dashdotted'] as const;

/**
 * Line styles matching the query, best match first — exact, then prefix, then
 * substring. The list order is not alphabetical and is preserved inside each
 * rank, so `d` still offers dashed before dashdotted (see rankCandidates).
 */
export function filterLineStyles(query: string, limit?: number): string[] {
    return rankCandidates(LINE_STYLES, query, limit);
}

/**
 * Render a line style suggestion with a small preview bar.
 */
export function renderLineStyleSuggestion(value: string, el: HTMLElement): void {
    const row = el.createDiv();
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '0.5em';

    const line = row.createDiv();
    line.style.width = '1.8em';
    line.style.height = '0';
    line.style.flex = '0 0 auto';
    line.style.boxSizing = 'border-box';

    const color = 'var(--interactive-accent)';
    if (value === 'solid') {
        line.style.borderTop = `2px solid ${color}`;
    } else if (value === 'dashed') {
        line.style.borderTop = `2px dashed ${color}`;
    } else if (value === 'dotted') {
        line.style.borderTop = `2px dotted ${color}`;
    } else if (value === 'double') {
        line.style.borderTop = `3px double ${color}`;
    } else {
        line.style.height = '2px';
        line.style.backgroundImage = `repeating-linear-gradient(to right, ${color} 0 9px, transparent 9px 12px, ${color} 12px 14px, transparent 14px 17px)`;
        line.style.backgroundRepeat = 'repeat-x';
    }

    row.createSpan({ text: value });
}
