import type { FilterState } from './FilterTypes';
import { hasConditions } from './FilterTypes';
import type { SortState } from '../sort/SortTypes';
import type { PinnedListDefinition, ViewTemplate } from '../../types';
import type { ConfigIssue } from '../viewConfig/ViewConfigSchema';
import { codecFor, resolveViewTypeFromShortName, schemaFor } from '../viewConfig/SchemaRegistry';

/** What a pinned list asks for: the tasks `filter` passes, in `sort`'s order. */
export interface ListQuery {
    readonly filter: FilterState;
    readonly sort?: SortState;
}

/**
 * A template's query, or why it names none. A `listError` is about the list
 * asked for (or not asked for): its text names the parameter that names
 * the list by `listParam`, so the API and the CLI each spell it their way.
 */
export type TemplateQuery =
    | { readonly query: ListQuery }
    | { readonly error: string }
    | { readonly listError: (listParam: string) => string };

/**
 * The one answer to "which tasks does this pinned list show": the lists of
 * Calendar and Timeline and Kanban's cells (`TaskListSections`), and a filter
 * file the API and the CLI are handed (`FilterFileLoader`) all ask here.
 */
export class PinnedListQuery {
    /**
     * The query of `list`. With its `applyViewFilter` on, the view's filter
     * narrows the list's own too; off — and a list saved without the toggle
     * reads as off — the list stands alone.
     */
    static resolve(list: PinnedListDefinition, viewFilter: FilterState | undefined): ListQuery {
        const filter = list.applyViewFilter && viewFilter
            ? both(list.filterState, viewFilter)
            : list.filterState;
        return list.sortState ? { filter, sort: list.sortState } : { filter };
    }

    /**
     * The query a view template names: the list called `listName`, as its
     * view would show it, or with no name the view's own filter. A template
     * whose view holds lists needs the name. The template is read by its
     * view's schema, as the view reads it, and a part of it that cannot be
     * read is an error: a query does not run on less than it was asked.
     */
    static fromTemplate(template: ViewTemplate, listName?: string): TemplateQuery {
        const path = template.filePath;
        const viewType = resolveViewTypeFromShortName(template.viewType);
        const codec = viewType ? codecFor(viewType) : undefined;
        const schema = viewType ? schemaFor(viewType) : undefined;
        if (!codec || !schema) return { error: `Unknown view type '${template.viewType}' in template: ${path}` };

        const issues: ConfigIssue[] = [];
        const config = codec.parseConfig(template.config ?? {}, issues) as { filterState?: FilterState };
        if (issues.length > 0) {
            return { error: `Invalid filter in ${path}: ${issues.map(issue => issue.text).join('; ')}` };
        }
        const viewFilter = config.filterState;
        const lists = schema.listsOf?.(config) ?? [];

        if (listName) {
            const list = lists.find(l => l.name === listName);
            if (list) return { query: PinnedListQuery.resolve(list, viewFilter) };
            const names = lists.map(l => l.name);
            return {
                listError: names.length > 0
                    ? () => `Pinned list "${listName}" not found. Available: ${names.join(', ')}`
                    : param => `No pinned lists in template: ${path}. Leave out '${param}'`,
            };
        }

        if (lists.length > 0) {
            const names = lists.map(l => l.name).join(', ');
            return { listError: param => `Template has pinned lists. Name one with '${param}': ${names}` };
        }
        if (viewFilter && hasConditions(viewFilter)) return { query: { filter: viewFilter } };
        return { error: `Template has no filter: ${path}` };
    }
}

/** The tasks both filters pass; a filter with no condition is left out. */
function both(a: FilterState, b: FilterState): FilterState {
    if (!hasConditions(b)) return a;
    if (!hasConditions(a)) return b;
    return { filters: [a, b], logic: 'and' };
}
