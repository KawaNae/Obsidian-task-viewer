import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../../src/views/registerAllSchemas';
import { loadFilterFile } from '../../../src/api/FilterFileLoader';
import { TaskApiError } from '../../../src/api/TaskApiTypes';
import { toCliName } from '../../../src/api/OperationSchemas';
import type { FilterState, FilterCondition } from '../../../src/services/filter/FilterTypes';
import type { App } from 'obsidian';
import type { ViewTemplate, PinnedListDefinition } from '../../../src/types';
import type { ListQuery } from '../../../src/services/filter/PinnedListQuery';

// ── Mock ViewTemplateLoader ──

const mockLoadFullTemplate = vi.fn<(path: string) => Promise<ViewTemplate | null>>();

vi.mock('../../../src/services/template/ViewTemplateLoader', () => {
    return {
        ViewTemplateLoader: class {
            loadFullTemplate = mockLoadFullTemplate;
        },
    };
});

// ── Helpers ──

function makeApp(files: Record<string, string>): App {
    return {
        vault: {
            adapter: {
                exists: vi.fn(async (path: string) => path in files),
                read: vi.fn(async (path: string) => files[path] ?? ''),
            },
        },
    } as unknown as App;
}

function makeFilterState(): FilterState {
    return {
        filters: [
            {
                property: 'tag',
                operator: 'includes',
                value: ['work'],
            } as FilterCondition,
        ],
        logic: 'and',
    };
}

function makePinnedList(name: string, applyViewFilter?: boolean): PinnedListDefinition {
    return {
        name,
        filterState: makeFilterState(),
        applyViewFilter,
    } as PinnedListDefinition;
}

/**
 * Build a ViewTemplate fixture. Pre-refactor tests passed `filterState`,
 * `pinnedLists`, `grid` as flat fields; post-refactor those live in
 * `template.config`. This helper packs flat-style overrides into `config`
 * automatically so existing test bodies keep working.
 */
function makeTemplate(filePath: string, overrides: {
    filterState?: FilterState;
    pinnedLists?: PinnedListDefinition[];
    grid?: PinnedListDefinition[][];
    name?: string;
} = {}): ViewTemplate {
    const config: Record<string, unknown> = {};
    if (overrides.filterState) config.filterState = overrides.filterState;
    if (overrides.pinnedLists) {
        config.pinnedLists = overrides.pinnedLists.map(pl => ({
            id: pl.id ?? `pl-${pl.name}`,
            name: pl.name,
            filterState: pl.filterState,
            applyViewFilter: pl.applyViewFilter,
        }));
    }
    if (overrides.grid) {
        config.grid = overrides.grid.map(row => row.map(pl => ({
            id: pl.id ?? `g-${pl.name}`,
            name: pl.name,
            filterState: pl.filterState,
            applyViewFilter: pl.applyViewFilter,
        })));
    }
    return {
        filePath,
        name: overrides.name ?? 'Test',
        // The template is read by its view's schema: the grid is Kanban's.
        viewType: overrides.grid ? 'kanban' : 'timeline',
        config,
    };
}

/** The query, or the error's text in the API's spelling. */
async function load(app: App, path: string, listName?: string): Promise<ListQuery | string> {
    const result = await loadFilterFile(app, path, listName);
    return result instanceof TaskApiError ? result.rawMessage : result;
}

/** The error about the list, as the API and the CLI each spell it. */
async function listError(app: App, path: string, listName?: string): Promise<{ param?: string; api: string; cli: string }> {
    const result = await loadFilterFile(app, path, listName);
    if (!(result instanceof TaskApiError)) throw new Error('expected an error');
    return { param: result.param, api: result.rawMessage, cli: result.textFor(toCliName) };
}

// ── Tests ──

describe('loadFilterFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── File not found ──

    it('returns error when file does not exist', async () => {
        const app = makeApp({});
        const result = await load(app, 'missing.json');
        expect(result).toBe('Filter file not found: missing.json');
    });

    // ── Unsupported extension ──

    it('returns error for unsupported file type', async () => {
        const app = makeApp({ 'filter.txt': '' });
        const result = await load(app, 'filter.txt');
        expect(result).toBe('Unsupported file type: filter.txt. Use .json or .md');
    });

    // ── Windows path normalization ──

    it('normalizes backslashes in file path', async () => {
        const app = makeApp({});
        const result = await load(app, 'filters\\test.json');
        expect(result).toBe('Filter file not found: filters/test.json');
    });

    // ── .json files ──

    describe('.json files', () => {
        it('loads valid FilterState JSON (v6 format)', async () => {
            const v6Json = {
                logic: 'and',
                filters: [
                    { property: 'tag', operator: 'includes', value: ['work'] },
                ],
            };
            const app = makeApp({ 'filters/test.json': JSON.stringify(v6Json) });
            const result = await load(app, 'filters/test.json');
            expect(typeof result).not.toBe('string');
            const state = (result as ListQuery).filter;
            expect(state.filters).toHaveLength(1);
            const c = state.filters[0] as FilterCondition;
            expect(c.value).toEqual(['work']);
        });

        it('returns error for invalid JSON', async () => {
            const app = makeApp({ 'filters/bad.json': '{not valid json' });
            const result = await load(app, 'filters/bad.json');
            expect(result).toBe('Invalid JSON in filter file: filters/bad.json');
        });

        it('returns error when a condition cannot be read', async () => {
            const app = makeApp({ 'filters/bad.json': '{"logic": "and", "filters": [{"property": "due", "operator": "after", "value": "tomorrow"}]}' });
            const result = await load(app, 'filters/bad.json');
            expect(result).toMatch(/^Invalid filter in filters\/bad\.json: filters\[0\]: 'due' takes a date that exists/);
        });

        it('returns error when no conditions found', async () => {
            const app = makeApp({ 'filters/empty.json': '{"logic": "and", "conditions": []}' });
            const result = await load(app, 'filters/empty.json');
            expect(typeof result).toBe('string');
            expect(result).toContain('no conditions found');
        });
    });

    // ── .md templates ──

    describe('.md templates', () => {
        it('returns error when template fails to load', async () => {
            const app = makeApp({ 'templates/bad.md': '' });
            mockLoadFullTemplate.mockResolvedValue(null);

            const result = await load(app, 'templates/bad.md');
            expect(result).toBe('Failed to load view template: templates/bad.md');
        });

        it('returns viewFilter when template has no pinned lists', async () => {
            const filterState = makeFilterState();
            const app = makeApp({ 'templates/simple.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate('templates/simple.md', { filterState }));

            const result = await load(app, 'templates/simple.md');
            expect(result).toEqual({ filter: filterState });
        });

        it('returns error when the template holds a condition it cannot read, as the API filter does', async () => {
            const bad = { filters: [{ property: 'tag', operator: 'includes', value: 'work' }], logic: 'and' } as unknown as FilterState;
            const app = makeApp({ 'templates/bad-cond.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate('templates/bad-cond.md', { grid: [[{ ...makePinnedList('A'), filterState: bad }]] }));

            const result = await load(app, 'templates/bad-cond.md', 'A');
            expect(result).toBe(`Invalid filter in templates/bad-cond.md: list "A" filters[0]: 'tag' takes a list of strings`);
        });

        it('returns error when template has no filter and no pinned lists', async () => {
            const app = makeApp({ 'templates/empty.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate('templates/empty.md'));

            const result = await load(app, 'templates/empty.md');
            expect(result).toBe('Template has no filter: templates/empty.md');
        });

        it('returns error when pinned lists exist but list name not specified', async () => {
            const app = makeApp({ 'templates/lists.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate('templates/lists.md', {
                pinnedLists: [makePinnedList('urgent'), makePinnedList('backlog')],
            }));

            expect(await listError(app, 'templates/lists.md')).toEqual({
                param: 'list',
                api: "Template has pinned lists. Name one with 'list': urgent, backlog",
                cli: "Template has pinned lists. Name one with 'list': urgent, backlog",
            });
        });

        it('returns pinned list filter when list name matches', async () => {
            const pinnedList = makePinnedList('urgent');
            const app = makeApp({ 'templates/lists.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate('templates/lists.md', {
                pinnedLists: [pinnedList, makePinnedList('backlog')],
            }));

            const result = await load(app, 'templates/lists.md', 'urgent');
            expect(result).toEqual({ filter: pinnedList.filterState });
        });

        it('returns error when list name does not match', async () => {
            const app = makeApp({ 'templates/lists.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate('templates/lists.md', {
                pinnedLists: [makePinnedList('urgent')],
            }));

            const error = await listError(app, 'templates/lists.md', 'missing');
            expect(error.param).toBe('list');
            expect(error.api).toBe('Pinned list "missing" not found. Available: urgent');
        });

        it('returns error when list specified but no pinned lists exist', async () => {
            const app = makeApp({ 'templates/simple.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate('templates/simple.md', {
                filterState: makeFilterState(),
            }));

            expect(await listError(app, 'templates/simple.md', 'anything')).toEqual({
                param: 'list',
                api: "No pinned lists in template: templates/simple.md. Leave out 'list'",
                cli: "No pinned lists in template: templates/simple.md. Leave out 'list'",
            });
        });

        it('merges viewFilter and pinnedList filter when applyViewFilter is true', async () => {
            const viewFilter = makeFilterState();
            const pinnedList = makePinnedList('urgent', true);
            const app = makeApp({ 'templates/merged.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate('templates/merged.md', {
                filterState: viewFilter,
                pinnedLists: [pinnedList],
            }));

            const result = await load(app, 'templates/merged.md', 'urgent');
            // An AND of the list's filter and the view's, as the view's own
            // pinned list shows it (PinnedListQuery.resolve).
            expect(typeof result).not.toBe('string');
            const merged = (result as ListQuery).filter;
            expect(merged.logic).toBe('and');
            expect(merged.filters).toHaveLength(2);
            expect(merged.filters[0]).toEqual(pinnedList.filterState);
            expect(merged.filters[1]).toEqual(viewFilter);
        });

        it('skips viewFilter merge when applyViewFilter is false', async () => {
            const viewFilter = makeFilterState();
            const pinnedList = makePinnedList('urgent', false);
            const app = makeApp({ 'templates/no-merge.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate('templates/no-merge.md', {
                filterState: viewFilter,
                pinnedLists: [pinnedList],
            }));

            const result = await load(app, 'templates/no-merge.md', 'urgent');
            expect(result).toEqual({ filter: pinnedList.filterState });
        });

        // The toggle's default lives in the codec: a list saved before the
        // toggle was touched has no key and reads as false. The view shows such
        // a list without the view filter; the CLI/API used to layer it in.
        it('a list saved without the key does not layer the view filter, as the view does', async () => {
            const pinnedList = makePinnedList('urgent');
            const app = makeApp({ 'templates/untouched.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate('templates/untouched.md', {
                filterState: makeFilterState(),
                pinnedLists: [pinnedList],
            }));

            const result = await load(app, 'templates/untouched.md', 'urgent');
            expect(result).toEqual({ filter: pinnedList.filterState });
        });

        // The template is read by its view's schema, as the view reads it: a
        // key its view does not keep is not read.
        it('reads the lists its view keeps, and no other key', async () => {
            const app = makeApp({ 'templates/timeline.md': '' });
            const template = makeTemplate('templates/timeline.md', { pinnedLists: [makePinnedList('kept')] });
            template.config!.grid = [[{ id: 'g', name: 'grid-cell', filterState: makeFilterState() }]];
            mockLoadFullTemplate.mockResolvedValue(template);

            expect(await load(app, 'templates/timeline.md', 'grid-cell'))
                .toBe('Pinned list "grid-cell" not found. Available: kept');
        });

        it('uses grid flat() when pinnedLists is undefined', async () => {
            const pinnedList = makePinnedList('col1');
            const app = makeApp({ 'templates/grid.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate('templates/grid.md', {
                grid: [[pinnedList]],
            }));

            const result = await load(app, 'templates/grid.md', 'col1');
            expect(result).toEqual({ filter: pinnedList.filterState });
        });
    });
});
