import { t } from '../../i18n';

// ── Conditions ──

/** The properties whose value is one text, matched against a list. */
export type TextListProperty = 'file' | 'status' | 'color' | 'linestyle' | 'notation';
export type DateProperty = 'startDate' | 'endDate' | 'due';
/** The properties a task has or not, with no value to compare. */
export type FlagProperty = 'anyDate' | 'parent' | 'children';

export type PresenceOperator = 'isSet' | 'isNotSet';
export type DateComparison = 'equals' | 'before' | 'after' | 'onOrBefore' | 'onOrAfter';
export type LengthComparison = 'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'equals';

/**
 * The relative date presets, in the order the UI lists them. The type, the
 * filter menu, the API/CLI parser, its error messages and the help texts all
 * read this list.
 */
export const RELATIVE_DATE_PRESETS = ['today', 'thisWeek', 'nextWeek', 'pastWeek', 'nextNDays', 'thisMonth', 'thisYear'] as const;

export type RelativeDatePreset = typeof RELATIVE_DATE_PRESETS[number];

/** `n` of `nextNDays` when none is given. */
export const DEFAULT_NEXT_N_DAYS = 7;

export type DateFilterValue =
    | string                                                        // "2024-01-01" (absolute)
    | { readonly preset: RelativeDatePreset; readonly n?: number };  // relative

export type FilterTarget = 'self' | 'parent';

interface Targeted {
    /** Whose value the condition asks about; absent is the task itself. */
    readonly target?: FilterTarget;
}

/** A value absent from a condition that takes one is not chosen yet: the condition constrains nothing. */
export interface TextListCondition extends Targeted {
    readonly property: TextListProperty;
    readonly operator: 'includes' | 'excludes';
    readonly value?: readonly string[];
}

export interface TagCondition extends Targeted {
    readonly property: 'tag';
    readonly operator: 'includes' | 'excludes' | 'equals' | 'only';
    readonly value?: readonly string[];
}

export interface ContentCondition extends Targeted {
    readonly property: 'content';
    readonly operator: 'contains' | 'notContains';
    readonly value?: string;
}

export interface DateCondition extends Targeted {
    readonly property: DateProperty;
    readonly operator: PresenceOperator | DateComparison;
    /** `''` is an absolute date not chosen yet. */
    readonly value?: DateFilterValue;
}

export interface FlagCondition extends Targeted {
    readonly property: FlagProperty;
    readonly operator: PresenceOperator;
}

export interface LengthCondition extends Targeted {
    readonly property: 'length';
    readonly operator: PresenceOperator | LengthComparison;
    readonly value?: number;
    readonly unit?: 'hours' | 'minutes';
}

export interface PropertyCondition extends Targeted {
    readonly property: 'property';
    readonly operator: PresenceOperator | 'equals' | 'contains' | 'notContains';
    /** The `key:: value` key; absent or `''` is not chosen yet. */
    readonly key?: string;
    readonly value?: string;
}

/**
 * One row of a filter, told apart by its property: the property fixes the
 * operators it takes and the shape of its value. `FilterSerializer.parse`
 * builds these from saved JSON, the filter menu's edits (`FilterEdit`) make
 * new ones, and nothing changes one in place.
 */
export type FilterCondition =
    | TextListCondition
    | TagCondition
    | ContentCondition
    | DateCondition
    | FlagCondition
    | LengthCondition
    | PropertyCondition;

export type FilterProperty = FilterCondition['property'];
export type FilterOperator = FilterCondition['operator'];

/** The condition on `P`. */
export type ConditionOf<P extends FilterProperty> =
    FilterCondition extends infer C ? (C extends FilterCondition ? (P extends C['property'] ? C : never) : never) : never;

/** The operators `P` takes. */
export type OperatorOf<P extends FilterProperty> = ConditionOf<P>['operator'];

// ── Recursive filter tree ──

export const MAX_FILTER_DEPTH = 3;

export type FilterItem = FilterCondition | FilterGroup;

export interface FilterGroup {
    readonly filters: readonly FilterItem[];
    readonly logic: 'and' | 'or';
}

/**
 * A filter as the menu edits it and the views save it. A value: no holder
 * changes one in place, so holders share it without copying.
 */
export type FilterState = FilterGroup;

// FilterContext (the only filter type referencing Task) lives in
// ./FilterContext to keep this module Task-free — types/index.ts imports
// FilterState from here, so importing types back would create a cycle.

// ── Type guards ──

export function isFilterCondition(node: FilterItem): node is FilterCondition {
    return 'property' in node;
}

// ── Factory functions ──

export function createEmptyFilterState(): FilterState {
    return { filters: [], logic: 'and' };
}

/**
 * The filter a newly created list starts with: top-level tasks only.
 *
 * Every checkbox is a task, and a nested one is already drawn inside its
 * parent's card, so listing it again at the top would show it twice. Saved
 * lists keep whatever they were saved with.
 */
export function createDefaultListFilterState(): FilterState {
    return { filters: [{ property: 'parent', operator: 'isNotSet' }], logic: 'and' };
}

export function createFilterGroup(): FilterGroup {
    return { filters: [createDefaultCondition()], logic: 'and' };
}

export function createDefaultCondition(): FilterCondition {
    return { property: 'tag', operator: 'includes', value: [] };
}

// ── Tree query helpers ──

export function hasConditions(state: FilterState): boolean {
    return state.filters.some(child => isFilterCondition(child) || hasConditions(child));
}

/**
 * Combine multiple FilterStates into a single AND group.
 * Skips states with no conditions.
 */
export function combineFilterStates(...states: FilterState[]): FilterState {
    const active = states.filter(s => hasConditions(s));
    if (active.length === 0) return createEmptyFilterState();
    if (active.length === 1) return active[0];
    return { filters: active, logic: 'and' };
}

// ── Constants ──

/** The operators each property takes, in the order the menu lists them; the first is a new row's. */
export const PROPERTY_OPERATORS: { readonly [P in FilterProperty]: readonly OperatorOf<P>[] } = {
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
    notation: ['includes', 'excludes'],
    parent: ['isSet', 'isNotSet'],
    children: ['isSet', 'isNotSet'],
    property: ['isSet', 'isNotSet', 'equals', 'contains', 'notContains'],
};

/** Whether `raw` is a property a condition can be on. */
export function isFilterProperty(raw: unknown): raw is FilterProperty {
    return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(PROPERTY_OPERATORS, raw);
}

/** Whether `property` takes `operator`. */
export function takesOperator<P extends FilterProperty>(property: P, operator: unknown): operator is OperatorOf<P> {
    return (PROPERTY_OPERATORS[property] as readonly unknown[]).includes(operator);
}

const TEXT_LIST_PROPERTIES: ReadonlySet<FilterProperty> = new Set<TextListProperty>(['file', 'status', 'color', 'linestyle', 'notation']);
const DATE_PROPERTY_SET: ReadonlySet<FilterProperty> = new Set<DateProperty>(['startDate', 'endDate', 'due']);
const FLAG_PROPERTIES: ReadonlySet<FilterProperty> = new Set<FlagProperty>(['anyDate', 'parent', 'children']);

export const isTextListProperty = (p: FilterProperty): p is TextListProperty => TEXT_LIST_PROPERTIES.has(p);
export const isDateProperty = (p: FilterProperty): p is DateProperty => DATE_PROPERTY_SET.has(p);
export const isFlagProperty = (p: FilterProperty): p is FlagProperty => FLAG_PROPERTIES.has(p);

/** A condition whose value is a list of texts: a text property's or the tags'. */
export function isListCondition(c: FilterCondition): c is TextListCondition | TagCondition {
    return c.property === 'tag' || isTextListProperty(c.property);
}

export function isDateCondition(c: FilterCondition): c is DateCondition {
    return isDateProperty(c.property);
}

export function isLengthCondition(c: FilterCondition): c is LengthCondition {
    return c.property === 'length';
}

export function isContentCondition(c: FilterCondition): c is ContentCondition {
    return c.property === 'content';
}

export function isPropertyCondition(c: FilterCondition): c is PropertyCondition {
    return c.property === 'property';
}

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

/** Whether `operator` asks only whether the value is there, and takes none. */
export function isPresenceOperator(operator: FilterOperator): operator is PresenceOperator {
    return operator === 'isSet' || operator === 'isNotSet';
}

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
    notation: 'file-type',
    parent: 'arrow-up',
    children: 'arrow-down',
    property: 'list',
};

/** Resolve the display label for a relative date preset. */
export function getRelativeDateLabel(preset: RelativeDatePreset): string {
    return t(`filter.relativeDate.${preset}`);
}
