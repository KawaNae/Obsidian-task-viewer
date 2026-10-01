import type { FilterState, FilterItem, FilterCondition, DateFilterValue } from './FilterTypes';
import { isFilterCondition } from './FilterTypes';

/**
 * The tree the engine evaluates, compiled from a FilterState.
 *
 * A FilterState is what the filter menu edits and what is saved: a condition
 * there names its negation in the operator (`excludes`, `notContains`,
 * `isNotSet`) and its subject in `target`. Here negation and the subject are
 * nodes of their own, and every atom asks a positive question of one task:
 *
 * - `excludes` is `not(includes)`, `notContains` is `not(contains)`,
 *   `isNotSet` is `not(isSet)`
 * - `target: parent` is `ancestors(atom)`: some ancestor answers yes
 * - the two together are `not(ancestors(atom))`: no ancestor answers yes. A
 *   task without ancestors has none that does, so it passes
 *
 * A condition whose value is not chosen yet (an empty list, no date, no
 * number, no key) constrains nothing: it compiles to {@link ALWAYS} as a
 * whole, its operator and target unread — mapping it would turn an
 * unfinished `excludes` into "matches nothing".
 *
 * The tree is never saved: the menu and the saved JSON keep the FilterState
 * shape, and the tree is compiled from it each time a filter is applied.
 */
export type FilterExpr =
    | { readonly kind: 'all' | 'any'; readonly items: readonly FilterExpr[] }
    | { readonly kind: 'not'; readonly item: FilterExpr }
    | { readonly kind: 'ancestors'; readonly item: FilterExpr }
    | FilterAtom;

export type TextProperty = 'file' | 'status' | 'color' | 'linestyle' | 'notation';
export type DateProperty = 'startDate' | 'endDate' | 'due';
export type DateComparison = 'equals' | 'before' | 'after' | 'onOrBefore' | 'onOrAfter';
export type LengthComparison = 'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'equals';

/** A positive question about one task. */
export type FilterAtom =
    /** The property's value is one of `values`. */
    | { readonly kind: 'textIn'; readonly property: TextProperty; readonly values: readonly string[] }
    /** A tag of the task is one of `tags`, or below one (`a/b` is under `a`). */
    | { readonly kind: 'tagUnder'; readonly tags: readonly string[] }
    /** A tag of the task is exactly one of `tags`. */
    | { readonly kind: 'tagIs'; readonly tags: readonly string[] }
    /** The task's tags are exactly `tags`. */
    | { readonly kind: 'tagsExactly'; readonly tags: readonly string[] }
    /** The content contains `text`, ignoring case. */
    | { readonly kind: 'contentContains'; readonly text: string }
    /** The task has the property: a date, a date of any kind, a parent, a child task, a span. */
    | { readonly kind: 'has'; readonly property: DateProperty | 'anyDate' | 'parent' | 'children' | 'length' }
    /** The date compares to the day or the days `value` names. */
    | { readonly kind: 'date'; readonly property: DateProperty; readonly op: DateComparison; readonly value: DateFilterValue }
    /** The span compares to `value` in `unit`. */
    | { readonly kind: 'length'; readonly op: LengthComparison; readonly value: number; readonly unit: 'hours' | 'minutes' }
    /** The task has the `key:: value` property. */
    | { readonly kind: 'propertySet'; readonly key: string }
    /** The property's value is `value`. */
    | { readonly kind: 'propertyEquals'; readonly key: string; readonly value: string }
    /** The property's value contains `value`, ignoring case. */
    | { readonly kind: 'propertyContains'; readonly key: string; readonly value: string };

/** The tree that every task passes: an empty `all`. */
export const ALWAYS: FilterExpr = { kind: 'all', items: [] };

/** Compile the filter the menu edits and the views save into the tree the engine evaluates. */
export function compileFilter(state: FilterState): FilterExpr {
    return compileItem(state);
}

function compileItem(node: FilterItem): FilterExpr {
    if (isFilterCondition(node)) return compileCondition(node);
    // A group with nothing in it constrains nothing, whatever its logic: an
    // empty `any` would match no task.
    if (node.filters.length === 0) return ALWAYS;
    return { kind: node.logic === 'or' ? 'any' : 'all', items: node.filters.map(compileItem) };
}

function compileCondition(c: FilterCondition): FilterExpr {
    if (isUnfinished(c)) return ALWAYS;
    const { atom, negated } = positiveOf(c);
    const subject: FilterExpr = c.target === 'parent' ? { kind: 'ancestors', item: atom } : atom;
    return negated ? { kind: 'not', item: subject } : subject;
}

const takesNoValue = (c: FilterCondition) => c.operator === 'isSet' || c.operator === 'isNotSet';

/** A condition whose value is not chosen yet. */
function isUnfinished(c: FilterCondition): boolean {
    if (c.property === 'property' && !c.key) return true;
    if (takesNoValue(c)) return false;
    // A property condition's text is read as '' when absent; the content's
    // '' is a value like any other.
    if (c.property === 'property') return false;
    if (c.property === 'content') return c.value === undefined;
    const v = c.value;
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** The positive atom `c` asks, and whether `c` asks its negation. */
function positiveOf(c: FilterCondition): { atom: FilterAtom; negated: boolean } {
    const negated = c.operator === 'excludes' || c.operator === 'notContains' || c.operator === 'isNotSet';
    if (takesNoValue(c)) {
        if (c.property === 'property') return { atom: { kind: 'propertySet', key: c.key! }, negated };
        return { atom: { kind: 'has', property: c.property as Extract<FilterAtom, { kind: 'has' }>['property'] }, negated };
    }
    const list = c.value as readonly string[];
    switch (c.property) {
        case 'file':
        case 'status':
        case 'color':
        case 'linestyle':
        case 'notation':
            return { atom: { kind: 'textIn', property: c.property, values: list }, negated };
        case 'tag':
            if (c.operator === 'equals') return { atom: { kind: 'tagIs', tags: list }, negated };
            if (c.operator === 'only') return { atom: { kind: 'tagsExactly', tags: list }, negated };
            return { atom: { kind: 'tagUnder', tags: list }, negated };
        case 'content':
            return { atom: { kind: 'contentContains', text: c.value as string }, negated };
        case 'startDate':
        case 'endDate':
        case 'due':
            return {
                atom: { kind: 'date', property: c.property, op: c.operator as DateComparison, value: c.value as DateFilterValue },
                negated,
            };
        case 'length':
            return {
                atom: { kind: 'length', op: c.operator as LengthComparison, value: c.value as number, unit: c.unit ?? 'hours' },
                negated,
            };
        case 'property': {
            const value = typeof c.value === 'string' ? c.value : '';
            return c.operator === 'equals'
                ? { atom: { kind: 'propertyEquals', key: c.key!, value }, negated }
                : { atom: { kind: 'propertyContains', key: c.key!, value }, negated };
        }
        case 'anyDate':
        case 'parent':
        case 'children':
            // These take isSet and isNotSet only, handled above.
            throw new Error(`filter: '${c.property}' takes no ${c.operator}`);
    }
}
