import type { SortState, SortProperty, SortDirection } from '../services/sort/SortTypes';
import { TaskApiError } from '../api/TaskApiTypes';

const VALID_PROPERTIES: Set<string> = new Set<string>([
    'content', 'due', 'startDate', 'endDate', 'file', 'status', 'tag',
]);

/**
 * Parse a sort flag string into a SortState.
 * Format: "prop[:dir],prop[:dir]" — e.g., "startDate:asc", "due:desc,file:asc"
 * Direction defaults to 'asc' if omitted.
 * Throws TaskApiError for unknown sort properties.
 */
export function buildSortFromFlag(sortFlag: string): SortState {
    const rules = sortFlag.split(',')
        .map(segment => segment.trim())
        .filter(Boolean)
        .map(segment => {
            const [prop, dir] = segment.split(':');
            if (!VALID_PROPERTIES.has(prop)) {
                throw new TaskApiError(
                    `Unknown sort property: ${prop}. Available: ${[...VALID_PROPERTIES].join(', ')}`,
                );
            }
            const direction: SortDirection = dir === 'desc' ? 'desc' : 'asc';
            return {
                id: `s-cli-${Math.random().toString(36).slice(2, 7)}`,
                property: prop as SortProperty,
                direction,
            };
        });

    return { rules };
}
