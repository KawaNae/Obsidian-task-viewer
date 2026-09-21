/**
 * Shared ranking for suggest candidate lists: exact match first, then
 * prefix match, then plain substring match. Within a rank, the sort is
 * stable, so the caller's own array order survives — for a list like
 * `LINE_STYLES`, that order is meaningful (default first, then increasing
 * visual complexity) and not alphabetical, so this must not re-sort ties
 * by name.
 */

const RANK_EXACT = 0;
const RANK_PREFIX = 1;
const RANK_SUBSTRING = 2;
const RANK_NONE = 3;

/**
 * Rank a candidate against a query, both assumed already normalized
 * (lowercased) by the caller. `RANK_NONE` means the candidate does not
 * contain the query at all.
 */
export function rankMatch(candidate: string, query: string): number {
    if (candidate === query) return RANK_EXACT;
    if (candidate.startsWith(query)) return RANK_PREFIX;
    if (candidate.includes(query)) return RANK_SUBSTRING;
    return RANK_NONE;
}

/**
 * Sort candidates by match rank against `query`. Stable: ties (same rank)
 * keep their relative order from `items`. Callers should pre-filter out
 * non-matches (`rankMatch === RANK_NONE`) if they don't want them included.
 */
export function sortByMatchRank<T extends string>(items: readonly T[], query: string): T[] {
    return [...items].sort((a, b) => rankMatch(a, query) - rankMatch(b, query));
}
