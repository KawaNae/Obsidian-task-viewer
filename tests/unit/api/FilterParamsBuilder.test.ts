import { describe, it, expect } from 'vitest';
import { buildFilterFromParams } from '../../../src/api/FilterParamsBuilder';
import type { FilterCondition } from '../../../src/services/filter/FilterTypes';
import { isFilterCondition } from '../../../src/services/filter/FilterTypes';
import type { ListParams } from '../../../src/api/TaskApiTypes';

/** Extract condition nodes from the built FilterState */
function getConditions(params: ListParams): FilterCondition[] {
    const state = buildFilterFromParams(params);
    if (!state) return [];
    return state.filters.filter(
        (c): c is FilterCondition => isFilterCondition(c),
    );
}

function findCondition(conditions: FilterCondition[], property: string): FilterCondition | undefined {
    return conditions.find(c => c.property === property);
}

describe('buildFilterFromParams', () => {
    it('returns null when no params are provided', () => {
        expect(buildFilterFromParams({})).toBeNull();
    });

    it('returns filter JSON directly when params.filter is set', () => {
        const filter = {
            filters: [],
            logic: 'or' as const,
        };
        expect(buildFilterFromParams({ filter })).toBe(filter);
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
        expect(() => buildFilterFromParams({ date: '2026-03-15', from: '2026-03-01' }))
            .toThrow(/Cannot use 'date' together with 'from'/);
    });

    it('date + to throws error', () => {
        expect(() => buildFilterFromParams({ date: '2026-03-15', to: '2026-03-31' }))
            .toThrow(/Cannot use 'date' together with 'from'/);
    });

    it('invalid date throws error', () => {
        expect(() => buildFilterFromParams({ date: 'invalid' }))
            .toThrow(/Invalid date value/);
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
        expect(() => buildFilterFromParams({ property: 'noColonHere' }))
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
        const state = buildFilterFromParams({ file: 'test.md', tag: 'work', leaf: true });
        expect(state).not.toBeNull();
        expect(state!.logic).toBe('and');
        expect(state!.filters).toHaveLength(3);
    });

    it('filter JSON overrides all simple flags', () => {
        const filter = {
            filters: [],
            logic: 'or' as const,
        };
        const result = buildFilterFromParams({ file: 'test.md', tag: 'work', filter });
        expect(result).toBe(filter);
    });
});

// ── overlap 窓の実挙動（TaskFilterEngine を通した検証） ──

import { TaskFilterEngine } from '../../../src/services/filter/TaskFilterEngine';
import { assertValidFilterState } from '../../../src/api/FilterParamsBuilder';
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
    const state = buildFilterFromParams(params);
    if (!state) return true;
    return TaskFilterEngine.evaluate(dt, state);
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

describe('assertValidFilterState（filter/filter-file 境界検証）', () => {
    it('未知 property を拒否する', () => {
        const state = { filters: [{ property: 'statuss', operator: 'includes' }], logic: 'and' } as unknown as FilterState;
        expect(() => assertValidFilterState(state)).toThrow(/Unknown filter property: statuss/);
    });

    it('property に対して不正な operator を拒否する', () => {
        const state = { filters: [{ property: 'status', operator: 'onOrAfter' }], logic: 'and' } as unknown as FilterState;
        expect(() => assertValidFilterState(state)).toThrow(/Invalid operator 'onOrAfter' for filter property 'status'/);
    });

    it('正しい FilterState は通過する', () => {
        const state: FilterState = { filters: [{ property: 'status', operator: 'includes', value: ['x'] }], logic: 'and' };
        expect(() => assertValidFilterState(state)).not.toThrow();
    });

    it('buildFilterFromParams は params.filter を境界検証する', () => {
        const bad = { filters: [{ property: 'contentt', operator: 'contains', value: 'x' }], logic: 'and' } as unknown as FilterState;
        expect(() => buildFilterFromParams({ filter: bad })).toThrow(/Unknown filter property/);
    });
});
