import type {
    FilterState, FilterGroup, FilterItem, FilterCondition, FilterProperty, FilterOperator, FilterTarget,
    DateFilterValue, DateRangeValue, DateComparison, PresetValue, SingleDateValue,
} from './FilterTypes';
import {
    isFilterCondition, isPresenceOperator, takesOperator, takesRange, isDateProperty, isTextListProperty, isFlagProperty,
    isDateRange, isDateTimeText, isPresetValue,
} from './FilterTypes';
import { daysOfValue, type WindowContext } from '../../utils/DayWindow';

/**
 * The edits the filter menu makes, each a function from a filter to a new
 * one. A FilterState is a value: an edit builds the nodes on the way to the
 * one it changes and shares the rest, so a holder of the old filter sees no
 * change, and no holder copies one to protect itself.
 *
 * A node is addressed by its path from the root group: the index in each
 * group on the way down. The root's path is `[]`.
 */
export type NodePath = readonly number[];

/** The node at `path`. */
export function nodeAt(state: FilterState, path: NodePath): FilterItem {
    let node: FilterItem = state;
    for (const i of path) {
        if (isFilterCondition(node) || !(i in node.filters)) throw new Error(`filter: no node at [${path.join(', ')}]`);
        node = node.filters[i];
    }
    return node;
}

/** `state` with the group at `path` replaced by what `edit` makes of it. */
export function updateGroupAt(state: FilterState, path: NodePath, edit: (group: FilterGroup) => FilterGroup): FilterState {
    if (path.length === 0) return edit(state);
    return replaceAt(state, path, node => {
        if (isFilterCondition(node)) throw new Error(`filter: [${path.join(', ')}] is a condition, not a group`);
        return [edit(node)];
    });
}

/** `state` with the condition at `path` replaced by what `edit` makes of it. */
export function updateConditionAt(
    state: FilterState,
    path: NodePath,
    edit: (condition: FilterCondition) => FilterCondition,
): FilterState {
    return replaceAt(state, path, node => {
        if (!isFilterCondition(node)) throw new Error(`filter: [${path.join(', ')}] is a group, not a condition`);
        return [edit(node)];
    });
}

/**
 * `state` with the node at `path` (not the root) replaced by the nodes
 * `edit` makes of it: none removes it, two duplicate it, a group's own
 * nodes ungroup it. When `edit` hands back the node itself, `state` comes
 * back unchanged, the same object.
 */
export function replaceAt(state: FilterState, path: NodePath, edit: (node: FilterItem) => readonly FilterItem[]): FilterState {
    if (path.length === 0) throw new Error('filter: the root group cannot be replaced');
    const [i, ...rest] = path;
    const child = state.filters[i];
    if (child === undefined) throw new Error(`filter: no node at [${path.join(', ')}]`);
    let replacement: readonly FilterItem[];
    if (rest.length === 0) {
        replacement = edit(child);
        if (replacement.length === 1 && replacement[0] === child) return state;
    } else {
        if (isFilterCondition(child)) throw new Error(`filter: no node at [${path.join(', ')}]`);
        const next = replaceAt(child, rest, edit);
        if (next === child) return state;
        replacement = [next];
    }
    return { ...state, filters: [...state.filters.slice(0, i), ...replacement, ...state.filters.slice(i + 1)] };
}

/** `group` with `node` added at its end. */
export function appendTo(group: FilterGroup, node: FilterItem): FilterGroup {
    return { ...group, filters: [...group.filters, node] };
}

/** `group` with its logic turned to the other one. */
export function toggleLogic(group: FilterGroup): FilterGroup {
    return { ...group, logic: group.logic === 'and' ? 'or' : 'and' };
}

// ── Conditions ──

/**
 * A new row on `property`: its first operator, and the value the menu starts
 * that operator with. `target` carries over from the row it replaces.
 */
export function conditionOn(property: FilterProperty, target?: FilterTarget): FilterCondition {
    // A period row asks about the task itself.
    if (property === 'period') return { property, operator: 'overlaps', value: { preset: 'today' } };
    const on = target === 'parent' ? { target } : {};
    if (property === 'tag') return { property, operator: 'includes', value: [], ...on };
    if (isTextListProperty(property)) return { property, operator: 'includes', value: [], ...on };
    if (property === 'content') return { property, operator: 'contains', value: '', ...on };
    if (isDateProperty(property)) return { property, operator: 'isSet', ...on };
    if (isFlagProperty(property)) return { property, operator: 'isSet', ...on };
    if (property === 'length') return { property, operator: 'lessThan', value: 1, unit: 'hours', ...on };
    return { property, operator: 'isSet', key: '', ...on };
}

/**
 * `c` asking `operator`. An operator that takes no value drops the value; one
 * that takes a value keeps the value there is, or starts with the menu's
 * (today for a date, 1 hour for a length). The property's key and unit stay.
 * A range, on an operator that takes none, becomes its end nearer in meaning
 * ({@link nearEnd}).
 */
export function withOperator(c: FilterCondition, operator: FilterOperator): FilterCondition {
    const refuse = (): never => { throw new Error(`filter: '${c.property}' takes no '${operator}'`); };
    switch (c.property) {
        case 'startDate':
        case 'endDate':
        case 'due': {
            if (!takesOperator(c.property, operator)) return refuse();
            const { value, ...rest } = c;
            if (isPresenceOperator(operator)) return { ...rest, operator };
            if (value !== undefined && isDateRange(value) && !takesRange(c.property, operator)) {
                return { ...rest, operator, value: nearEnd(value, operator) };
            }
            return { ...rest, operator, value: value ?? { preset: 'today' } };
        }
        case 'period':
            return takesOperator(c.property, operator) ? { ...c, operator } : refuse();
        case 'length': {
            if (!takesOperator(c.property, operator)) return refuse();
            const { value, ...rest } = c;
            if (isPresenceOperator(operator)) return { ...rest, operator };
            return value === undefined
                ? { ...rest, operator, value: 1, unit: 'hours' }
                : { ...rest, operator, value };
        }
        case 'property': {
            if (!takesOperator(c.property, operator)) return refuse();
            const { value, ...rest } = c;
            return isPresenceOperator(operator) ? { ...rest, operator } : { ...rest, operator, value };
        }
        case 'tag':
            return takesOperator(c.property, operator) ? { ...c, operator } : refuse();
        case 'content':
            return takesOperator(c.property, operator) ? { ...c, operator } : refuse();
        case 'anyDate':
        case 'parent':
        case 'children':
            return takesOperator(c.property, operator) ? { ...c, operator } : refuse();
        case 'file':
        case 'status':
        case 'color':
        case 'linestyle':
        case 'notation':
            return takesOperator(c.property, operator) ? { ...c, operator } : refuse();
    }
}

/** `c` asking about `target`; `self` is written as no target. A period row asks about the task itself. */
export function withTarget(c: FilterCondition, target: FilterTarget): FilterCondition {
    if (c.property === 'period') {
        if (target === 'parent') throw new Error(`filter: 'period' asks about the task itself`);
        return c;
    }
    const { target: _target, ...rest } = c;
    return target === 'parent' ? { ...rest, target } : rest;
}

// ── Date values ──

/**
 * The end of `range` an operator that takes no range reads it by: before
 * and on or after look from its first day, after and on or before from its
 * last (`due = 10/01 to 10/10` turned to before is before 10/01, to on or
 * before is on or before 10/10). Today when that end is not there.
 */
function nearEnd(range: DateRangeValue, operator: DateComparison): SingleDateValue {
    const end = operator === 'before' || operator === 'onOrAfter' ? range.from : range.to;
    return end === undefined || end === '' ? { preset: 'today' } : end;
}

/**
 * The value as a date, for the menu's "date" kind: a date stays, a date and
 * a time is its date, a preset its first day, a range the date of its first
 * end there is (`''` when none is).
 */
export function asDate(value: DateFilterValue, ctx: WindowContext): string {
    if (isDateRange(value)) {
        const end = value.from !== undefined && value.from !== '' ? value.from : value.to;
        return end === undefined ? '' : asDate(end, ctx);
    }
    if (isPresetValue(value)) return daysOfValue(value, ctx).from ?? '';
    return isDateTimeText(value) ? value.slice(0, 10) : value;
}

/** The value as a preset, for the menu's "relative" kind: a preset stays, any other is today. */
export function asPreset(value: DateFilterValue): PresetValue {
    return isPresetValue(value) ? value : { preset: 'today' };
}

/**
 * The value as a range, for the menu's "range" kind: a date D is D to D, a
 * date and a time is that moment at both ends, a preset its days (this week
 * is its Monday to its Sunday), a range stays.
 */
export function asRange(value: DateFilterValue, ctx: WindowContext): DateRangeValue {
    if (isDateRange(value)) return value;
    if (isPresetValue(value)) {
        const { from, to } = daysOfValue(value, ctx);
        return { from, to };
    }
    return { from: value, to: value };
}
