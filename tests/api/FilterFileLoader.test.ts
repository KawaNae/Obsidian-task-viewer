import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFilterFile, mergeFilters } from '../../src/api/FilterFileLoader';
import type { FilterState, FilterGroupNode, FilterConditionNode } from '../../src/services/filter/FilterTypes';
import type { App } from 'obsidian';
import type { ViewTemplate, PinnedListDefinition } from '../../src/types';

// ── Mock ViewTemplateLoader ──

const mockLoadFullTemplate = vi.fn<(path: string) => Promise<ViewTemplate | null>>();

vi.mock('../../src/services/template/ViewTemplateLoader', () => {
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

function makeFilterState(id = 'g1'): FilterState {
    return {
        root: {
            type: 'group',
            id,
            logic: 'and',
            children: [
                {
                    type: 'condition',
                    id: 'c1',
                    property: 'tag',
                    operator: 'includes',
                    value: { type: 'stringSet', values: ['work'] },
                } as FilterConditionNode,
            ],
        },
    };
}

function makePinnedList(name: string, applyViewFilter?: boolean): PinnedListDefinition {
    return {
        name,
        filterState: makeFilterState(`pinned-${name}`),
        applyViewFilter,
    } as PinnedListDefinition;
}

function makeTemplate(overrides: Partial<ViewTemplate> = {}): ViewTemplate {
    return {
        filePath: 'templates/test.md',
        name: 'Test',
        viewType: 'timeline',
        ...overrides,
    };
}

// ── Tests ──

describe('mergeFilters', () => {
    it('combines two FilterStates under an AND group', () => {
        const a = makeFilterState('a');
        const b = makeFilterState('b');
        const merged = mergeFilters(a, b);

        expect(merged.root.type).toBe('group');
        expect(merged.root.logic).toBe('and');
        expect(merged.root.children).toHaveLength(2);
        expect(merged.root.children[0]).toBe(a.root);
        expect(merged.root.children[1]).toBe(b.root);
    });
});

describe('loadFilterFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── File not found ──

    it('returns error when file does not exist', async () => {
        const app = makeApp({});
        const result = await loadFilterFile(app, 'missing.json');
        expect(result).toBe('Filter file not found: missing.json');
    });

    // ── Unsupported extension ──

    it('returns error for unsupported file type', async () => {
        const app = makeApp({ 'filter.txt': '' });
        const result = await loadFilterFile(app, 'filter.txt');
        expect(result).toBe('Unsupported file type: filter.txt. Use .json or .md');
    });

    // ── Windows path normalization ──

    it('normalizes backslashes in file path', async () => {
        const app = makeApp({});
        const result = await loadFilterFile(app, 'filters\\test.json');
        expect(result).toBe('Filter file not found: filters/test.json');
    });

    // ── .json files ──

    describe('.json files', () => {
        it('loads valid FilterState JSON', async () => {
            const filterState = makeFilterState();
            const app = makeApp({ 'filters/test.json': JSON.stringify(filterState) });
            const result = await loadFilterFile(app, 'filters/test.json');
            expect(result).toEqual(filterState);
        });

        it('returns error for invalid JSON', async () => {
            const app = makeApp({ 'filters/bad.json': '{not valid json' });
            const result = await loadFilterFile(app, 'filters/bad.json');
            expect(result).toBe('Invalid JSON in filter file: filters/bad.json');
        });

        it('returns error when root key is missing', async () => {
            const app = makeApp({ 'filters/no-root.json': '{"children": []}' });
            const result = await loadFilterFile(app, 'filters/no-root.json');
            expect(result).toBe('Invalid FilterState in filters/no-root.json: missing "root" group');
        });
    });

    // ── .md templates ──

    describe('.md templates', () => {
        it('returns error when template fails to load', async () => {
            const app = makeApp({ 'templates/bad.md': '' });
            mockLoadFullTemplate.mockResolvedValue(null);

            const result = await loadFilterFile(app, 'templates/bad.md');
            expect(result).toBe('Failed to load view template: templates/bad.md');
        });

        it('returns viewFilter when template has no pinned lists', async () => {
            const filterState = makeFilterState();
            const app = makeApp({ 'templates/simple.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate({ filterState }));

            const result = await loadFilterFile(app, 'templates/simple.md');
            expect(result).toEqual(filterState);
        });

        it('returns error when template has no filter and no pinned lists', async () => {
            const app = makeApp({ 'templates/empty.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate());

            const result = await loadFilterFile(app, 'templates/empty.md');
            expect(result).toBe('Template has no filter: templates/empty.md');
        });

        it('returns error when pinned lists exist but list name not specified', async () => {
            const app = makeApp({ 'templates/lists.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate({
                pinnedLists: [makePinnedList('urgent'), makePinnedList('backlog')],
            }));

            const result = await loadFilterFile(app, 'templates/lists.md');
            expect(result).toBe('Template has pinned lists. Specify one with list=<name>: urgent, backlog');
        });

        it('returns pinned list filter when list name matches', async () => {
            const pinnedList = makePinnedList('urgent');
            const app = makeApp({ 'templates/lists.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate({
                pinnedLists: [pinnedList, makePinnedList('backlog')],
            }));

            const result = await loadFilterFile(app, 'templates/lists.md', 'urgent');
            expect(result).toEqual(pinnedList.filterState);
        });

        it('returns error when list name does not match', async () => {
            const app = makeApp({ 'templates/lists.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate({
                pinnedLists: [makePinnedList('urgent')],
            }));

            const result = await loadFilterFile(app, 'templates/lists.md', 'missing');
            expect(result).toBe('Pinned list "missing" not found. Available: urgent');
        });

        it('returns error when list specified but no pinned lists exist', async () => {
            const app = makeApp({ 'templates/simple.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate({
                filterState: makeFilterState(),
            }));

            const result = await loadFilterFile(app, 'templates/simple.md', 'anything');
            expect(result).toBe('No pinned lists in template. Remove --list flag');
        });

        it('merges viewFilter and pinnedList filter when applyViewFilter is true', async () => {
            const viewFilter = makeFilterState('view');
            const pinnedList = makePinnedList('urgent', true);
            const app = makeApp({ 'templates/merged.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate({
                filterState: viewFilter,
                pinnedLists: [pinnedList],
            }));

            const result = await loadFilterFile(app, 'templates/merged.md', 'urgent');
            // Should be a merged AND group
            expect(typeof result).not.toBe('string');
            const merged = result as FilterState;
            expect(merged.root.logic).toBe('and');
            expect(merged.root.children).toHaveLength(2);
            expect(merged.root.children[0]).toBe(viewFilter.root);
            expect(merged.root.children[1]).toBe(pinnedList.filterState.root);
        });

        it('skips viewFilter merge when applyViewFilter is false', async () => {
            const viewFilter = makeFilterState('view');
            const pinnedList = makePinnedList('urgent', false);
            const app = makeApp({ 'templates/no-merge.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate({
                filterState: viewFilter,
                pinnedLists: [pinnedList],
            }));

            const result = await loadFilterFile(app, 'templates/no-merge.md', 'urgent');
            expect(result).toEqual(pinnedList.filterState);
        });

        it('uses grid flat() when pinnedLists is undefined', async () => {
            const pinnedList = makePinnedList('col1');
            const app = makeApp({ 'templates/grid.md': '' });
            mockLoadFullTemplate.mockResolvedValue(makeTemplate({
                grid: [[pinnedList]],
            }));

            const result = await loadFilterFile(app, 'templates/grid.md', 'col1');
            expect(result).toEqual(pinnedList.filterState);
        });
    });
});
