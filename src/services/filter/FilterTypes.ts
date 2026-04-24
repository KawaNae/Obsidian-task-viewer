import type { Task } from '../../types';
import { t } from '../../i18n';

// ── Property & Operator enums ──

export type FilterProperty =
    | 'file' | 'tag' | 'status' | 'content'
    | 'startDate' | 'endDate' | 'due' | 'anyDate'
    | 'color' | 'linestyle'
    | 'length' | 'kind' | 'notation'
    | 'parent' | 'children'
    | 'property';

export type FilterOperator =
    | 'includes' | 'excludes'
    | 'isSet' | 'isNotSet'
    | 'contains' | 'notContains'
    | 'equals' | 'before' | 'after' | 'onOrBefore' | 'onOrAfter'
    | 'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual'
    | 'only';

// ── Value types ──

export type RelativeDatePreset = 'today' | 'thisWeek' | 'nextWeek' | 'pastWeek' | 'nextNDays' | 'thisMonth' | 'thisYear';

export type DateFilterValue =
    | string                                        // "2024-01-01" (absolute)
    | { preset: RelativeDatePreset; n?: number };   // relative

// ── Recursive filter tree ──

export const MAX_FILTER_DEPTH = 3;

export type FilterItem = FilterCondition | FilterGroup;

export type FilterTarget = 'self' | 'parent';

export interface FilterCondition {
    property: FilterProperty;
    operator: FilterOperator;
    value?: string | number | string[] | DateFilterValue;
    key?: string;             // property フィルタ用
    unit?: 'hours' | 'minutes';  // length フィルタ用
    target?: FilterTarget;
}

export interface FilterGroup {
    filters: FilterItem[];
    logic: 'and' | 'or';
}

export type FilterState = FilterGroup;

/** Optional context for filter evaluation (e.g., view-level settings). */
export interface FilterContext {
    startHour?: number;
    taskLookup?: (id: string) => Task | undefined;
}

// ── Type guards ──

export function isFilterCondition(node: FilterItem): node is FilterCondition {
    return 'property' in node;
}

export function isFilterGroup(node: FilterItem): node is FilterGroup {
    return 'filters' in node;
}

// ── Frozen sentinel ──

export const EMPTY_FILTER_STATE: FilterState = Object.freeze({
    filters: Object.freeze([]) as readonly FilterItem[] as FilterItem[],
    logic: 'and' as const,
});

// ── Factory functions ──

export function createEmptyFilterState(): FilterState {
    return { filters: [], logic: 'and' };
}

export function createFilterGroup(): FilterGroup {
    return { filters: [], logic: 'and' };
}

export function createDefaultCondition(): FilterCondition {
    return {
        property: 'tag',
        operator: 'includes',
        value: [],
    };
}

// ── Tree query helpers ──

export function hasConditions(state: FilterState): boolean {
    return hasConditionsInGroup(state);
}

function hasConditionsInGroup(group: FilterGroup): boolean {
    return group.filters.some(child =>
        isFilterCondition(child) || hasConditionsInGroup(child),
    );
}

/**
 * Combine multiple FilterStates into a single AND group.
 * Skips states with no conditions.
 */
export function combineFilterStates(...states: FilterState[]): FilterState {
    const active = states.filter(s => hasConditions(s));
    if (active.length === 0) return EMPTY_FILTER_STATE;
    if (active.length === 1) return active[0];
    return { filters: active, logic: 'and' };
}

export function getAllConditions(state: FilterState): FilterCondition[] {
    const result: FilterCondition[] = [];
    collectConditions(state, result);
    return result;
}

function collectConditions(group: FilterGroup, out: FilterCondition[]): void {
    for (const child of group.filters) {
        if (isFilterCondition(child)) {
            out.push(child);
        } else {
            collectConditions(child, out);
        }
    }
}

/** Deep-clone a FilterItem */
export function deepCloneNode(node: FilterItem): FilterItem {
    if (isFilterCondition(node)) {
        return structuredClone(node);
    }
    return {
        filters: node.filters.map(deepCloneNode),
        logic: node.logic,
    };
}

// ── Constants ──

/** Date properties that use date comparison operators */
export const DATE_PROPERTIES: Set<FilterProperty> = new Set(['startDate', 'endDate', 'due']);

/** Number properties that use numeric comparison operators */
export const NUMBER_PROPERTIES: Set<FilterProperty> = new Set(['length']);

/** Available operators per property */
export const PROPERTY_OPERATORS: Record<FilterProperty, FilterOperator[]> = {
    file: ['includes', 'excludes'],
    tag: ['includes', 'excludes', 'equals', 'only'],
    status: ['includes', 'excludes'],
    content: ['contains', 'notContains'],
    startDate: ['isSet', 'isNotSet', 'equals', 'before', 'after', 'onOrBefore', 'onOrAfter'],
    endDate: ['isSet', 'isNotSet', 'equals', 'before', 'after', 'onOrBefore', 'onOrAfter'],
    due: ['isSet', 'isNotSet', 'equals', 'before', 'after', 'onOrBefore', 'onOrAfter'],
    anyDate: ['isSet', 'isNotSet'],
    color: ['includes', 'excludes'],
    linestyle: ['includes', 'excludes'],
    length: ['lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual', 'equals', 'isSet', 'isNotSet'],
    kind: ['includes', 'excludes'],
    notation: ['includes', 'excludes'],
    parent: ['isSet', 'isNotSet'],
    children: ['isSet', 'isNotSet'],
    property: ['isSet', 'isNotSet', 'equals', 'contains', 'notContains'],
};

/** Resolve the display label for an operator, respecting per-property overrides. */
export function getOperatorLabel(property: FilterProperty, operator: FilterOperator): string {
    const label = t(`filter.operators.${property}.${operator}`);
    if (!label.startsWith('filter.operators.')) return label;
    return t(`filter.operator.${operator}`);
}

/** Resolve the display label for a filter property. */
export function getPropertyLabel(property: FilterProperty): string {
    return t(`filter.property.${property}`);
}

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
    due: 'alarm-clock',
    anyDate: 'calendar-range',
    color: 'palette',
    linestyle: 'minus',
    length: 'timer',
    kind: 'map-pin',
    notation: 'file-type',
    parent: 'arrow-up',
    children: 'arrow-down',
    property: 'list',
};

/** Resolve the display label for a relative date preset. */
export function getRelativeDateLabel(preset: RelativeDatePreset): string {
    return t(`filter.relativeDate.${preset}`);
}
