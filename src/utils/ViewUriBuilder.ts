import type { FilterState } from '../services/filter/FilterTypes';
import { FilterSerializer } from '../services/filter/FilterSerializer';

/**
 * Builds obsidian://task-viewer URIs from view type and filter state.
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

    static build(viewType: string, filterState?: FilterState): string {
        const shortName = this.VIEW_SHORT_NAMES[viewType];
        if (!shortName) return '';

        let uri = `obsidian://task-viewer?view=${shortName}`;

        if (!filterState || filterState.conditions.length === 0) return uri;

        const shorthand = this.tryBuildShorthand(filterState);
        if (shorthand) {
            return `${uri}&${shorthand}`;
        }

        return `${uri}&filter=${FilterSerializer.toURIParam(filterState)}`;
    }

    /**
     * Converts filter state to shorthand params if all conditions are
     * simple includes with stringSet values on supported properties.
     */
    private static tryBuildShorthand(state: FilterState): string | null {
        // Shorthand only for AND logic with all includes operators
        if (state.logic !== 'and') return null;

        const parts: string[] = [];

        for (const condition of state.conditions) {
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
