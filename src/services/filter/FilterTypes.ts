// ── Property & Operator enums ──

export type FilterProperty =
    | 'file' | 'tag' | 'status' | 'content'
    | 'startDate' | 'endDate' | 'deadline'
    | 'color' | 'linestyle';

export type FilterOperator =
    | 'includes' | 'excludes'
    | 'isSet' | 'isNotSet'
    | 'contains' | 'notContains'
    | 'equals' | 'before' | 'after' | 'onOrBefore' | 'onOrAfter';

// ── Value types ──

export type FilterValue =
    | { type: 'stringSet'; values: string[] }
    | { type: 'boolean'; value: boolean }
    | { type: 'string'; value: string }
    | { type: 'date'; value: DateFilterValue };

export type RelativeDatePreset = 'today' | 'thisWeek' | 'nextWeek' | 'pastWeek' | 'nextNDays';

export type DateFilterValue =
    | { mode: 'absolute'; date: string }
    | { mode: 'relative'; preset: RelativeDatePreset; n?: number };

// ── Recursive filter tree ──

export const MAX_FILTER_DEPTH = 3;

export type FilterNode = FilterConditionNode | FilterGroupNode;

export interface FilterConditionNode {
    type: 'condition';
    id: string;
    property: FilterProperty;
    operator: FilterOperator;
    value: FilterValue;
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
    color: ['includes', 'excludes'],
    linestyle: ['includes', 'excludes'],
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
    color: 'Color',
    linestyle: 'Line style',
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
    color: 'palette',
    linestyle: 'minus',
};

/** Display labels for relative date presets */
export const RELATIVE_DATE_LABELS: Record<RelativeDatePreset, string> = {
    today: 'Today',
    thisWeek: 'This week',
    nextWeek: 'Next week',
    pastWeek: 'Past week',
    nextNDays: 'Next N days',
};
