export type FilterProperty =
    | 'file' | 'tag' | 'status' | 'content'
    | 'startDate' | 'endDate' | 'deadline';

export type FilterOperator =
    | 'includes' | 'excludes'
    | 'isSet' | 'isNotSet'
    | 'contains' | 'notContains'
    | 'equals' | 'before' | 'after' | 'onOrBefore' | 'onOrAfter';

export interface FilterCondition {
    id: string;
    property: FilterProperty;
    operator: FilterOperator;
    value: FilterValue;
}

export type FilterValue =
    | { type: 'stringSet'; values: string[] }
    | { type: 'boolean'; value: boolean }
    | { type: 'string'; value: string }
    | { type: 'date'; value: DateFilterValue };

export type RelativeDatePreset = 'today' | 'thisWeek' | 'nextWeek' | 'pastWeek' | 'nextNDays';

export type DateFilterValue =
    | { mode: 'absolute'; date: string }
    | { mode: 'relative'; preset: RelativeDatePreset; n?: number };

export interface FilterGroup {
    id: string;
    conditions: FilterCondition[];
    logic: 'and' | 'or';
}

export interface FilterState {
    groups: FilterGroup[];
    logic: 'and' | 'or';
}

export const EMPTY_FILTER_STATE: FilterState = Object.freeze({
    groups: Object.freeze([]) as readonly FilterGroup[] as FilterGroup[],
    logic: 'and' as const,
});

/** Create a fresh empty filter state (safe to mutate, unlike EMPTY_FILTER_STATE) */
export function createEmptyFilterState(): FilterState {
    return { groups: [], logic: 'and' };
}

/** Create a fresh empty filter group */
export function createEmptyFilterGroup(): FilterGroup {
    return {
        id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        conditions: [],
        logic: 'and',
    };
}

/** Whether the filter state has any conditions */
export function hasConditions(state: FilterState): boolean {
    return state.groups.some(g => g.conditions.length > 0);
}

/** Get all conditions across all groups */
export function getAllConditions(state: FilterState): FilterCondition[] {
    return state.groups.flatMap(g => g.conditions);
}

/** Date properties that use date comparison operators */
export const DATE_PROPERTIES: Set<FilterProperty> = new Set(['startDate', 'endDate', 'deadline']);

/** Available operators per property */
export const PROPERTY_OPERATORS: Record<FilterProperty, FilterOperator[]> = {
    file: ['includes', 'excludes'],
    tag: ['includes', 'excludes'],
    status: ['includes', 'excludes'],
    content: ['contains', 'notContains'],
    startDate: ['isSet', 'isNotSet', 'equals', 'before', 'after', 'onOrBefore', 'onOrAfter'],
    endDate: ['isSet', 'isNotSet', 'equals', 'before', 'after', 'onOrBefore', 'onOrAfter'],
    deadline: ['isSet', 'isNotSet', 'equals', 'before', 'after', 'onOrBefore', 'onOrAfter'],
};

/** Display labels for operators */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
    includes: 'includes',
    excludes: 'excludes',
    contains: 'contains',
    notContains: 'does not contain',
    isSet: 'is set',
    isNotSet: 'is not set',
    equals: 'is',
    before: 'is before',
    after: 'is after',
    onOrBefore: 'is on or before',
    onOrAfter: 'is on or after',
};

/** Display labels for properties */
export const PROPERTY_LABELS: Record<FilterProperty, string> = {
    file: 'File',
    tag: 'Tag',
    status: 'Status',
    content: 'Content',
    startDate: 'Start date',
    endDate: 'End date',
    deadline: 'Deadline',
};

/** Operators that require no value input */
export const NO_VALUE_OPERATORS: Set<FilterOperator> = new Set(['isSet', 'isNotSet']);

/** Lucide icon names for property types */
export const PROPERTY_ICONS: Record<FilterProperty, string> = {
    file: 'file',
    tag: 'tag',
    status: 'check-square',
    content: 'text',
    startDate: 'calendar',
    endDate: 'calendar-check',
    deadline: 'alarm-clock',
};

/** Display labels for relative date presets */
export const RELATIVE_DATE_LABELS: Record<RelativeDatePreset, string> = {
    today: 'Today',
    thisWeek: 'This week',
    nextWeek: 'Next week',
    pastWeek: 'Past week',
    nextNDays: 'Next N days',
};

/** Create a default new filter condition */
export function createDefaultCondition(): FilterCondition {
    return {
        id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        property: 'tag',
        operator: 'includes',
        value: { type: 'stringSet', values: [] },
    };
}
