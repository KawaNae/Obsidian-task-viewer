// ── Sort property & direction enums ──

export type SortProperty =
    | 'content' | 'due' | 'startDate' | 'endDate'
    | 'file' | 'status' | 'tag';

export type SortDirection = 'asc' | 'desc';

// ── Sort rule ──

export interface SortRule {
    id: string;
    property: SortProperty;
    direction: SortDirection;
}

export interface SortState {
    rules: SortRule[];
}

// ── Factory functions ──

function generateId(): string {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultSortRule(): SortRule {
    return { id: generateId(), property: 'due', direction: 'asc' };
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
