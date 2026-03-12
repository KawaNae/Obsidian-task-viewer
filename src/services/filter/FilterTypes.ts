import type { Task } from '../../types';

// ── Property & Operator enums ──

export type FilterProperty =
    | 'file' | 'tag' | 'status' | 'content'
    | 'startDate' | 'endDate' | 'due'
    | 'color' | 'linestyle'
    | 'length' | 'taskType'
    | 'parent' | 'children';

export type FilterOperator =
    | 'includes' | 'excludes'
    | 'isSet' | 'isNotSet'
    | 'contains' | 'notContains'
    | 'equals' | 'before' | 'after' | 'onOrBefore' | 'onOrAfter'
    | 'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual';

// ── Value types ──

export type FilterValue =
    | { type: 'stringSet'; values: string[] }
    | { type: 'boolean'; value: boolean }
    | { type: 'string'; value: string }
    | { type: 'date'; value: DateFilterValue }
    | { type: 'number'; value: number; unit?: 'hours' | 'minutes' };

export type RelativeDatePreset = 'today' | 'thisWeek' | 'nextWeek' | 'pastWeek' | 'nextNDays' | 'thisMonth' | 'thisYear';

export type DateFilterValue =
    | { mode: 'absolute'; date: string }
    | { mode: 'relative'; preset: RelativeDatePreset; n?: number };

// ── Recursive filter tree ──

export const MAX_FILTER_DEPTH = 3;

export type FilterNode = FilterConditionNode | FilterGroupNode;

export type FilterTarget = 'self' | 'parent';

export interface FilterConditionNode {
    type: 'condition';
    id: string;
    property: FilterProperty;
    operator: FilterOperator;
    value: FilterValue;
    target?: FilterTarget;
}

export interface FilterGroupNode {
    type: 'group';
    id: string;
    children: FilterNode[];
    logic: 'and' | 'or';
}

export interface FilterState {
    root: FilterGroupNode;
}

/** Optional context for filter evaluation (e.g., view-level settings). */
export interface FilterContext {
    startHour?: number;
    taskLookup?: (id: string) => Task | undefined;
}

/** @deprecated Use FilterConditionNode */
export type FilterCondition = FilterConditionNode;
/** @deprecated Use FilterGroupNode */
export type FilterGroup = FilterGroupNode;

// ── Frozen sentinel ──

export const EMPTY_FILTER_STATE: FilterState = Object.freeze({
    root: Object.freeze({
        type: 'group' as const,
        id: 'root',
        children: Object.freeze([]) as readonly FilterNode[] as FilterNode[],
        logic: 'and' as const,
    }),
});

// ── Factory functions ──

function generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyFilterState(): FilterState {
    return { root: createFilterGroup() };
}

export function createFilterGroup(): FilterGroupNode {
    return { type: 'group', id: generateId('g'), children: [], logic: 'and' };
}

export function createDefaultCondition(): FilterConditionNode {
    return {
        type: 'condition',
        id: generateId('f'),
        property: 'tag',
        operator: 'includes',
        value: { type: 'stringSet', values: [] },
    };
}

/** @deprecated Use createFilterGroup() */
export function createEmptyFilterGroup(): FilterGroupNode {
    return createFilterGroup();
}

// ── Tree query helpers ──

export function hasConditions(state: FilterState): boolean {
    return hasConditionsInGroup(state.root);
}

function hasConditionsInGroup(group: FilterGroupNode): boolean {
    return group.children.some(child =>
        child.type === 'condition' || hasConditionsInGroup(child),
    );
}

export function getAllConditions(state: FilterState): FilterConditionNode[] {
    const result: FilterConditionNode[] = [];
    collectConditions(state.root, result);
    return result;
}

function collectConditions(group: FilterGroupNode, out: FilterConditionNode[]): void {
    for (const child of group.children) {
        if (child.type === 'condition') {
            out.push(child);
        } else {
            collectConditions(child, out);
        }
    }
}

/** Deep-clone a FilterNode, regenerating all IDs */
export function deepCloneNode(node: FilterNode): FilterNode {
    if (node.type === 'condition') {
        return { ...JSON.parse(JSON.stringify(node)), id: generateId('f') };
    }
    return {
        type: 'group',
        id: generateId('g'),
        children: node.children.map(deepCloneNode),
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
    tag: ['includes', 'excludes'],
    status: ['includes', 'excludes'],
    content: ['contains', 'notContains'],
    startDate: ['isSet', 'isNotSet', 'equals', 'before', 'after', 'onOrBefore', 'onOrAfter'],
    endDate: ['isSet', 'isNotSet', 'equals', 'before', 'after', 'onOrBefore', 'onOrAfter'],
    due: ['isSet', 'isNotSet', 'equals', 'before', 'after', 'onOrBefore', 'onOrAfter'],
    color: ['includes', 'excludes'],
    linestyle: ['includes', 'excludes'],
    length: ['lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual', 'equals', 'isSet', 'isNotSet'],
    taskType: ['includes', 'excludes'],
    parent: ['isSet', 'isNotSet'],
    children: ['isSet', 'isNotSet'],
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
    lessThan: 'is less than',
    lessThanOrEqual: 'is at most',
    greaterThan: 'is greater than',
    greaterThanOrEqual: 'is at least',
};

/** Display labels for properties */
export const PROPERTY_LABELS: Record<FilterProperty, string> = {
    file: 'File',
    tag: 'Tag',
    status: 'Status',
    content: 'Content',
    startDate: 'Start',
    endDate: 'End',
    due: 'Due',
    color: 'Color',
    linestyle: 'Line style',
    length: 'Length',
    taskType: 'Task type',
    parent: 'Parent',
    children: 'Children',
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
    due: 'alarm-clock',
    color: 'palette',
    linestyle: 'minus',
    length: 'timer',
    taskType: 'file-type',
    parent: 'arrow-up',
    children: 'arrow-down',
};

/** Display labels for relative date presets */
export const RELATIVE_DATE_LABELS: Record<RelativeDatePreset, string> = {
    today: 'Today',
    thisWeek: 'This week',
    nextWeek: 'Next week',
    pastWeek: 'Past week',
    nextNDays: 'Next N days',
    thisMonth: 'This month',
    thisYear: 'This year',
};
