// ── Sort property & direction enums ──

/** The properties a list can be sorted by, in the order the sort menu lists them. */
export const SORT_PROPERTIES = ['content', 'due', 'startDate', 'endDate', 'file', 'status', 'tag'] as const;

export type SortProperty = typeof SORT_PROPERTIES[number];

export type SortDirection = 'asc' | 'desc';

// ── Sort rule ──

/**
 * A rule carries no ID: the sort menu addresses its rows by position, and
 * nothing else tells two rules apart.
 */
export interface SortRule {
    readonly property: SortProperty;
    readonly direction: SortDirection;
}

/** A value, as a FilterState is: the sort menu makes a new one for each edit. */
export interface SortState {
    readonly rules: readonly SortRule[];
}

// ── Factory functions ──

export function createDefaultSortRule(): SortRule {
    return { property: 'due', direction: 'asc' };
}

export function createEmptySortState(): SortState {
    return { rules: [] };
}

// ── Query helpers ──

export function hasSortRules(state: SortState): boolean {
    return state.rules.length > 0;
}

import { t } from '../../i18n';

// ── Constants ──

/** Resolve the display label for a sort property. */
export function getSortPropertyLabel(property: SortProperty): string {
    return t(`sort.property.${property}`);
}

export const SORT_PROPERTY_ICONS: Record<SortProperty, string> = {
    content: 'text',
    due: 'alarm-clock',
    startDate: 'calendar',
    endDate: 'calendar-check',
    file: 'file',
    status: 'check-square',
    tag: 'tag',
};

/** Resolve the display label for a sort direction. */
export function getSortDirectionLabel(direction: SortDirection): string {
    return t(`sort.direction.${direction}`);
}
