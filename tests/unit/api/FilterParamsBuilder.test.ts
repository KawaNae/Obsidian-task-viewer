import { describe, it, expect } from 'vitest';
import { filterOfParams } from '../../../src/api/FilterParamsBuilder';
import type { FilterCondition } from '../../../src/services/filter/FilterTypes';
import { isFilterCondition } from '../../../src/services/filter/FilterTypes';
import type { ListParams } from '../../../src/api/TaskApiTypes';

/** The filter `list` makes of its params: its simple fields and its own query window. */
function listFilter(params: ListParams) {
    return filterOfParams(params, params);
}

/** Extract condition nodes from the built FilterState */
function getConditions(params: ListParams): FilterCondition[] {
    const state = listFilter(params);
    if (!state) return [];
    return state.filters.filter(
        (c): c is FilterCondition => isFilterCondition(c),
    );
}

function findCondition(conditions: FilterCondition[], property: string): FilterCondition | undefined {
    return conditions.find(c => c.property === property);
}

describe('listFilter', () => {
    it('returns null when no params are provided', () => {
        expect(listFilter({})).toBeNull();
    });

    it('returns filter JSON directly when params.filter is set', () => {
        const filter = {
            filters: [],
            logic: 'or' as const,
        };
        expect(listFilter({ filter })).toEqual(filter);
    });

    // ── file ──
    it('file → file includes', () => {
        const conditions = getConditions({ file: 'daily.md' });
        const c = findCondition(conditions, 'file');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('includes');
        expect(c!.value).toEqual(['daily.md']);
    });

    it('file auto-appends .md', () => {
        const conditions = getConditions({ file: 'daily' });
        const c = findCondition(conditions, 'file');
        expect(c!.value).toEqual(['daily.md']);
    });

    // ── status ──
    it('status → status includes', () => {
        const conditions = getConditions({ status: 'x,-' });
        const c = findCondition(conditions, 'status');
        expect(c).toBeDefined();
        expect(c!.value).toEqual(['x', '-']);
    });

    // ── tag ──
    it('tag → tag includes (strips #)', () => {
        const conditions = getConditions({ tag: '#work,reading' });
        const c = findCondition(conditions, 'tag');
        expect(c).toBeDefined();
        expect(c!.value).toEqual(['work', 'reading']);
    });

    // ── content ──
    it('content → content contains', () => {
        const conditions = getConditions({ content: '会議' });
        const c = findCondition(conditions, 'content');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('contains');
        expect(c!.value).toBe('会議');
    });

    // ── date（単日窓の糖衣） ──
    it('date → startDate onOrBefore + endDate onOrAfter', () => {
        const conditions = getConditions({ date: '2026-03-15' });
        const start = findCondition(conditions, 'startDate');
        const end = findCondition(conditions, 'endDate');
        expect(start).toBeDefined();
        expect(start!.operator).toBe('onOrBefore');
        expect(end).toBeDefined();
        expect(end!.operator).toBe('onOrAfter');
    });

    it('date=X ≡ from=X to=X（糖衣として同一条件を生成）', () => {
        expect(getConditions({ date: '2026-03-15' }))
            .toEqual(getConditions({ from: '2026-03-15', to: '2026-03-15' }));
        expect(getConditions({ date: 'thisweek' }))
            .toEqual(getConditions({ from: 'thisweek', to: 'thisweek' }));
    });

    it('date + from throws error', () => {
        expect(() => listFilter({ date: '2026-03-15', from: '2026-03-01' }))
            .toThrow(/Cannot use 'date' together with 'from'/);
    });

    it('date + to throws error', () => {
        expect(() => listFilter({ date: '2026-03-15', to: '2026-03-31' }))
            .toThrow(/Cannot use 'date' together with 'from'/);
    });

    it('invalid date throws error', () => {
        expect(() => listFilter({ date: 'invalid' }))
            .toThrow(/Invalid date value for date: invalid\. Use YYYY-MM-DD or a preset \(today, /);
    });

    // Stage 7, input decision B: a date-shaped value naming no day was read
    // by shape and handed to the filter; it is refused.
    it.each([
        [{ date: '2026-02-30' }, /date must be a day that exists, got: "2026-02-30"/],
        [{ from: '2026-13-45' }, /from must be a day that exists/],
        [{ to: '2026-04-31' }, /to must be a day that exists/],
        [{ due: '2025-02-29' }, /due must be a day that exists/],
    ])('refuses %j, which names no day', (params, message) => {
        expect(() => listFilter(params)).toThrow(message);
    });

    it('names the presets when due is neither a date nor a preset', () => {
        expect(() => listFilter({ due: 'soon' }))
            .toThrow(/Invalid date value for due: soon\. Use YYYY-MM-DD or a preset \(today, /);
    });

    it('reads a full-width date', () => {
        const c = findCondition(getConditions({ due: '２０２６－０３－１５' }), 'due');
        expect(c?.value).toBe('2026-03-15');
    });

    // ── from / to（inclusive overlap 窓） ──
    it('from → endDate onOrAfter（窓開始より前に終わるタスクを除外）', () => {
        const conditions = getConditions({ from: '2026-03-01' });
        expect(conditions).toHaveLength(1);
        const c = findCondition(conditions, 'endDate');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('onOrAfter');
        expect(c!.value).toBe('2026-03-01');
    });

    it('to → startDate onOrBefore（窓終了より後に始まるタスクを除外）', () => {
        const conditions = getConditions({ to: '2026-03-31' });
        expect(conditions).toHaveLength(1);
        const c = findCondition(conditions, 'startDate');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('onOrBefore');
        expect(c!.value).toBe('2026-03-31');
    });

    // ── due ──
    it('due → due equals', () => {
        const conditions = getConditions({ due: '2026-03-20' });
        const c = findCondition(conditions, 'due');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('equals');
    });

    // ── leaf ──
    it('leaf → children isNotSet', () => {
        const conditions = getConditions({ leaf: true });
        const c = findCondition(conditions, 'children');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('isNotSet');
    });

    // ── property ──
    it('property → property contains with key', () => {
        const conditions = getConditions({ property: '優先度:高' });
        const c = findCondition(conditions, 'property');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('contains');
        expect(c!.value).toBe('高');
        expect(c!.key).toBe('優先度');
    });

    it('invalid property format throws error', () => {
        expect(() => listFilter({ property: 'noColonHere' }))
            .toThrow(/Invalid property filter format/);
    });

    // ── color ──
    it('color → color includes', () => {
        const conditions = getConditions({ color: 'red,blue' });
        const c = findCondition(conditions, 'color');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('includes');
        expect(c!.value).toEqual(['red', 'blue']);
    });

    it('color as array', () => {
        const conditions = getConditions({ color: ['green'] });
        const c = findCondition(conditions, 'color');
        expect(c!.value).toEqual(['green']);
    });

    // ── type (maps to notation filter) ──
    it('type → notation includes', () => {
        const conditions = getConditions({ type: 'taskviewer' });
        const c = findCondition(conditions, 'notation');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('includes');
        expect(c!.value).toEqual(['taskviewer']);
    });

    it('type with multiple values', () => {
        const conditions = getConditions({ type: 'taskviewer,tasks' });
        const c = findCondition(conditions, 'notation');
        expect(c!.value).toEqual(['taskviewer', 'tasks']);
    });

    // ── root ──
    it('root → parent isNotSet', () => {
        const conditions = getConditions({ root: true });
        const c = findCondition(conditions, 'parent');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('isNotSet');
    });

    // ── combined filters ──
    it('multiple flags produce AND group', () => {
        const state = listFilter({ file: 'test.md', tag: 'work', leaf: true });
        expect(state).not.toBeNull();
        expect(state!.logic).toBe('and');
        expect(state!.filters).toHaveLength(3);
    });

    it('filter JSON overrides all simple flags', () => {
        const filter = {
            filters: [],
            logic: 'or' as const,
        };
        const result = listFilter({ file: 'test.md', tag: 'work', filter });
        expect(result).toEqual(filter);
    });
});

// ── overlap 窓の実挙動（TaskFilterEngine を通した検証） ──

import { evaluateFilter } from '../helpers/filterContext';
import type { DisplayTask } from '../../../src/types';
import type { FilterState } from '../../../src/services/filter/FilterTypes';

function displayTask(id: string, effectiveStartDate: string, effectiveEndDate?: string): DisplayTask {
    return {
        id, file: 'test.md', line: 0, content: id, statusChar: ' ', indent: 0,
        childIds: [], childLines: [], tags: [], originalText: `- [ ] ${id}`,
        parserId: 'tv-inline',
        effectiveStartDate, effectiveEndDate,
        startDateImplicit: false, startTimeImplicit: true,
        endDateImplicit: false, endTimeImplicit: true,
        originalTaskId: id, isSplit: false, childEntries: [],
    };
}

function matches(params: ListParams, dt: DisplayTask): boolean {
    const state = listFilter(params);
    if (!state) return true;
    return evaluateFilter(dt, state);
}

describe('from/to overlap 窓の実挙動', () => {
    const crossing = displayTask('crossing', '2026-02-10', '2026-02-20');
    const before = displayTask('before', '2026-02-01', '2026-02-05');
    const after = displayTask('after', '2026-03-01', '2026-03-05');
    const noDates = displayTask('no-dates', '');

    it('窓を跨ぐタスクは from 単独で入る（旧 startDate>=v では落ちていたケース）', () => {
        expect(matches({ from: '2026-02-15' }, crossing)).toBe(true);
    });

    it('窓より前に終わったタスクは from で除外される', () => {
        expect(matches({ from: '2026-02-15' }, before)).toBe(false);
    });

    it('窓より後に始まるタスクは to で除外される', () => {
        expect(matches({ to: '2026-02-25' }, after)).toBe(false);
        expect(matches({ to: '2026-02-25' }, crossing)).toBe(true);
    });

    it('from+to 併用は窓と重なるタスクだけを通す', () => {
        const window = { from: '2026-02-12', to: '2026-02-14' };
        expect(matches(window, crossing)).toBe(true);
        expect(matches(window, before)).toBe(false);
        expect(matches(window, after)).toBe(false);
    });

    it('日付なしタスクは窓に入らない', () => {
        expect(matches({ from: '2026-02-01', to: '2026-12-31' }, noDates)).toBe(false);
    });

    it('date=X は from=X to=X と同じタスク集合を通す', () => {
        for (const dt of [crossing, before, after, noDates]) {
            expect(matches({ date: '2026-02-15' }, dt))
                .toBe(matches({ from: '2026-02-15', to: '2026-02-15' }, dt));
        }
    });
});

describe('params.filter の境界（FilterSerializer.parse の issues を例外にする）', () => {
    it('未知 property を拒否する', () => {
        const state = { filters: [{ property: 'statuss', operator: 'includes' }], logic: 'and' } as unknown as FilterState;
        expect(() => listFilter({ filter: state })).toThrow(/filters\[0\]: Unknown filter property: statuss/);
    });

    it('property に対して不正な operator を拒否する', () => {
        const state = { filters: [{ property: 'status', operator: 'onOrAfter' }], logic: 'and' } as unknown as FilterState;
        expect(() => listFilter({ filter: state })).toThrow(/Invalid operator 'onOrAfter' for filter property 'status'/);
    });

    it('値の形の誤りを拒否する（集合に文字列、日付に実在しない日）', () => {
        const state = { filters: [
            { property: 'tag', operator: 'includes', value: 'work' },
            { logic: 'or', filters: [{ property: 'due', operator: 'equals', value: '2026-02-30' }] },
        ], logic: 'and' } as unknown as FilterState;
        expect(() => listFilter({ filter: state })).toThrow(
            /Invalid filter: filters\[0\]: 'tag' takes a list of strings; filters\[1\]\.filters\[0\]: 'due' takes a date that exists/,
        );
    });

    it('正しい FilterState は通過する', () => {
        const state: FilterState = { filters: [{ property: 'status', operator: 'includes', value: ['x'] }], logic: 'and' };
        expect(listFilter({ filter: state })).toEqual(state);
    });

    it('listFilter は params.filter を境界検証する', () => {
        const bad = { filters: [{ property: 'contentt', operator: 'contains', value: 'x' }], logic: 'and' } as unknown as FilterState;
        expect(() => listFilter({ filter: bad })).toThrow(/Unknown filter property/);
    });
});

// ── filterOfParams without a window (tasksForDateRange / categorizedTasksForDateRange) ──

describe('filterOfParams without a window (the date-range family)', () => {
    it('returns null when no simple fields are set', () => {
        expect(filterOfParams({})).toBeNull();
    });

    it('builds the same simple-field conditions as listFilter', () => {
        const rangeState = filterOfParams({ status: 'x,-', tag: 'work' });
        const listState = listFilter({ status: 'x,-', tag: 'work' });
        expect(rangeState).toEqual(listState);
    });

    it('params.filter overrides simple fields, same as list', () => {
        const filter = { filters: [], logic: 'or' as const };
        const result = filterOfParams({ status: 'x', filter });
        expect(result).toEqual(filter);
    });

    it(
        'never produces a startDate/endDate condition, even if a caller passes ' +
        'from/to on the object (no window is passed to read — ' +
        'pins the property tasksForDateRange/categorizedTasksForDateRange rely on ' +
        'to avoid double-applying a date judgment on top of their own window)',
        () => {
            // A range API method spreads its full params (which has its own
            // required from/to) into this call at runtime; TypeScript allows
            // excess properties on a variable, so this simulates that exact
            // shape rather than the narrower object literal the type allows.
            const withWindowFields = { status: 'x', from: '2026-03-01', to: '2026-03-31' } as unknown as Parameters<typeof filterOfParams>[0];
            const state = filterOfParams(withWindowFields);
            expect(state).not.toBeNull();
            const properties = state!.filters
                .filter((f): f is FilterCondition => isFilterCondition(f))
                .map(f => f.property);
            expect(properties).toEqual(['status']);
            expect(properties).not.toContain('startDate');
            expect(properties).not.toContain('endDate');
        },
    );
});

// ── resolveQuery (list and the date-range family) ──

import { resolveQuery } from '../../../src/api/FilterParamsBuilder';
import type { App } from 'obsidian';

describe('resolveQuery', () => {
    function appHolding(files: Record<string, string>): App {
        return {
            vault: {
                adapter: {
                    exists: async (p: string) => p in files,
                    read: async (p: string) => files[p],
                },
            },
        } as unknown as App;
    }

    it('refuses list without filterFile, the same for every query', async () => {
        await expect(resolveQuery(appHolding({}), { list: 'a' }))
            .rejects.toThrow("'list' requires 'filterFile'");
    });

    it('takes the filter file over filter and the simple fields, and checks it as it checks filter', async () => {
        const file = { filters: [{ property: 'status', operator: 'includes', value: ['x'] }], logic: 'and' };
        const app = appHolding({ 'f.json': JSON.stringify(file), 'bad.json': JSON.stringify({ filters: [{ property: 'nope', operator: 'equals' }], logic: 'and' }) });

        const query = await resolveQuery(app, { filterFile: 'f.json', tag: 'work', filter: { filters: [], logic: 'or' } }, { date: 'today' });
        expect(query.filter?.filters).toHaveLength(1);
        expect((query.filter!.filters[0] as FilterCondition).property).toBe('status');

        await expect(resolveQuery(app, { filterFile: 'bad.json' })).rejects.toThrow(/Unknown filter property/);
    });

    it('builds the simple fields with the window it is given, and no window without one', async () => {
        const app = appHolding({});
        const withWindow = await resolveQuery(app, { status: 'x' }, { date: '2026-03-01' });
        const without = await resolveQuery(app, { status: 'x' });
        expect(withWindow.filter?.filters).toHaveLength(3);
        expect(without.filter?.filters).toHaveLength(1);
    });

    // Point Q: a filter file is a saved query, answered as a view answers it.
    it('answers a filter file without the tasks with a validation error, and a query of the call\'s own with them', async () => {
        const file = { filters: [{ property: 'status', operator: 'includes', value: ['x'] }], logic: 'and' };
        const app = appHolding({ 'f.json': JSON.stringify(file) });
        expect((await resolveQuery(app, { filterFile: 'f.json' })).includeInvalid).toBe(false);
        expect((await resolveQuery(app, { status: 'x' })).includeInvalid).toBe(true);
        expect(await resolveQuery(app, {})).toEqual({ filter: null, includeInvalid: true });
    });
});
