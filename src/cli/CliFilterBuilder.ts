import type { FilterState, FilterConditionNode, FilterGroupNode } from '../services/filter/FilterTypes';
import type { CliData } from 'obsidian';
import { parseDatePreset } from './CliDatePresetParser';

function generateId(prefix: string): string {
    return `${prefix}-cli-${Math.random().toString(36).slice(2, 7)}`;
}

function condition(
    property: FilterConditionNode['property'],
    operator: FilterConditionNode['operator'],
    value: FilterConditionNode['value'],
): FilterConditionNode {
    return { type: 'condition', id: generateId('f'), property, operator, value };
}

/**
 * Build a FilterState from CLI flags.
 *
 * If `filter` (raw FilterState JSON) is provided, it takes precedence over all simple flags.
 * Otherwise, simple flags are combined with AND logic.
 *
 * Simple flags: file, status, tag, date, content, from, to, due, leaf.
 * `date` and `from`/`to` conflict: `date` takes priority.
 */
export type FilterBuildResult =
    | { ok: true; filter: FilterState | null }
    | { ok: false; error: string };

export function buildFilterFromFlags(params: CliData): FilterBuildResult {
    // Full FilterState JSON override
    if (params.filter) {
        try {
            const parsed = JSON.parse(params.filter);
            if (parsed?.root?.type === 'group') {
                return { ok: true, filter: parsed as FilterState };
            }
            return { ok: false, error: 'Invalid filter JSON: missing root group' };
        } catch {
            return { ok: false, error: 'Failed to parse filter JSON' };
        }
    }

    const conditions: FilterConditionNode[] = [];

    if (params.file) {
        const file = params.file.endsWith('.md') ? params.file : params.file + '.md';
        conditions.push(condition('file', 'includes', {
            type: 'stringSet', values: [file],
        }));
    }

    if (params.status) {
        const chars = params.status.split(',').map(s => s.trim()).filter(Boolean);
        if (chars.length > 0) {
            conditions.push(condition('status', 'includes', {
                type: 'stringSet', values: chars,
            }));
        }
    }

    if (params.tag) {
        const tags = params.tag.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
        if (tags.length > 0) {
            conditions.push(condition('tag', 'includes', {
                type: 'stringSet', values: tags,
            }));
        }
    }

    if (params.content) {
        conditions.push(condition('content', 'contains', {
            type: 'string', value: params.content,
        }));
    }

    if (params.date) {
        // date takes priority over from/to
        const dateValue = parseDatePreset(params.date);
        if (!dateValue) {
            return { ok: false, error: `Invalid date value for --date: ${params.date}. Use YYYY-MM-DD or a preset (today, thisWeek, pastWeek, nextWeek, thisMonth, thisYear, next7days)` };
        }
        conditions.push(condition('startDate', 'onOrBefore', {
            type: 'date', value: dateValue,
        }));
        conditions.push(condition('endDate', 'onOrAfter', {
            type: 'date', value: dateValue,
        }));
    } else {
        if (params.from) {
            const fromValue = parseDatePreset(params.from);
            if (!fromValue) {
                return { ok: false, error: `Invalid date value for --from: ${params.from}. Use YYYY-MM-DD or a preset (today, thisWeek, etc.)` };
            }
            conditions.push(condition('startDate', 'onOrAfter', {
                type: 'date', value: fromValue,
            }));
        }
        if (params.to) {
            const toValue = parseDatePreset(params.to);
            if (!toValue) {
                return { ok: false, error: `Invalid date value for --to: ${params.to}. Use YYYY-MM-DD or a preset (today, thisWeek, etc.)` };
            }
            conditions.push(condition('endDate', 'onOrBefore', {
                type: 'date', value: toValue,
            }));
        }
    }

    if (params.due) {
        const dueValue = parseDatePreset(params.due);
        if (!dueValue) {
            return { ok: false, error: `Invalid date value for --due: ${params.due}. Use YYYY-MM-DD or a preset (today, thisWeek, etc.)` };
        }
        conditions.push(condition('due', 'equals', {
            type: 'date', value: dueValue,
        }));
    }

    if (params.leaf === 'true') {
        conditions.push(condition('children', 'isNotSet', {
            type: 'boolean', value: true,
        }));
    }

    if (conditions.length === 0) return { ok: true, filter: null };

    const root: FilterGroupNode = {
        type: 'group',
        id: generateId('g'),
        children: conditions,
        logic: 'and',
    };

    return { ok: true, filter: { root } };
}

/**
 * Parse a date/datetime string into separate date and time components.
 * Accepts: "YYYY-MM-DD", "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm", "HH:mm"
 * Returns null if the input doesn't match any valid format.
 */
export function parseDateTimeFlag(value: string): { date: string; time?: string } | null {
    const trimmed = value.trim();
    // YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/);
    if (match) {
        return { date: match[1], time: match[2] };
    }
    // YYYY-MM-DD only
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { date: trimmed };
    }
    // HH:mm only (time-only)
    if (/^\d{2}:\d{2}$/.test(trimmed)) {
        return { date: '', time: trimmed };
    }
    return null;
}
