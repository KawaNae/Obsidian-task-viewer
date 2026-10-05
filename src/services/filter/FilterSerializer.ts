import type {
    FilterState, FilterCondition, FilterGroup, FilterItem, FilterProperty, DateFilterValue, FilterTarget, SingleDateValue,
} from './FilterTypes';
import {
    createEmptyFilterState, hasConditions, isDateRange, isReversedRange, isFilterCondition, isFilterProperty, isPresenceOperator,
    takesOperator, takesRange, PROPERTY_OPERATORS, RELATIVE_DATE_PRESETS,
} from './FilterTypes';
import { DateTimeInput } from '../../utils/values/DateValues';
import { unicodeBtoa, unicodeAtob } from '../../utils/base64';

/**
 * A part of a saved filter that could not be read and was dropped: where it
 * was (`filters[1].filters[0]`, or `filter` for the whole) and why, in
 * English. The API throws these; a view drops the part and tells the user.
 */
export interface FilterIssue {
    readonly at: string;
    readonly reason: string;
}

export interface FilterRead {
    readonly state: FilterState;
    readonly issues: readonly FilterIssue[];
}

/** One issue as a sentence. */
export function filterIssueText(issue: FilterIssue): string {
    return `${issue.at}: ${issue.reason}`;
}

/**
 * The one reader of a saved filter, and its writer.
 *
 * `parse` is the boundary every saved or handed-in filter crosses (a
 * template, the workspace, a URI, the API's `filter`, a filter file): it
 * keeps what is a condition the engine can evaluate and drops the rest into
 * `issues`, so nothing past it holds a property, an operator or a value of
 * the wrong kind. A condition whose value is not chosen yet (an empty list,
 * no date, no number, no key) is kept: it is a row a user left unfinished,
 * and it constrains nothing. `toJSON` writes the same shape back.
 */
export class FilterSerializer {
    static toJSON(state: FilterState): Record<string, unknown> {
        return serializeGroup(state);
    }

    static parse(raw: unknown): FilterRead {
        const issues: FilterIssue[] = [];
        const state = parseRoot(raw, issues);
        return { state, issues };
    }

    static toURIParam(state: FilterState): string {
        if (!hasConditions(state)) return '';
        const json = JSON.stringify(this.toJSON(state));
        return unicodeBtoa(json);
    }

    static parseURIParam(param: string): FilterRead {
        if (!param) return { state: createEmptyFilterState(), issues: [] };
        let parsed: unknown;
        try {
            parsed = JSON.parse(unicodeAtob(param));
        } catch {
            return { state: createEmptyFilterState(), issues: [{ at: 'filter', reason: 'not base64-encoded JSON' }] };
        }
        return this.parse(parsed);
    }
}

// ── Serialization ──

function serializeGroup(group: FilterGroup): Record<string, unknown> {
    return {
        logic: group.logic,
        filters: group.filters.map(serializeItem),
    };
}

function serializeItem(node: FilterItem): Record<string, unknown> {
    if (isFilterCondition(node)) {
        return serializeCondition(node);
    }
    return serializeGroup(node);
}

/** The condition's fields, in the saved order, leaving out what it does not hold. */
function serializeCondition(c: FilterCondition): Record<string, unknown> {
    const result: Record<string, unknown> = {
        property: c.property,
        operator: c.operator,
    };
    if ('value' in c && c.value !== undefined) result.value = c.value;
    if ('key' in c && c.key !== undefined) result.key = c.key;
    if ('unit' in c && c.unit !== undefined) result.unit = c.unit;
    if (c.target !== undefined) result.target = c.target;
    return result;
}

// ── Parsing ──

function isRecord(raw: unknown): raw is Record<string, unknown> {
    return !!raw && typeof raw === 'object' && !Array.isArray(raw);
}

function parseRoot(raw: unknown, issues: FilterIssue[]): FilterState {
    if (!isRecord(raw)) {
        issues.push({ at: 'filter', reason: 'not a filter group ({ logic, filters })' });
        return createEmptyFilterState();
    }
    // The saved shape: a group `{ logic, filters }` (no version number)
    if (isGroupShape(raw)) return parseGroup(raw, '', issues);
    // A single condition handed in on its own
    if ('property' in raw) {
        return { filters: parseConditionInto(raw, 'filter', issues), logic: 'and' };
    }
    issues.push({ at: 'filter', reason: 'not a filter group ({ logic, filters })' });
    return createEmptyFilterState();
}

function isGroupShape(obj: Record<string, unknown>): boolean {
    return 'filters' in obj || 'logic' in obj;
}

function parseGroup(obj: Record<string, unknown>, path: string, issues: FilterIssue[]): FilterGroup {
    const filters: FilterItem[] = [];
    const listAt = path ? `${path}.filters` : 'filters';
    if (Array.isArray(obj.filters)) {
        obj.filters.forEach((child, i) => {
            const at = `${listAt}[${i}]`;
            if (isRecord(child) && isGroupShape(child)) {
                filters.push(parseGroup(child, at, issues));
            } else if (isRecord(child) && 'property' in child) {
                filters.push(...parseConditionInto(child, at, issues));
            } else {
                issues.push({ at, reason: 'not a condition or a group' });
            }
        });
    } else if (obj.filters !== undefined) {
        issues.push({ at: listAt, reason: 'not a list' });
    }
    return {
        filters,
        logic: obj.logic === 'or' ? 'or' : 'and',
    };
}

/** The condition `c` reads as, in a list of none or one. */
function parseConditionInto(c: Record<string, unknown>, at: string, issues: FilterIssue[]): FilterCondition[] {
    if (isRetiredCondition(c)) return [];
    const read = readCondition(c);
    if (typeof read === 'string') {
        issues.push({ at, reason: read });
        return [];
    }
    return [read];
}

/**
 * Conditions on a property that no longer exists, dropped on read without a
 * word.
 *
 * `kind` told inline tasks from file tasks; with frontmatter no longer making
 * tasks, every task is inline. Saved views and pinned lists both load through
 * here, so this is the one place a retired condition has to be recognised. A
 * group left empty stays, as an empty group, which the engine reads as true —
 * so the conditions beside it keep their meaning.
 */
function isRetiredCondition(c: Record<string, unknown>): boolean {
    return c.property === 'kind';
}

/**
 * A condition, or why it is not one: the property is one a condition can be
 * on, the property takes the operator, and the value has the shape the
 * property's value has. A value saved with an operator that takes none is
 * not read.
 */
function readCondition(c: Record<string, unknown>): FilterCondition | string {
    const property = c.property;
    if (!isFilterProperty(property)) {
        return `Unknown filter property: ${String(property)}. Available: ${Object.keys(PROPERTY_OPERATORS).join(', ')}`;
    }
    const operator: unknown = c.operator;
    const badOperator = `Invalid operator '${String(operator)}' for filter property '${property}'. Available: ${PROPERTY_OPERATORS[property].join(', ')}`;
    if (!takesOperator(property, operator)) return badOperator;
    if (c.target !== undefined && c.target !== 'self' && c.target !== 'parent') {
        return `Invalid target '${String(c.target)}'. Use self or parent`;
    }
    const on: { target?: FilterTarget } = c.target === 'parent' ? { target: 'parent' } : {};
    const valueFor = (op: FilterCondition['operator']): unknown =>
        c.value === null || isPresenceOperator(op) ? undefined : c.value;

    // Each case asks `takesOperator` again only to narrow the operator to its
    // property's: it was answered above.
    switch (property) {
        case 'file':
        case 'status':
        case 'color':
        case 'linestyle':
        case 'notation': {
            if (!takesOperator(property, operator)) return badOperator;
            const value = readStrings(property, valueFor(operator));
            return typeof value === 'string' ? value : { property, operator, ...on, ...value };
        }
        case 'tag': {
            if (!takesOperator(property, operator)) return badOperator;
            const value = readStrings(property, valueFor(operator));
            return typeof value === 'string' ? value : { property, operator, ...on, ...value };
        }
        case 'content': {
            if (!takesOperator(property, operator)) return badOperator;
            const raw = valueFor(operator);
            if (raw !== undefined && typeof raw !== 'string') return `'content' takes text`;
            return { property, operator, ...on, ...(raw !== undefined ? { value: raw } : {}) };
        }
        case 'property': {
            if (!takesOperator(property, operator)) return badOperator;
            if (c.key !== undefined && typeof c.key !== 'string') return `'property' takes a key that is text`;
            const raw = valueFor(operator);
            if (raw !== undefined && typeof raw !== 'string') return `'property' takes text`;
            return {
                property, operator, ...on,
                ...(c.key !== undefined ? { key: c.key } : {}),
                ...(raw !== undefined ? { value: raw } : {}),
            };
        }
        case 'length': {
            if (!takesOperator(property, operator)) return badOperator;
            const unit = c.unit;
            if (unit !== undefined && unit !== 'hours' && unit !== 'minutes') {
                return `Invalid unit '${String(unit)}' for 'length'. Use hours or minutes`;
            }
            const raw = valueFor(operator);
            if (raw !== undefined && !(typeof raw === 'number' && Number.isFinite(raw))) return `'length' takes a number`;
            return {
                property, operator, ...on,
                ...(raw !== undefined ? { value: raw } : {}),
                ...(unit !== undefined ? { unit } : {}),
            };
        }
        case 'startDate':
        case 'endDate':
        case 'due': {
            if (!takesOperator(property, operator)) return badOperator;
            const raw = valueFor(operator);
            if (raw === undefined) return { property, operator, ...on };
            const value = readDateFilterValue(property, raw);
            if (typeof value === 'string') return value;
            if (isDateRange(value.value) && !takesRange(property, operator)) return `'${property}' takes a range only with equals`;
            return { property, operator, ...on, value: value.value };
        }
        case 'period': {
            if (!takesOperator(property, operator)) return badOperator;
            if (c.target === 'parent') return `'period' asks about the task itself: it takes no target parent`;
            const raw = valueFor(operator);
            if (raw === undefined) return { property, operator };
            const value = readDateFilterValue(property, raw);
            return typeof value === 'string' ? value : { property, operator, value: value.value };
        }
        case 'anyDate':
        case 'parent':
        case 'children':
            if (!takesOperator(property, operator)) return badOperator;
            return { property, operator, ...on };
    }
}

/** A list property's value: absent, or a list of strings. */
function readStrings(property: FilterProperty, raw: unknown): { value?: readonly string[] } | string {
    if (raw === undefined) return {};
    return Array.isArray(raw) && raw.every(v => typeof v === 'string')
        ? { value: raw as readonly string[] }
        : `'${property}' takes a list of strings`;
}

/**
 * A date filter value, or why it is not one: `''` (none chosen yet), a date
 * that exists, a date and a time (read by `DateTimeInput`, written back as
 * `YYYY-MM-DDTHH:mm`: `2026-10-04 10:00` is read as `2026-10-04T10:00`), a
 * known preset, or a range of these with an end or both. The words are the
 * reference's (`FILTER_VALUE_DOC`).
 */
function readDateFilterValue(property: FilterProperty, raw: unknown): { value: DateFilterValue } | string {
    const wrong = `'${property}' takes a date that exists (YYYY-MM-DD), a date and a time (YYYY-MM-DDTHH:mm), ` +
        `a preset (${RELATIVE_DATE_PRESETS.join(', ')}) or a range ({ "from", "to" })`;
    if (!isRecord(raw) || 'preset' in raw) {
        const value = readSingleDateValue(raw);
        return value !== undefined ? { value } : wrong;
    }

    // A range: its ends are single values, and at least one is written.
    if (raw.from === undefined && raw.to === undefined) return `'${property}' range: give from, to or both`;
    const ends: { from?: SingleDateValue; to?: SingleDateValue } = {};
    for (const side of ['from', 'to'] as const) {
        const end = raw[side];
        if (end === undefined) continue;
        if (isRecord(end) && !('preset' in end)) return `'${property}' range: ${side} is a range; an end is a date, a date and a time or a preset`;
        const value = readSingleDateValue(end);
        if (value === undefined) return wrong;
        ends[side] = value;
    }
    if (isReversedRange(ends)) return `'${property}' range: from ${String(ends.from)} is after to ${String(ends.to)}`;
    return { value: ends };
}

/** A single value: `''`, a date, a date and a time in the `T` form, or a preset. */
function readSingleDateValue(value: unknown): SingleDateValue | undefined {
    if (typeof value === 'string') {
        if (value === '') return value;
        const read = DateTimeInput.read(value, { timeOnly: 'refuse' });
        if (!read.ok) return undefined;
        const { date, time } = read.value;
        return time ? `${date}T${time}` : date;
    }
    if (!isRecord(value)) return undefined;
    const preset = RELATIVE_DATE_PRESETS.find(p => p === value.preset);
    if (!preset) return undefined;
    if (preset !== 'nextNDays' || value.n === undefined) return { preset };
    const n = value.n;
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? { preset, n } : undefined;
}
