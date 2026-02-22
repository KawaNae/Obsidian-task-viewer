export type FilterProperty = 'file' | 'tag' | 'status' | 'hasStartDate' | 'hasDeadline' | 'content';

export type FilterOperator =
    | 'includes' | 'excludes'
    | 'isSet' | 'isNotSet'
    | 'contains' | 'notContains';

export interface FilterCondition {
    id: string;
    property: FilterProperty;
    operator: FilterOperator;
    value: FilterValue;
}

export type FilterValue =
    | { type: 'stringSet'; values: string[] }
    | { type: 'boolean'; value: boolean }
    | { type: 'string'; value: string };

export interface FilterState {
    conditions: FilterCondition[];
    logic: 'and' | 'or';
}

export const EMPTY_FILTER_STATE: FilterState = { conditions: [], logic: 'and' };

/** Available operators per property */
export const PROPERTY_OPERATORS: Record<FilterProperty, FilterOperator[]> = {
    file: ['includes', 'excludes'],
    tag: ['includes', 'excludes'],
    status: ['includes', 'excludes'],
    content: ['contains', 'notContains'],
    hasStartDate: ['isSet', 'isNotSet'],
    hasDeadline: ['isSet', 'isNotSet'],
};

/** Display labels for operators */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
    includes: 'includes',
    excludes: 'excludes',
    contains: 'contains',
    notContains: 'does not contain',
    isSet: 'is set',
    isNotSet: 'is not set',
};

/** Display labels for properties */
export const PROPERTY_LABELS: Record<FilterProperty, string> = {
    file: 'File',
    tag: 'Tag',
    status: 'Status',
    content: 'Content',
    hasStartDate: 'Start date',
    hasDeadline: 'Deadline',
};

/** Operators that require no value input */
export const NO_VALUE_OPERATORS: Set<FilterOperator> = new Set(['isSet', 'isNotSet']);

/** Create a default new filter condition */
export function createDefaultCondition(): FilterCondition {
    return {
        id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        property: 'tag',
        operator: 'includes',
        value: { type: 'stringSet', values: [] },
    };
}
