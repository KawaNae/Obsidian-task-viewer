import type { FilterState, FilterConditionNode, FilterGroupNode } from '../services/filter/FilterTypes';
import type { CliData } from 'obsidian';

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
 * Build a FilterState from CLI flags (--file, --status, --tag, --date).
 * Returns null if no filter flags are present.
 */
export function buildFilterFromFlags(params: CliData): FilterState | null {
    const conditions: FilterConditionNode[] = [];

    if (params.file) {
        conditions.push(condition('file', 'includes', {
            type: 'stringSet', values: [params.file],
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
        const tags = params.tag.split(',').map(s => s.trim()).filter(Boolean);
        if (tags.length > 0) {
            conditions.push(condition('tag', 'includes', {
                type: 'stringSet', values: tags,
            }));
        }
    }

    if (params.date) {
        // Tasks active on this date: startDate <= date AND (endDate >= date OR endDate not set)
        conditions.push(condition('startDate', 'onOrBefore', {
            type: 'date', value: { mode: 'absolute', date: params.date },
        }));
        conditions.push(condition('endDate', 'onOrAfter', {
            type: 'date', value: { mode: 'absolute', date: params.date },
        }));
    }

    if (conditions.length === 0) return null;

    const root: FilterGroupNode = {
        type: 'group',
        id: generateId('g'),
        children: conditions,
        logic: 'and',
    };

    return { root };
}

/**
 * Parse a date/datetime string into separate date and time components.
 * Accepts: "YYYY-MM-DD", "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm"
 */
export function parseDateTimeFlag(value: string): { date: string; time?: string } {
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
    return { date: trimmed };
}
