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
    logic: 'and';
}

export const EMPTY_FILTER_STATE: FilterState = { conditions: [], logic: 'and' };
