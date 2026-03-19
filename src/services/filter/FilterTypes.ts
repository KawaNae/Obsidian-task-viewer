import type { Task } from '../../types';
import { t } from '../../i18n';

// ── Property & Operator enums ──

export type FilterProperty =
    | 'file' | 'tag' | 'status' | 'content'
    | 'startDate' | 'endDate' | 'due'
    | 'color' | 'linestyle'
    | 'length' | 'taskType'
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

export type FilterNode = FilterConditionNode | FilterGroupNode;

export type FilterTarget = 'self' | 'parent';

export interface FilterConditionNode {
    type: 'condition';
    property: FilterProperty;
    operator: FilterOperator;
    value?: string | number | string[] | DateFilterValue;
    key?: string;             // property フィルタ用
    unit?: 'hours' | 'minutes';  // length フィルタ用
    target?: FilterTarget;
}

export interface FilterGroupNode {
    type: 'group';
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

// ── Frozen sentinel ──

export const EMPTY_FILTER_STATE: FilterState = Object.freeze({
    root: Object.freeze({
        type: 'group' as const,
        children: Object.freeze([]) as readonly FilterNode[] as FilterNode[],
        logic: 'and' as const,
    }),
});

// ── Factory functions ──

export function createEmptyFilterState(): FilterState {
    return { root: createFilterGroup() };
}

export function createFilterGroup(): FilterGroupNode {
    return { type: 'group', children: [], logic: 'and' };
}

export function createDefaultCondition(): FilterConditionNode {
    return {
        type: 'condition',
        property: 'tag',
        operator: 'includes',
        value: [],
    };
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

/** Deep-clone a FilterNode */
export function deepCloneNode(node: FilterNode): FilterNode {
    if (node.type === 'condition') {
        return JSON.parse(JSON.stringify(node));
    }
    return {
        type: 'group',
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
    tag: ['includes', 'excludes', 'equals', 'only'],
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
    color: 'palette',
    linestyle: 'minus',
    length: 'timer',
    taskType: 'file-type',
    parent: 'arrow-up',
    children: 'arrow-down',
    property: 'list',
};

/** Resolve the display label for a relative date preset. */
export function getRelativeDateLabel(preset: RelativeDatePreset): string {
    return t(`filter.relativeDate.${preset}`);
}
