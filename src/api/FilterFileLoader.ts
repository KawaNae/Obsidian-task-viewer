import type { App } from 'obsidian';
import type { FilterState, FilterGroupNode } from '../services/filter/FilterTypes';
import { hasConditions } from '../services/filter/FilterTypes';
import { FilterSerializer } from '../services/filter/FilterSerializer';
import { ViewTemplateLoader } from '../services/template/ViewTemplateLoader';

/**
 * Merge two FilterStates by combining their root groups under a new AND group.
 */
export function mergeFilters(a: FilterState, b: FilterState): FilterState {
    const root: FilterGroupNode = {
        type: 'group',
        logic: 'and',
        children: [a.root, b.root],
    };
    return { root };
}

/**
 * Load a FilterState from a filter file (.json or .md view template).
 * Returns the resolved FilterState, or an error string.
 */
export async function loadFilterFile(
    app: App,
    filePath: string,
    listName?: string,
): Promise<FilterState | string> {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const exists = await app.vault.adapter.exists(normalizedPath);
    if (!exists) return `Filter file not found: ${normalizedPath}`;

    if (normalizedPath.endsWith('.json')) {
        const raw = await app.vault.adapter.read(normalizedPath);
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch {
            return `Invalid JSON in filter file: ${normalizedPath}`;
        }
        const state = FilterSerializer.fromJSON(parsed);
        if (!hasConditions(state)) {
            return `Invalid FilterState in ${normalizedPath}: no conditions found`;
        }
        return state;
    }

    if (normalizedPath.endsWith('.md')) {
        const loader = new ViewTemplateLoader(app);
        const template = await loader.loadFullTemplate(normalizedPath);
        if (!template) return `Failed to load view template: ${normalizedPath}`;

        const pinnedLists = template.pinnedLists
            ?? (template.grid ? template.grid.flat() : []);

        // Determine which filter to use
        if (listName) {
            const list = pinnedLists.find(l => l.name === listName);
            if (!list) {
                const names = pinnedLists.map(l => l.name);
                return names.length > 0
                    ? `Pinned list "${listName}" not found. Available: ${names.join(', ')}`
                    : `No pinned lists in template. Remove --list flag`;
            }
            // Combine viewFilter + pinnedList filter if applyViewFilter !== false
            if (list.applyViewFilter !== false && template.filterState && hasConditions(template.filterState)) {
                return mergeFilters(template.filterState, list.filterState);
            }
            return list.filterState;
        }

        // No list specified
        if (pinnedLists.length > 0) {
            const names = pinnedLists.map(l => l.name);
            return `Template has pinned lists. Specify one with list=<name>: ${names.join(', ')}`;
        }

        if (template.filterState && hasConditions(template.filterState)) {
            return template.filterState;
        }

        return `Template has no filter: ${normalizedPath}`;
    }

    return `Unsupported file type: ${normalizedPath}. Use .json or .md`;
}
