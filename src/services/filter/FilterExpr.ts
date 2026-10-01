import type {
    FilterState, FilterItem, FilterCondition, DateFilterValue,
    TextListProperty, DateProperty, DateComparison, LengthComparison,
} from './FilterTypes';
import { isFilterCondition, isPresenceOperator } from './FilterTypes';

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

/** A positive question about one task. */
export type FilterAtom =
    /** The property's value is one of `values`. */
    | { readonly kind: 'textIn'; readonly property: TextListProperty; readonly values: readonly string[] }
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

/** A condition whose value is not chosen yet. */
function isUnfinished(c: FilterCondition): boolean {
    switch (c.property) {
        case 'property':
            // Its text is read as '' when absent.
            return !c.key;
        case 'content':
            // '' is a text like any other.
            return c.value === undefined;
        case 'startDate':
        case 'endDate':
        case 'due':
            return !isPresenceOperator(c.operator) && (c.value === undefined || c.value === '');
        case 'length':
            return !isPresenceOperator(c.operator) && c.value === undefined;
        case 'anyDate':
        case 'parent':
        case 'children':
            return false;
        default:
            return c.value === undefined || c.value.length === 0;
    }
}

/**
 * The positive atom `c` asks, and whether `c` asks its negation. A row with
 * no value has been turned away by {@link isUnfinished} before this; the
 * fallbacks for an absent value only satisfy the type.
 */
function positiveOf(c: FilterCondition): { atom: FilterAtom; negated: boolean } {
    const negated = c.operator === 'excludes' || c.operator === 'notContains' || c.operator === 'isNotSet';
    switch (c.property) {
        case 'file':
        case 'status':
        case 'color':
        case 'linestyle':
        case 'notation':
            return { atom: { kind: 'textIn', property: c.property, values: c.value ?? [] }, negated };
        case 'tag': {
            const tags = c.value ?? [];
            if (c.operator === 'equals') return { atom: { kind: 'tagIs', tags }, negated };
            if (c.operator === 'only') return { atom: { kind: 'tagsExactly', tags }, negated };
            return { atom: { kind: 'tagUnder', tags }, negated };
        }
        case 'content':
            return { atom: { kind: 'contentContains', text: c.value ?? '' }, negated };
        case 'anyDate':
        case 'parent':
        case 'children':
            return { atom: { kind: 'has', property: c.property }, negated };
        case 'startDate':
        case 'endDate':
        case 'due': {
            const { operator } = c;
            if (isPresenceOperator(operator)) return { atom: { kind: 'has', property: c.property }, negated };
            return { atom: { kind: 'date', property: c.property, op: operator, value: c.value ?? '' }, negated };
        }
        case 'length': {
            const { operator } = c;
            if (isPresenceOperator(operator)) return { atom: { kind: 'has', property: 'length' }, negated };
            return { atom: { kind: 'length', op: operator, value: c.value ?? 0, unit: c.unit ?? 'hours' }, negated };
        }
        case 'property': {
            const key = c.key ?? '';
            const { operator } = c;
            if (isPresenceOperator(operator)) return { atom: { kind: 'propertySet', key }, negated };
            const value = c.value ?? '';
            return operator === 'equals'
                ? { atom: { kind: 'propertyEquals', key, value }, negated }
                : { atom: { kind: 'propertyContains', key, value }, negated };
        }
    }
}
