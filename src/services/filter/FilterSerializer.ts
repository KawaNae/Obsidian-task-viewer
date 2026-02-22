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
        return { conditions, logic: 'and' };
    }

    /**
     * Encode filter state for URI query parameter (base64-encoded JSON).
     */
    static toURIParam(state: FilterState): string {
        if (state.conditions.length === 0) return '';
        const json = JSON.stringify(state.conditions);
        return btoa(json);
    }

    /**
     * Decode filter state from URI query parameter.
     */
    static fromURIParam(param: string): FilterState {
        if (!param) return { ...EMPTY_FILTER_STATE };
        try {
            const json = atob(param);
            const conditions = JSON.parse(json) as FilterCondition[];
            if (!Array.isArray(conditions)) return { ...EMPTY_FILTER_STATE };
            return { conditions, logic: 'and' };
        } catch {
            return { ...EMPTY_FILTER_STATE };
        }
    }
}
