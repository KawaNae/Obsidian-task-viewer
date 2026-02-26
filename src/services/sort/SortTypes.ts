// ── Sort property & direction enums ──

export type SortProperty =
    | 'content' | 'deadline' | 'startDate' | 'endDate'
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
    return { id: generateId(), property: 'deadline', direction: 'asc' };
}

export function createEmptySortState(): SortState {
    return { rules: [] };
}

// ── Query helpers ──

export function hasSortRules(state: SortState): boolean {
    return state.rules.length > 0;
}

// ── Constants ──

export const SORT_PROPERTY_LABELS: Record<SortProperty, string> = {
    content: 'Content',
    deadline: 'Deadline',
    startDate: 'Start date',
    endDate: 'End date',
    file: 'File',
    status: 'Status',
    tag: 'Tag',
};

export const SORT_PROPERTY_ICONS: Record<SortProperty, string> = {
    content: 'text',
    deadline: 'alarm-clock',
    startDate: 'calendar',
    endDate: 'calendar-check',
    file: 'file',
    status: 'check-square',
    tag: 'tag',
};

export const SORT_DIRECTION_LABELS: Record<SortDirection, string> = {
    asc: 'Ascending',
    desc: 'Descending',
};
