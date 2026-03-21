import { describe, it, expect } from 'vitest';
import { FilterSerializer } from '../../src/services/filter/FilterSerializer';
import type { FilterState, FilterCondition, FilterGroup } from '../../src/services/filter/FilterTypes';
import { isFilterCondition, isFilterGroup } from '../../src/services/filter/FilterTypes';

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

    describe('v5 backward compat (conditions key)', () => {
        it('reads v5 format', () => {
            const v5 = {
                logic: 'and',
                conditions: [
                    { property: 'tag', operator: 'includes', value: ['work'] },
                ],
            };
            const result = FilterSerializer.fromJSON(v5);
            expect(result.filters).toHaveLength(1);
            const c = result.filters[0] as FilterCondition;
            expect(c.property).toBe('tag');
            expect(c.value).toEqual(['work']);
        });
    });

    describe('v4 migration (old internal format)', () => {
        it('migrates stringSet value', () => {
            const v4 = {
                root: {
                    type: 'group', id: 'root', logic: 'and',
                    children: [{
                        type: 'condition', id: 'f-1',
                        property: 'tag', operator: 'includes',
                        value: { type: 'stringSet', values: ['work', 'urgent'] },
                    }],
                },
            };
            const result = FilterSerializer.fromJSON(v4);
            const c = result.filters[0] as FilterCondition;
            expect(c.value).toEqual(['work', 'urgent']);
        });

        it('migrates string value', () => {
            const v4 = {
                root: {
                    type: 'group', id: 'root', logic: 'and',
                    children: [{
                        type: 'condition', id: 'f-1',
                        property: 'content', operator: 'contains',
                        value: { type: 'string', value: 'hello' },
                    }],
                },
            };
            const result = FilterSerializer.fromJSON(v4);
            const c = result.filters[0] as FilterCondition;
            expect(c.value).toBe('hello');
        });

        it('migrates absolute date value', () => {
            const v4 = {
                root: {
                    type: 'group', id: 'root', logic: 'and',
                    children: [{
                        type: 'condition', id: 'f-1',
                        property: 'startDate', operator: 'equals',
                        value: { type: 'date', value: { mode: 'absolute', date: '2026-03-10' } },
                    }],
                },
            };
            const result = FilterSerializer.fromJSON(v4);
            const c = result.filters[0] as FilterCondition;
            expect(c.value).toBe('2026-03-10');
        });

        it('migrates relative date value', () => {
            const v4 = {
                root: {
                    type: 'group', id: 'root', logic: 'and',
                    children: [{
                        type: 'condition', id: 'f-1',
                        property: 'startDate', operator: 'equals',
                        value: { type: 'date', value: { mode: 'relative', preset: 'today' } },
                    }],
                },
            };
            const result = FilterSerializer.fromJSON(v4);
            const c = result.filters[0] as FilterCondition;
            expect(c.value).toEqual({ preset: 'today' });
        });

        it('migrates number value with unit', () => {
            const v4 = {
                root: {
                    type: 'group', id: 'root', logic: 'and',
                    children: [{
                        type: 'condition', id: 'f-1',
                        property: 'length', operator: 'greaterThan',
                        value: { type: 'number', value: 2, unit: 'hours' },
                    }],
                },
            };
            const result = FilterSerializer.fromJSON(v4);
            const c = result.filters[0] as FilterCondition;
            expect(c.value).toBe(2);
            expect(c.unit).toBe('hours');
        });

        it('migrates property value with key', () => {
            const v4 = {
                root: {
                    type: 'group', id: 'root', logic: 'and',
                    children: [{
                        type: 'condition', id: 'f-1',
                        property: 'property', operator: 'contains',
                        value: { type: 'property', key: 'priority', value: 'high' },
                    }],
                },
            };
            const result = FilterSerializer.fromJSON(v4);
            const c = result.filters[0] as FilterCondition;
            expect(c.value).toBe('high');
            expect(c.key).toBe('priority');
        });

        it('migrates boolean value (isSet)', () => {
            const v4 = {
                root: {
                    type: 'group', id: 'root', logic: 'and',
                    children: [{
                        type: 'condition', id: 'f-1',
                        property: 'parent', operator: 'isSet',
                        value: { type: 'boolean', value: true },
                    }],
                },
            };
            const result = FilterSerializer.fromJSON(v4);
            const c = result.filters[0] as FilterCondition;
            expect(c.value).toBeUndefined();
        });

        it('migrates nested groups', () => {
            const v4 = {
                root: {
                    type: 'group', id: 'root', logic: 'and',
                    children: [
                        {
                            type: 'group', id: 'g-inner', logic: 'or',
                            children: [{
                                type: 'condition', id: 'f-1',
                                property: 'status', operator: 'includes',
                                value: { type: 'stringSet', values: ['x'] },
                            }],
                        },
                        {
                            type: 'condition', id: 'f-2',
                            property: 'tag', operator: 'includes',
                            value: { type: 'stringSet', values: ['a'] },
                        },
                    ],
                },
            };
            const result = FilterSerializer.fromJSON(v4);
            expect(result.filters).toHaveLength(2);
            expect(isFilterGroup(result.filters[0])).toBe(true);
            const inner = result.filters[0] as FilterGroup;
            expect(inner.logic).toBe('or');
        });
    });

    describe('v3 migration', () => {
        it('migrates flat groups to recursive root', () => {
            const v3 = {
                groups: [
                    {
                        id: 'g1',
                        logic: 'and',
                        conditions: [
                            { id: 'f1', property: 'tag', operator: 'includes', value: { type: 'stringSet', values: ['work'] } },
                        ],
                    },
                ],
                logic: 'and',
            };

            const result = FilterSerializer.fromJSON(v3);
            // Single group flattened into root
            expect(result.filters).toHaveLength(1);
            const c = result.filters[0] as FilterCondition;
            expect(c.property).toBe('tag');
            expect(c.value).toEqual(['work']);
        });

        it('migrates multiple groups', () => {
            const v3 = {
                groups: [
                    { id: 'g1', logic: 'and', conditions: [{ id: 'f1', property: 'tag', operator: 'includes', value: { type: 'stringSet', values: ['a'] } }] },
                    { id: 'g2', logic: 'or', conditions: [{ id: 'f2', property: 'file', operator: 'includes', value: { type: 'stringSet', values: ['b'] } }] },
                ],
                logic: 'or',
            };

            const result = FilterSerializer.fromJSON(v3);
            expect(result.logic).toBe('or');
            expect(result.filters).toHaveLength(2);
            expect(isFilterGroup(result.filters[0])).toBe(true);
            expect(isFilterGroup(result.filters[1])).toBe(true);
        });
    });

    describe('v2 migration', () => {
        it('migrates flat conditions to root group', () => {
            const v2 = {
                conditions: [
                    { id: 'f1', property: 'tag', operator: 'includes', value: { type: 'stringSet', values: ['work'] } },
                    { id: 'f2', property: 'status', operator: 'excludes', value: { type: 'stringSet', values: ['x'] } },
                ],
                logic: 'or',
            };

            const result = FilterSerializer.fromJSON(v2);
            expect(result.logic).toBe('or');
            expect(result.filters).toHaveLength(2);
        });

        it('empty conditions → empty state', () => {
            const v2 = { conditions: [], logic: 'and' };
            const result = FilterSerializer.fromJSON(v2);
            expect(result.filters).toHaveLength(0);
        });
    });

    describe('v5/v6 single condition', () => {
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
