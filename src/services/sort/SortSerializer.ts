import type { SortState, SortRule, SortDirection } from './SortTypes';
import { SORT_PROPERTIES } from './SortTypes';

/**
 * A rule of a saved sort that could not be read and was dropped: which one
 * (`rules[1]`, or `sort` for the whole) and why, in English.
 */
export interface SortIssue {
    readonly at: string;
    readonly reason: string;
}

export interface SortRead {
    readonly state: SortState;
    readonly issues: readonly SortIssue[];
}

/** One issue as a sentence. */
export function sortIssueText(issue: SortIssue): string {
    return `${issue.at}: ${issue.reason}`;
}

const DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

/**
 * The one reader of a saved or handed-in sort (a pinned list's `sortState`,
 * the API's `sort`), and its writer. A rule names a known property and a
 * direction (`asc` when none is given); any other rule is dropped into
 * `issues`. An `id` a rule was saved with is not read.
 */
export class SortSerializer {
    static parse(raw: unknown): SortRead {
        const issues: SortIssue[] = [];
        const rules: SortRule[] = [];
        const rawRules = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).rules : undefined;
        if (!Array.isArray(rawRules)) {
            issues.push({ at: 'sort', reason: 'not a sort ({ rules })' });
            return { state: { rules }, issues };
        }
        rawRules.forEach((r, i) => {
            const read = readRule(r);
            if (typeof read === 'string') issues.push({ at: `rules[${i}]`, reason: read });
            else rules.push(read);
        });
        return { state: { rules }, issues };
    }

    static toJSON(state: SortState): Record<string, unknown> {
        return { rules: state.rules.map(r => ({ property: r.property, direction: r.direction })) };
    }
}

function readRule(raw: unknown): SortRule | string {
    if (!raw || typeof raw !== 'object') return 'not a sort rule ({ property, direction })';
    const r = raw as Record<string, unknown>;
    const property = SORT_PROPERTIES.find(p => p === r.property);
    if (!property) return `Unknown sort property: ${String(r.property)}. Available: ${SORT_PROPERTIES.join(', ')}`;
    if (r.direction === undefined) return { property, direction: 'asc' };
    const direction = DIRECTIONS.find(d => d === r.direction);
    if (!direction) return `Invalid sort direction: ${String(r.direction)}. Use asc or desc`;
    return { property, direction };
}
