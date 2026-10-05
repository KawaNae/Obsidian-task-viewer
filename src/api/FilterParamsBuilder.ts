import type { FilterState } from '../services/filter/FilterTypes';
import { FilterSerializer, filterIssueText } from '../services/filter/FilterSerializer';
import type { App } from 'obsidian';
import type { SortState } from '../services/sort/SortTypes';
import { TaskApiError } from './TaskApiTypes';
import type { SimpleFilterParams, FilterSourceParams, WindowParams } from './TaskApiTypes';
import { loadFilterFile } from './FilterFileLoader';
import { shorthandConditions } from './QueryShorthand';

/**
 * The `filter` param, read by the one reader of saved filters. A part it
 * cannot read is an error: the API does not run a query on less than it was
 * asked.
 */
function readExplicitFilter(filter: FilterState | Record<string, unknown>): FilterState {
    const { state, issues } = FilterSerializer.parse(filter);
    if (issues.length > 0) {
        throw new TaskApiError(`Invalid filter: ${issues.map(filterIssueText).join('; ')}`);
    }
    return state;
}

/**
 * What a query asks for, from all its params taken together: the tasks
 * `filter` passes (null: every task), in `sort`'s order when the call names
 * none, and whether the tasks with a validation error are among them.
 */
export interface ApiQuery {
    filter: FilterState | null;
    /** The saved query's order (a pinned list's): the caller's `sort` wins over it. */
    sort?: SortState;
    /**
     * A query of the call's own (`filter`, the shorthand) lists every task
     * the index holds; one with a saved query in it (a filter file) the
     * tasks its view would show, which leaves out the tasks with a
     * validation error.
     */
    includeInvalid: boolean;
}

/**
 * The query a call names: the filter file's (`list` picks one pinned list
 * out of a .md template), `filter`, and the shorthand's conditions
 * (`shorthandConditions`: the simple fields, `date`, `from` and `to`), all
 * taken together — a task answers when it passes every one. `list`,
 * `today` and the date-range family all resolve their query here.
 *
 * A filter file is a saved query, and is answered as the UI answers it
 * (stage 7, point Q): with the tasks a view shows, so not those with a
 * validation error, and in the pinned list's own order unless the call
 * names a `sort` — whatever else the call adds to it.
 */
export async function resolveQuery(
    app: App,
    params: SimpleFilterParams & FilterSourceParams & WindowParams,
): Promise<ApiQuery> {
    if (params.list && !params.filterFile) {
        throw new TaskApiError(n => `'${n('list')}' requires '${n('filterFile')}' (a .md view template)`, 'list');
    }
    // Every param is read, and so checked, whatever else is given.
    const shorthand = shorthandConditions(params);
    const explicit = params.filter ? readExplicitFilter(params.filter) : null;
    const loaded = params.filterFile ? await loadFilterFile(app, params.filterFile, params.list) : null;
    if (loaded instanceof TaskApiError) throw loaded;

    const sources = [loaded?.filter, explicit].filter((s): s is FilterState => !!s);
    const filter: FilterState | null = shorthand.length === 0 && sources.length <= 1
        ? sources[0] ?? null
        : { logic: 'and', filters: [...sources, ...shorthand] };
    if (!loaded) return { filter, includeInvalid: true };
    return loaded.sort
        ? { filter, sort: loaded.sort, includeInvalid: false }
        : { filter, includeInvalid: false };
}
