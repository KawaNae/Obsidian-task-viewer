import type { FilterState, FilterCondition } from './FilterTypes';
import { EMPTY_FILTER_STATE } from './FilterTypes';

/**
 * Serialization utilities for FilterState (JSON persistence and URI encoding).
 */
export class FilterSerializer {
    static toJSON(state: FilterState): Record<string, unknown> {
        return {
            conditions: state.conditions,
            logic: state.logic,
        };
    }

    static fromJSON(raw: unknown): FilterState {
        if (!raw || typeof raw !== 'object') return { ...EMPTY_FILTER_STATE };
        const obj = raw as Record<string, unknown>;
        if (!Array.isArray(obj.conditions)) return { ...EMPTY_FILTER_STATE };
        const conditions: FilterCondition[] = (obj.conditions as unknown[])
            .filter((c): c is FilterCondition => c != null && typeof c === 'object' && 'property' in c && 'operator' in c && 'value' in c);
        const logic = obj.logic === 'or' ? 'or' as const : 'and' as const;
        return { conditions, logic };
    }

    /**
     * Encode filter state for URI query parameter (base64-encoded JSON).
     * New format includes logic field: { conditions: [...], logic: 'and'|'or' }
     */
    static toURIParam(state: FilterState): string {
        if (state.conditions.length === 0) return '';
        const json = JSON.stringify({ conditions: state.conditions, logic: state.logic });
        return btoa(json);
    }

    /**
     * Decode filter state from URI query parameter.
     * Handles both old format (conditions array) and new format ({conditions, logic}).
     */
    static fromURIParam(param: string): FilterState {
        if (!param) return { ...EMPTY_FILTER_STATE };
        try {
            const json = atob(param);
            const parsed = JSON.parse(json);

            // New format: { conditions: [...], logic: 'and'|'or' }
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.conditions)) {
                const conditions = (parsed.conditions as unknown[])
                    .filter((c): c is FilterCondition => c != null && typeof c === 'object' && 'property' in c && 'operator' in c && 'value' in c);
                const logic = parsed.logic === 'or' ? 'or' as const : 'and' as const;
                return { conditions, logic };
            }

            // Old format: conditions array directly
            if (Array.isArray(parsed)) {
                const conditions = (parsed as unknown[])
                    .filter((c): c is FilterCondition => c != null && typeof c === 'object' && 'property' in c && 'operator' in c && 'value' in c);
                return { conditions, logic: 'and' };
            }

            return { ...EMPTY_FILTER_STATE };
        } catch {
            return { ...EMPTY_FILTER_STATE };
        }
    }
}
