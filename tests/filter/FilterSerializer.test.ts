import { describe, it, expect } from 'vitest';
import { FilterSerializer } from '../../src/services/filter/FilterSerializer';
import type { FilterState, FilterConditionNode, FilterGroupNode } from '../../src/services/filter/FilterTypes';

function makeCond(property: string, operator: string, value?: unknown): FilterConditionNode {
    const node: FilterConditionNode = {
        type: 'condition',
        property: property as FilterConditionNode['property'],
        operator: operator as FilterConditionNode['operator'],
    };
    if (value !== undefined) node.value = value as FilterConditionNode['value'];
    return node;
}

function makeState(conditions: FilterConditionNode[], logic: 'and' | 'or' = 'and'): FilterState {
    return {
        root: { type: 'group', children: conditions, logic },
    };
}

describe('FilterSerializer', () => {
    describe('v5 round-trip', () => {
        it('toJSON → fromJSON preserves structure', () => {
            const state = makeState([
                makeCond('tag', 'includes', ['work', 'urgent']),
                makeCond('file', 'excludes', ['archive.md']),
            ], 'or');

            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);

            expect(restored.root.logic).toBe('or');
            expect(restored.root.children).toHaveLength(2);

            const c0 = restored.root.children[0] as FilterConditionNode;
            expect(c0.property).toBe('tag');
            expect(c0.operator).toBe('includes');
            expect(c0.value).toEqual(['work', 'urgent']);
        });

        it('preserves nested groups', () => {
            const inner: FilterGroupNode = {
                type: 'group', logic: 'or',
                children: [makeCond('status', 'includes', ['x'])],
            };
            const state: FilterState = {
                root: { type: 'group', logic: 'and', children: [inner, makeCond('tag', 'includes', ['a'])] },
            };

            const restored = FilterSerializer.fromJSON(FilterSerializer.toJSON(state));
            expect(restored.root.children).toHaveLength(2);
            expect(restored.root.children[0].type).toBe('group');
            const restoredInner = restored.root.children[0] as FilterGroupNode;
            expect(restoredInner.logic).toBe('or');
            expect(restoredInner.children).toHaveLength(1);
        });

        it('serializes date condition (absolute)', () => {
            const state = makeState([makeCond('startDate', 'equals', '2026-03-10')]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);
            const c = restored.root.children[0] as FilterConditionNode;
            expect(c.value).toBe('2026-03-10');
        });

        it('serializes date condition (relative)', () => {
            const state = makeState([makeCond('startDate', 'equals', { preset: 'today' })]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);
            const c = restored.root.children[0] as FilterConditionNode;
            expect(c.value).toEqual({ preset: 'today' });
        });

        it('serializes length condition with unit', () => {
            const cond = makeCond('length', 'greaterThan', 2);
            cond.unit = 'hours';
            const state = makeState([cond]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);
            const c = restored.root.children[0] as FilterConditionNode;
            expect(c.value).toBe(2);
            expect(c.unit).toBe('hours');
        });

        it('serializes property condition with key', () => {
            const cond = makeCond('property', 'contains', 'high');
            cond.key = 'priority';
            const state = makeState([cond]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);
            const c = restored.root.children[0] as FilterConditionNode;
            expect(c.value).toBe('high');
            expect(c.key).toBe('priority');
        });

        it('serializes isSet condition (no value)', () => {
            const state = makeState([makeCond('parent', 'isSet')]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.fromJSON(json);
            const c = restored.root.children[0] as FilterConditionNode;
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
            const c = restored.root.children[0] as FilterConditionNode;
            expect(c.target).toBe('parent');
        });

        it('output format matches spec', () => {
            const state = makeState([
                makeCond('tag', 'includes', ['work']),
            ]);
            const json = FilterSerializer.toJSON(state);
            expect(json).toEqual({
                logic: 'and',
                conditions: [
                    { property: 'tag', operator: 'includes', value: ['work'] },
                ],
            });
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
            const c = result.root.children[0] as FilterConditionNode;
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
            const c = result.root.children[0] as FilterConditionNode;
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
            const c = result.root.children[0] as FilterConditionNode;
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
            const c = result.root.children[0] as FilterConditionNode;
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
            const c = result.root.children[0] as FilterConditionNode;
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
            const c = result.root.children[0] as FilterConditionNode;
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
            const c = result.root.children[0] as FilterConditionNode;
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
            expect(result.root.children).toHaveLength(2);
            expect(result.root.children[0].type).toBe('group');
            const inner = result.root.children[0] as FilterGroupNode;
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
            expect(result.root.type).toBe('group');
            // Single group flattened into root
            expect(result.root.children).toHaveLength(1);
            const c = result.root.children[0] as FilterConditionNode;
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
            expect(result.root.logic).toBe('or');
            expect(result.root.children).toHaveLength(2);
            expect(result.root.children[0].type).toBe('group');
            expect(result.root.children[1].type).toBe('group');
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
            expect(result.root.logic).toBe('or');
            expect(result.root.children).toHaveLength(2);
        });

        it('empty conditions → empty state', () => {
            const v2 = { conditions: [], logic: 'and' };
            const result = FilterSerializer.fromJSON(v2);
            expect(result.root.children).toHaveLength(0);
        });
    });

    describe('v5 single condition', () => {
        it('parses a single condition object as root', () => {
            const v5 = { property: 'tag', operator: 'includes', value: ['work'] };
            const result = FilterSerializer.fromJSON(v5);
            expect(result.root.children).toHaveLength(1);
            const c = result.root.children[0] as FilterConditionNode;
            expect(c.property).toBe('tag');
            expect(c.value).toEqual(['work']);
        });
    });

    describe('invalid input', () => {
        it('null → empty state', () => {
            const result = FilterSerializer.fromJSON(null);
            expect(result.root.children).toHaveLength(0);
        });

        it('undefined → empty state', () => {
            const result = FilterSerializer.fromJSON(undefined);
            expect(result.root.children).toHaveLength(0);
        });

        it('empty object → empty state', () => {
            const result = FilterSerializer.fromJSON({});
            expect(result.root.children).toHaveLength(0);
        });
    });

    describe('URI encoding', () => {
        it('round-trip toURIParam → fromURIParam', () => {
            const state = makeState([makeCond('tag', 'includes', ['work'])]);
            const uri = FilterSerializer.toURIParam(state);
            expect(uri).not.toBe('');

            const restored = FilterSerializer.fromURIParam(uri);
            expect(restored.root.children).toHaveLength(1);
            const c = restored.root.children[0] as FilterConditionNode;
            expect(c.property).toBe('tag');
        });

        it('empty filter → empty string', () => {
            const state: FilterState = { root: { type: 'group', children: [], logic: 'and' } };
            expect(FilterSerializer.toURIParam(state)).toBe('');
        });

        it('empty param → empty state', () => {
            const result = FilterSerializer.fromURIParam('');
            expect(result.root.children).toHaveLength(0);
        });

        it('invalid param → empty state', () => {
            const result = FilterSerializer.fromURIParam('not-valid-base64!!!');
            expect(result.root.children).toHaveLength(0);
        });
    });
});
