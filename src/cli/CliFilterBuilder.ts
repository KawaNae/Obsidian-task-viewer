import type { ApiSortRule } from '../api/TaskApiTypes';

/**
 * Parse the CLI `sort` flag ("prop[:dir],prop[:dir],...") into ApiSortRule[].
 * Values are passed through untouched — property and direction validation
 * happens in the API's buildSortState, so a typo like `descc` errors instead
 * of silently falling back to asc.
 */
export function parseSortFlag(sortFlag: string): ApiSortRule[] {
    return sortFlag.split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(segment => {
            const [prop, dir] = segment.split(':');
            const rule: ApiSortRule = { property: prop as ApiSortRule['property'] };
            if (dir !== undefined) rule.direction = dir as ApiSortRule['direction'];
            return rule;
        });
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
