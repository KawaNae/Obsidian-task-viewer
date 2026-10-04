/**
 * Shared CSS color constants and utilities for color suggestions
 */

import { CSS_COLORS } from '../../utils/ColorUtils';
import { sortByMatchRank } from '../matchRank';

/**
 * Filter colors by query string. Matches are ranked exact > prefix >
 * substring (see matchRank), so typing `blu` surfaces `blue` before
 * `aliceblue`. An empty query ties every candidate at the same rank, so
 * the declared order passes through unchanged.
 */
export function filterColors(query: string, limit?: number): string[] {
    const lowerQuery = query.toLowerCase().trim();
    const filtered = CSS_COLORS.filter(color => color.toLowerCase().includes(lowerQuery));
    const sorted = sortByMatchRank(filtered, lowerQuery);
    return limit ? sorted.slice(0, limit) : sorted;
}

/**
 * Render a color suggestion with swatch
 */
export function renderColorSuggestion(value: string, el: HTMLElement): void {
    el.addClass('task-viewer-color-suggestion');

    const swatch = el.createDiv({ cls: 'color-swatch' });
    swatch.style.backgroundColor = value;
    swatch.style.width = '1em';
    swatch.style.height = '1em';
    swatch.style.display = 'inline-block';
    swatch.style.marginRight = '0.5em';
    swatch.style.border = '1px solid var(--background-modifier-border)';
    swatch.style.borderRadius = '2px';
    swatch.style.verticalAlign = 'middle';

    el.createSpan({ text: value });
}
