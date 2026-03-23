import { describe, it, expect } from 'vitest';
import { FilterSerializer } from '../../../src/services/filter/FilterSerializer';
import type { FilterState, FilterCondition, FilterGroup } from '../../../src/services/filter/FilterTypes';
import { isFilterCondition, isFilterGroup } from '../../../src/services/filter/FilterTypes';

function makeCond(property: string, operator: string, value?: unknown): FilterCondition {
    const node: FilterCondition = {
        property: property as FilterCondition['property'],
        operator: operator as FilterCondition['operator'],
    };
    if (value !== undefined) node.value = value as FilterCondition['value'];
    return node;
}

function makeState(conditions: FilterCondition[], logic: 'and' | 'or' = 'and'): FilterState {
    return { filters: conditions, logic };
}

describe('FilterSerializer', () => {
    describe('v6 round-trip', () => {
        it('toJSON → fromJSON preserves structure', () => {
            const state = makeState([
                makeCond('tag', 'includes', ['work', 'urgent']),
                makeCond('file', 'excludes', ['archive.md']),
            ], 'or');

            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);

            expect(restored.logic).toBe('or');
            expect(restored.filters).toHaveLength(2);

            const c0 = restored.filters[0] as FilterCondition;
            expect(c0.property).toBe('tag');
            expect(c0.operator).toBe('includes');
            expect(c0.value).toEqual(['work', 'urgent']);
        });

        it('preserves nested groups', () => {
            const inner: FilterGroup = {
                filters: [makeCond('status', 'includes', ['x'])],
                logic: 'or',
            };
            const state: FilterState = {
                filters: [inner, makeCond('tag', 'includes', ['a'])],
                logic: 'and',
            };

            const restored = FilterSerializer.fromJSON(FilterSerializer.toJSON(state));
            expect(restored.filters).toHaveLength(2);
            expect(isFilterGroup(restored.filters[0])).toBe(true);
            const restoredInner = restored.filters[0] as FilterGroup;
            expect(restoredInner.logic).toBe('or');
            expect(restoredInner.filters).toHaveLength(1);
        });

        it('serializes date condition (absolute)', () => {
            const state = makeState([makeCond('startDate', 'equals', '2026-03-10')]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);
            const c = restored.filters[0] as FilterCondition;
            expect(c.value).toBe('2026-03-10');
        });

        it('serializes date condition (relative)', () => {
            const state = makeState([makeCond('startDate', 'equals', { preset: 'today' })]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);
            const c = restored.filters[0] as FilterCondition;
            expect(c.value).toEqual({ preset: 'today' });
        });

        it('serializes length condition with unit', () => {
            const cond = makeCond('length', 'greaterThan', 2);
            cond.unit = 'hours';
            const state = makeState([cond]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);
            const c = restored.filters[0] as FilterCondition;
            expect(c.value).toBe(2);
            expect(c.unit).toBe('hours');
        });

        it('serializes property condition with key', () => {
            const cond = makeCond('property', 'contains', 'high');
            cond.key = 'priority';
            const state = makeState([cond]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);
            const c = restored.filters[0] as FilterCondition;
            expect(c.value).toBe('high');
            expect(c.key).toBe('priority');
        });

        it('serializes isSet condition (no value)', () => {
            const state = makeState([makeCond('parent', 'isSet')]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);
            const c = restored.filters[0] as FilterCondition;
            expect(c.property).toBe('parent');
            expect(c.operator).toBe('isSet');
            expect(c.value).toBeUndefined();
        });

        it('serializes target field', () => {
            const cond = makeCond('tag', 'includes', ['work']);
            cond.target = 'parent';
            const state = makeState([cond]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);
            const c = restored.filters[0] as FilterCondition;
            expect(c.target).toBe('parent');
        });

        it('output format matches v6 spec', () => {
            const state = makeState([
                makeCond('tag', 'includes', ['work']),
            ]);
            const json = FilterSerializer.toJSON(state);
            expect(json).toEqual({
                logic: 'and',
                filters: [
                    { property: 'tag', operator: 'includes', value: ['work'] },
                ],
            });
        });
    });

    describe('single condition', () => {
        it('parses a single condition object as root', () => {
            const v5 = { property: 'tag', operator: 'includes', value: ['work'] };
            const result = FilterSerializer.fromJSON(v5);
            expect(result.filters).toHaveLength(1);
            const c = result.filters[0] as FilterCondition;
            expect(c.property).toBe('tag');
            expect(c.value).toEqual(['work']);
        });
    });

    describe('invalid input', () => {
        it('null → empty state', () => {
            const result = FilterSerializer.fromJSON(null);
            expect(result.filters).toHaveLength(0);
        });

        it('undefined → empty state', () => {
            const result = FilterSerializer.fromJSON(undefined);
            expect(result.filters).toHaveLength(0);
        });

        it('empty object → empty state', () => {
            const result = FilterSerializer.fromJSON({});
            expect(result.filters).toHaveLength(0);
        });
    });

    describe('URI encoding', () => {
        it('round-trip toURIParam → fromURIParam', () => {
            const state = makeState([makeCond('tag', 'includes', ['work'])]);
            const uri = FilterSerializer.toURIParam(state);
            expect(uri).not.toBe('');

            const restored = FilterSerializer.fromURIParam(uri);
            expect(restored.filters).toHaveLength(1);
            const c = restored.filters[0] as FilterCondition;
            expect(c.property).toBe('tag');
        });

        it('empty filter → empty string', () => {
            const state: FilterState = { filters: [], logic: 'and' };
            expect(FilterSerializer.toURIParam(state)).toBe('');
        });

        it('empty param → empty state', () => {
            const result = FilterSerializer.fromURIParam('');
            expect(result.filters).toHaveLength(0);
        });

        it('invalid param → empty state', () => {
            const result = FilterSerializer.fromURIParam('not-valid-base64!!!');
            expect(result.filters).toHaveLength(0);
        });
    });
});
