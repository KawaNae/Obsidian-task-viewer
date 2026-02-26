import type { FilterState, FilterConditionNode } from '../services/filter/FilterTypes';
import { hasConditions } from '../services/filter/FilterTypes';
import { FilterSerializer } from '../services/filter/FilterSerializer';

export interface ViewUriOptions {
    filterState?: FilterState;
    days?: number;
    zoom?: number;
    date?: string;
}

/**
 * Builds obsidian://task-viewer URIs from view type and optional parameters.
 * Prefers shorthand params (?tag=a,b) when possible, falls back to base64.
 */
export class ViewUriBuilder {
    private static readonly VIEW_SHORT_NAMES: Record<string, string> = {
        'timeline-view': 'timeline',
        'schedule-view': 'schedule',
        'calendar-view': 'calendar',
        'mini-calendar-view': 'mini-calendar',
    };

    /** Property names that support shorthand URI params. */
    private static readonly SHORTHAND_PROPERTIES = new Set(['file', 'tag', 'status']);

    static build(viewType: string, options?: FilterState | ViewUriOptions): string {
        const shortName = this.VIEW_SHORT_NAMES[viewType];
        if (!shortName) return '';

        // Normalize: FilterState direct pass (backward compat) or ViewUriOptions
        let opts: ViewUriOptions;
        if (options && 'root' in options) {
            opts = { filterState: options as FilterState };
        } else {
            opts = (options as ViewUriOptions) ?? {};
        }

        let uri = `obsidian://task-viewer?view=${shortName}`;

        // View-specific params
        if (opts.days != null) uri += `&days=${opts.days}`;
        if (opts.zoom != null) uri += `&zoom=${opts.zoom}`;
        if (opts.date != null) uri += `&date=${encodeURIComponent(opts.date)}`;

        // Filter params
        if (!opts.filterState || !hasConditions(opts.filterState)) return uri;

        const shorthand = this.tryBuildShorthand(opts.filterState);
        if (shorthand) return `${uri}&${shorthand}`;

        return `${uri}&filter=${FilterSerializer.toURIParam(opts.filterState)}`;
    }

    /**
     * Converts filter state to shorthand params if root has only condition children
     * with AND logic, all using includes operators on supported properties.
     */
    private static tryBuildShorthand(state: FilterState): string | null {
        const root = state.root;
        if (root.logic !== 'and') return null;
        // Shorthand only if root has only conditions (no sub-groups)
        if (root.children.some(c => c.type === 'group')) return null;

        const conditions = root.children as FilterConditionNode[];
        const parts: string[] = [];

        for (const condition of conditions) {
            if (condition.operator !== 'includes' || condition.value.type !== 'stringSet') {
                return null;
            }
            if (!this.SHORTHAND_PROPERTIES.has(condition.property)) {
                return null;
            }
            if (condition.value.values.length === 0) continue;
            parts.push(`${condition.property}=${condition.value.values.map(encodeURIComponent).join(',')}`);
        }

        return parts.length > 0 ? parts.join('&') : null;
    }
}
