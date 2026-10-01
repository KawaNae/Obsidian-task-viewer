import { describe, it, expect, afterEach, vi } from 'vitest';
import '../../../src/views/registerAllSchemas';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskReadService } from '../../../src/services/data/TaskReadService';
import { PinnedListQuery } from '../../../src/services/filter/PinnedListQuery';
import { createEmptyFilterState, type FilterState } from '../../../src/services/filter/FilterTypes';
import { codecFor, resolveViewTypeFromShortName } from '../../../src/services/viewConfig';
import type { PinnedListDefinition, ViewTemplate } from '../../../src/types';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';

/**
 * A pinned list of a view template shows the same tasks in its view as the
 * API and the CLI list for it (`list filterFile=… list=…`): both ask
 * `PinnedListQuery`. Checked for a list with the view filter applied and
 * without, a template with a view filter and without, and Kanban's grid.
 *
 * Not compared, until point Q is decided: the order (the API's is `sort`'s,
 * not the list's), and the tasks with a validation error, which a view
 * leaves out and the API lists — pinned below as the behavior today.
 */

const templates = new Map<string, ViewTemplate>();

vi.mock('../../../src/services/template/ViewTemplateLoader', () => ({
    ViewTemplateLoader: class {
        loadFullTemplate = async (path: string) => templates.get(path) ?? null;
    },
}));

let live: VaultSession | null = null;

afterEach(() => {
    live?.dispose();
    live = null;
    templates.clear();
});

const NOTES = {
    'work.md': [
        '- [ ] Report #work @2026-10-01',
        '- [ ] Release #work #urgent',
        '    - [ ] Notes #urgent',
        '- [ ] Garden #home #urgent',
        '- [ ] Broken #work #urgent @2026-10-05>2026-10-01',
        '',
    ],
};

const tagIs = (tag: string): FilterState => ({ filters: [{ property: 'tag', operator: 'includes', value: [tag] }], logic: 'and' });
const topLevel: FilterState = { filters: [{ property: 'parent', operator: 'isNotSet' }], logic: 'and' };

function list(name: string, filterState: FilterState, applyViewFilter: boolean): PinnedListDefinition {
    return { id: `pl-${name}`, name, filterState, applyViewFilter };
}

const LISTS = [
    list('urgent-in-view', tagIs('urgent'), true),
    list('urgent-alone', tagIs('urgent'), false),
    list('top-in-view', topLevel, true),
    list('everything-in-view', createEmptyFilterState(), true),
];

async function open() {
    const { session } = await openLiveVault(NOTES, s => { live = s; });
    const read = new TaskReadService(session.index, () => ({ startHour: 0, weekStartDay: 1 }));
    const app = Object.assign(session.app, {
        vault: Object.assign(session.app.vault, {
            adapter: { exists: async (path: string) => templates.has(path), read: async () => '' },
        }),
    });
    const api = new TaskApi({
        app,
        settings: { startHour: 0, weekStartDay: 1 },
        getTaskReadService: () => read,
        getIndex: () => session.index,
        getOperations: () => session.ops,
    } as never);
    return { read, api };
}

/** The template a view saves: its config through its own codec. */
function saveTemplate(path: string, viewType: string, config: Record<string, unknown>): void {
    const codec = codecFor(resolveViewTypeFromShortName(viewType)!)!;
    templates.set(path, { filePath: path, name: path, viewType, config: codec.serializeConfig(config) });
}

/**
 * The ids a view shows for the list called `name` of the template at
 * `path`: the view reads the template through its codec, holds its view
 * filter in its filter menu (empty when the template has none), and draws
 * the list from `PinnedListQuery.resolve`, as `PinnedListRenderer` and
 * Kanban's cells do.
 */
function shownByView(read: TaskReadService, path: string, name: string): string[] {
    const template = templates.get(path)!;
    const config = codecFor(resolveViewTypeFromShortName(template.viewType)!)!.parseConfig(template.config) as {
        filterState?: FilterState;
        pinnedLists?: PinnedListDefinition[];
        grid?: PinnedListDefinition[][];
    };
    const lists = config.grid ? config.grid.flat() : (config.pinnedLists ?? []);
    const listDef = lists.find(l => l.name === name)!;
    const query = PinnedListQuery.resolve(listDef, config.filterState ?? createEmptyFilterState());
    return read.getFilteredTasks(query.filter, query.sort).map(t => t.id).sort();
}

async function listedByApi(api: TaskApi, path: string, name: string): Promise<string[]> {
    const { tasks } = await api.list({ filterFile: path, list: name });
    return tasks.map(t => t.id).sort();
}

/** The tasks with a validation error, which only the API lists. */
function invalidIds(read: TaskReadService): Set<string> {
    return new Set(read.getAllDisplayTasks().filter(t => t.validation?.severity === 'error').map(t => t.id));
}

const without = (ids: string[], drop: Set<string>) => ids.filter(id => !drop.has(id));

const CASES: { title: string; viewType: string; config: Record<string, unknown> }[] = [
    { title: 'Timeline, with a view filter', viewType: 'timeline', config: { filterState: tagIs('work'), pinnedLists: LISTS } },
    { title: 'Calendar, without a view filter', viewType: 'calendar', config: { pinnedLists: LISTS } },
    { title: 'Kanban\'s grid, with a view filter', viewType: 'kanban', config: { filterState: tagIs('work'), grid: [LISTS.slice(0, 2), LISTS.slice(2)] } },
];

describe('a pinned list shows the same tasks in its view as the API lists for it', () => {
    for (const { title, viewType, config } of CASES) {
        describe(title, () => {
            for (const { name } of LISTS) {
                it(name, async () => {
                    const { read, api } = await open();
                    saveTemplate('templates/t.md', viewType, config);

                    const shown = shownByView(read, 'templates/t.md', name);
                    const listed = await listedByApi(api, 'templates/t.md', name);
                    expect(without(listed, invalidIds(read))).toEqual(shown);
                });
            }
        });
    }

    it('the queries differ: with the view filter applied, a list shows fewer tasks than alone', async () => {
        const { read } = await open();
        saveTemplate('templates/t.md', 'timeline', { filterState: tagIs('work'), pinnedLists: LISTS });
        const inView = shownByView(read, 'templates/t.md', 'urgent-in-view');
        const alone = shownByView(read, 'templates/t.md', 'urgent-alone');
        expect(inView.length).toBeGreaterThan(0);
        expect(alone.length).toBeGreaterThan(inView.length);
    });

    // Today's behavior, until point Q is decided: the API lists a task with a
    // validation error, which a view leaves out of the list.
    it('the API lists a task with a validation error that the view leaves out', async () => {
        const { read, api } = await open();
        saveTemplate('templates/t.md', 'timeline', { filterState: tagIs('work'), pinnedLists: LISTS });

        const invalid = invalidIds(read);
        expect(invalid.size).toBe(1);
        const shown = shownByView(read, 'templates/t.md', 'urgent-in-view');
        const listed = await listedByApi(api, 'templates/t.md', 'urgent-in-view');
        expect(listed).toEqual([...shown, ...invalid].sort());
        expect(shown.some(id => invalid.has(id))).toBe(false);
    });
});
