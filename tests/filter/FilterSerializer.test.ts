import { describe, it, expect } from 'vitest';
import { FilterSerializer } from '../../src/services/filter/FilterSerializer';
import type { FilterState, FilterConditionNode, FilterGroupNode } from '../../src/services/filter/FilterTypes';

function makeCond(property: string, operator: string, values: string[]): FilterConditionNode {
    return {
        type: 'condition',
        id: 'f-1',
        property: property as FilterConditionNode['property'],
        operator: operator as FilterConditionNode['operator'],
        value: { type: 'stringSet', values },
    };
}

function makeState(conditions: FilterConditionNode[], logic: 'and' | 'or' = 'and'): FilterState {
    return {
        root: { type: 'group', id: 'root', children: conditions, logic },
    };
}

describe('FilterSerializer', () => {
    describe('v4 round-trip', () => {
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
            expect(c0.value).toEqual({ type: 'stringSet', values: ['work', 'urgent'] });
        });

        it('preserves nested groups', () => {
            const inner: FilterGroupNode = {
                type: 'group', id: 'g-inner', logic: 'or',
                children: [makeCond('status', 'includes', ['x'])],
            };
            const state: FilterState = {
                root: { type: 'group', id: 'root', logic: 'and', children: [inner, makeCond('tag', 'includes', ['a'])] },
            };

            const restored = FilterSerializer.fromJSON(FilterSerializer.toJSON(state));
            expect(restored.root.children).toHaveLength(2);
            expect(restored.root.children[0].type).toBe('group');
            const restoredInner = restored.root.children[0] as FilterGroupNode;
            expect(restoredInner.logic).toBe('or');
            expect(restoredInner.children).toHaveLength(1);
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
            const state: FilterState = { root: { type: 'group', id: 'root', children: [], logic: 'and' } };
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
