import type { FilterState, FilterCondition, FilterGroup, FilterItem, FilterProperty, DateFilterValue } from './FilterTypes';
import {
    createEmptyFilterState, hasConditions, isFilterCondition,
    PROPERTY_OPERATORS, NO_VALUE_OPERATORS, DATE_PROPERTIES, RELATIVE_DATE_PRESETS,
} from './FilterTypes';
import { DateUtils } from '../../utils/DateUtils';
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

function serializeCondition(c: FilterCondition): Record<string, unknown> {
    const result: Record<string, unknown> = {
        property: c.property,
        operator: c.operator,
    };
    if (c.value !== undefined) result.value = c.value;
    if (c.key !== undefined) result.key = c.key;
    if (c.unit !== undefined) result.unit = c.unit;
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

/** The properties whose value is a list of strings. */
const LIST_PROPERTIES: ReadonlySet<FilterProperty> = new Set(['file', 'tag', 'status', 'color', 'linestyle', 'notation']);

/** A condition, or why it is not one. */
function readCondition(c: Record<string, unknown>): FilterCondition | string {
    const property = c.property as FilterProperty;
    const operators = typeof c.property === 'string' && Object.prototype.hasOwnProperty.call(PROPERTY_OPERATORS, c.property)
        ? PROPERTY_OPERATORS[property]
        : undefined;
    if (!operators) {
        return `Unknown filter property: ${String(c.property)}. Available: ${Object.keys(PROPERTY_OPERATORS).join(', ')}`;
    }
    const operator = c.operator as FilterCondition['operator'];
    if (!operators.includes(operator)) {
        return `Invalid operator '${String(c.operator)}' for filter property '${property}'. Available: ${operators.join(', ')}`;
    }
    if (c.target !== undefined && c.target !== 'self' && c.target !== 'parent') {
        return `Invalid target '${String(c.target)}'. Use self or parent`;
    }

    const node: FilterCondition = { property, operator };
    if (c.target === 'parent') node.target = 'parent';

    if (property === 'property') {
        if (c.key !== undefined && typeof c.key !== 'string') return `'property' takes a key that is text`;
        if (c.key !== undefined) node.key = c.key;
    }
    if (property === 'length' && c.unit !== undefined) {
        if (c.unit !== 'hours' && c.unit !== 'minutes') return `Invalid unit '${String(c.unit)}' for 'length'. Use hours or minutes`;
        node.unit = c.unit;
    }

    if (NO_VALUE_OPERATORS.has(operator) || c.value === undefined || c.value === null) return node;
    const value = readValue(property, c.value);
    if ('reason' in value) return value.reason;
    node.value = value.value;
    return node;
}

type ValueRead = { value: NonNullable<FilterCondition['value']> } | { reason: string };

/** The value of a condition on `property`, in the shapes the filter menu writes. */
function readValue(property: FilterProperty, value: unknown): ValueRead {
    if (LIST_PROPERTIES.has(property)) {
        return Array.isArray(value) && value.every(v => typeof v === 'string')
            ? { value: value as string[] }
            : { reason: `'${property}' takes a list of strings` };
    }
    if (property === 'content' || property === 'property') {
        return typeof value === 'string' ? { value } : { reason: `'${property}' takes text` };
    }
    if (property === 'length') {
        return typeof value === 'number' && Number.isFinite(value) ? { value } : { reason: `'length' takes a number` };
    }
    if (DATE_PROPERTIES.has(property)) {
        const date = readDateValue(value);
        return date !== undefined
            ? { value: date }
            : { reason: `'${property}' takes a date that exists (YYYY-MM-DD) or a preset (${RELATIVE_DATE_PRESETS.join(', ')})` };
    }
    return { reason: `'${property}' takes no value` };
}

/** A date filter value: a day that exists, `''` (none chosen yet), or a known preset. */
function readDateValue(value: unknown): DateFilterValue | undefined {
    if (typeof value === 'string') {
        return value === '' || DateUtils.isValidDateString(value) ? value : undefined;
    }
    if (!isRecord(value)) return undefined;
    const preset = RELATIVE_DATE_PRESETS.find(p => p === value.preset);
    if (!preset) return undefined;
    if (preset !== 'nextNDays' || value.n === undefined) return { preset };
    const n = value.n;
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? { preset, n } : undefined;
}
