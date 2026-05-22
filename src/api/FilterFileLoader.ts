import type { App } from 'obsidian';
import type { FilterState } from '../services/filter/FilterTypes';
import { hasConditions } from '../services/filter/FilterTypes';
import { FilterSerializer } from '../services/filter/FilterSerializer';
import { ViewTemplateLoader } from '../services/template/ViewTemplateLoader';
import type { PinnedListDefinition } from '../types';
import { F } from '../services/viewConfig/FieldCodecs';

/**
 * Merge two FilterStates by combining them under a new AND group.
 */
export function mergeFilters(a: FilterState, b: FilterState): FilterState {
    return { filters: [a, b], logic: 'and' };
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

        // Parse fields uniformly via the schema's per-type codec — same path
        // every view uses, so old (flat) and new (config-key) template files
        // both round-trip through legacyKeys.
        const cfg = template.config ?? {};
        const filterCodec = F.filter('filterState', { legacyKeys: ['filter'] });
        const pinnedCodec = F.pinnedLists('pinnedLists');
        const gridCodec = F.grid('grid');

        const filterState = filterCodec.parse(cfg.filterState ?? cfg.filter);
        const pinnedLists: PinnedListDefinition[] =
            pinnedCodec.parse(cfg.pinnedLists)
            ?? gridCodec.parse(cfg.grid)?.flat()
            ?? [];

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
            if (list.applyViewFilter !== false && filterState && hasConditions(filterState)) {
                return mergeFilters(filterState, list.filterState);
            }
            return list.filterState;
        }

        // No list specified
        if (pinnedLists.length > 0) {
            const names = pinnedLists.map(l => l.name);
            return `Template has pinned lists. Specify one with list=<name>: ${names.join(', ')}`;
        }

        if (filterState && hasConditions(filterState)) {
            return filterState;
        }

        return `Template has no filter: ${normalizedPath}`;
    }

    return `Unsupported file type: ${normalizedPath}. Use .json or .md`;
}
