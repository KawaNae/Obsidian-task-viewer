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
