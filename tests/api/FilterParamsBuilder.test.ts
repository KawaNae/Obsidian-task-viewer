import { describe, it, expect } from 'vitest';
import { buildFilterFromParams } from '../../src/api/FilterParamsBuilder';
import type { FilterConditionNode, FilterGroupNode } from '../../src/services/filter/FilterTypes';
import type { ListParams } from '../../src/api/TaskApiTypes';

/** Extract condition nodes from the built FilterState */
function getConditions(params: ListParams): FilterConditionNode[] {
    const state = buildFilterFromParams(params);
    if (!state) return [];
    return state.root.children.filter(
        (c): c is FilterConditionNode => c.type === 'condition',
    );
}

function findCondition(conditions: FilterConditionNode[], property: string): FilterConditionNode | undefined {
    return conditions.find(c => c.property === property);
}

describe('buildFilterFromParams', () => {
    it('returns null when no params are provided', () => {
        expect(buildFilterFromParams({})).toBeNull();
    });

    it('returns filter JSON directly when params.filter is set', () => {
        const filter = {
            root: {
                type: 'group' as const,
                id: 'test',
                children: [],
                logic: 'and' as const,
            },
        };
        expect(buildFilterFromParams({ filter })).toBe(filter);
    });

    // ── file ──
    it('file → file includes stringSet', () => {
        const conditions = getConditions({ file: 'daily.md' });
        const c = findCondition(conditions, 'file');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('includes');
        expect(c!.value).toEqual({ type: 'stringSet', values: ['daily.md'] });
    });

    it('file auto-appends .md', () => {
        const conditions = getConditions({ file: 'daily' });
        const c = findCondition(conditions, 'file');
        expect(c!.value).toEqual({ type: 'stringSet', values: ['daily.md'] });
    });

    // ── status ──
    it('status → status includes stringSet', () => {
        const conditions = getConditions({ status: 'x,-' });
        const c = findCondition(conditions, 'status');
        expect(c).toBeDefined();
        expect(c!.value).toEqual({ type: 'stringSet', values: ['x', '-'] });
    });

    // ── tag ──
    it('tag → tag includes stringSet (strips #)', () => {
        const conditions = getConditions({ tag: '#work,reading' });
        const c = findCondition(conditions, 'tag');
        expect(c).toBeDefined();
        expect(c!.value).toEqual({ type: 'stringSet', values: ['work', 'reading'] });
    });

    // ── content ──
    it('content → content contains string', () => {
        const conditions = getConditions({ content: '会議' });
        const c = findCondition(conditions, 'content');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('contains');
        expect(c!.value).toEqual({ type: 'string', value: '会議' });
    });

    // ── date ──
    it('date → startDate onOrBefore + endDate onOrAfter', () => {
        const conditions = getConditions({ date: '2026-03-15' });
        const start = findCondition(conditions, 'startDate');
        const end = findCondition(conditions, 'endDate');
        expect(start).toBeDefined();
        expect(start!.operator).toBe('onOrBefore');
        expect(end).toBeDefined();
        expect(end!.operator).toBe('onOrAfter');
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

    // ── from / to ──
    it('from → startDate onOrAfter', () => {
        const conditions = getConditions({ from: '2026-03-01' });
        const c = findCondition(conditions, 'startDate');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('onOrAfter');
    });

    it('to → endDate onOrBefore', () => {
        const conditions = getConditions({ to: '2026-03-31' });
        const c = findCondition(conditions, 'endDate');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('onOrBefore');
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
    it('property → property contains', () => {
        const conditions = getConditions({ property: '優先度:高' });
        const c = findCondition(conditions, 'property');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('contains');
        expect(c!.value).toEqual({ type: 'property', key: '優先度', value: '高' });
    });

    it('invalid property format throws error', () => {
        expect(() => buildFilterFromParams({ property: 'noColonHere' }))
            .toThrow(/Invalid property filter format/);
    });

    // ── color (new) ──
    it('color → color includes stringSet', () => {
        const conditions = getConditions({ color: 'red,blue' });
        const c = findCondition(conditions, 'color');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('includes');
        expect(c!.value).toEqual({ type: 'stringSet', values: ['red', 'blue'] });
    });

    it('color as array', () => {
        const conditions = getConditions({ color: ['green'] });
        const c = findCondition(conditions, 'color');
        expect(c!.value).toEqual({ type: 'stringSet', values: ['green'] });
    });

    // ── type (new) ──
    it('type → taskType includes stringSet', () => {
        const conditions = getConditions({ type: 'frontmatter' });
        const c = findCondition(conditions, 'taskType');
        expect(c).toBeDefined();
        expect(c!.operator).toBe('includes');
        expect(c!.value).toEqual({ type: 'stringSet', values: ['frontmatter'] });
    });

    it('type with multiple values', () => {
        const conditions = getConditions({ type: 'at-notation,frontmatter' });
        const c = findCondition(conditions, 'taskType');
        expect(c!.value).toEqual({ type: 'stringSet', values: ['at-notation', 'frontmatter'] });
    });

    // ── root (new) ──
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
        expect(state!.root.logic).toBe('and');
        expect(state!.root.children).toHaveLength(3);
    });

    it('filter JSON overrides all simple flags', () => {
        const filter = {
            root: {
                type: 'group' as const,
                id: 'custom',
                children: [],
                logic: 'or' as const,
            },
        };
        const result = buildFilterFromParams({ file: 'test.md', tag: 'work', filter });
        expect(result).toBe(filter);
    });
});
