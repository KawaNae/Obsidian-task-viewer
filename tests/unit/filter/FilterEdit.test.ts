import { describe, it, expect } from 'vitest';
import type { FilterCondition, FilterGroup, FilterState } from '../../../src/services/filter/FilterTypes';
import {
    nodeAt, updateGroupAt, updateConditionAt, replaceAt, appendTo, toggleLogic,
    conditionOn, withOperator, withTarget,
} from '../../../src/services/filter/FilterEdit';

const tag: FilterCondition = { property: 'tag', operator: 'includes', value: ['work'] };
const due: FilterCondition = { property: 'due', operator: 'before', value: { preset: 'today' } };
const inner: FilterGroup = { filters: [due], logic: 'or' };
const state: FilterState = { filters: [tag, inner], logic: 'and' };

describe('FilterEdit: a filter is a value, and an edit makes a new one', () => {
    it('finds a node by its path from the root', () => {
        expect(nodeAt(state, [])).toBe(state);
        expect(nodeAt(state, [0])).toBe(tag);
        expect(nodeAt(state, [1, 0])).toBe(due);
        expect(() => nodeAt(state, [2])).toThrow();
    });

    it('leaves the filter it was given as it was, and shares the nodes it did not change', () => {
        const before = JSON.stringify(state);
        const next = updateConditionAt(state, [1, 0], c => withOperator(c, 'after'));
        expect(JSON.stringify(state)).toBe(before);
        expect(next).not.toBe(state);
        expect(next.filters[0]).toBe(tag);
        expect(nodeAt(next, [1, 0])).toEqual({ ...due, operator: 'after' });
    });

    it('hands back the same filter when the edit changed nothing', () => {
        expect(updateConditionAt(state, [0], c => c)).toBe(state);
        expect(replaceAt(state, [1, 0], node => [node])).toBe(state);
    });

    it('removes, duplicates and ungroups a node by what replaces it', () => {
        expect(replaceAt(state, [0], () => []).filters).toEqual([inner]);
        expect(replaceAt(state, [0], node => [node, node]).filters).toEqual([tag, tag, inner]);
        const ungrouped = replaceAt(state, [1], node => ('filters' in node ? node.filters : [node]));
        expect(ungrouped.filters).toEqual([tag, due]);
    });

    it('edits the root group and a nested one', () => {
        expect(updateGroupAt(state, [], toggleLogic).logic).toBe('or');
        expect(nodeAt(updateGroupAt(state, [1], toggleLogic), [1])).toEqual({ ...inner, logic: 'and' });
        expect(updateGroupAt(state, [], g => appendTo(g, tag)).filters).toEqual([tag, inner, tag]);
    });
});

describe('FilterEdit: the condition edits the filter menu makes', () => {
    it('a new row on a property starts with its first operator and the menu\'s value, keeping the target', () => {
        expect(conditionOn('status')).toEqual({ property: 'status', operator: 'includes', value: [] });
        expect(conditionOn('content')).toEqual({ property: 'content', operator: 'contains', value: '' });
        expect(conditionOn('due')).toEqual({ property: 'due', operator: 'isSet' });
        expect(conditionOn('length')).toEqual({ property: 'length', operator: 'lessThan', value: 1, unit: 'hours' });
        expect(conditionOn('property')).toEqual({ property: 'property', operator: 'isSet', key: '' });
        expect(conditionOn('tag', 'parent')).toEqual({ property: 'tag', operator: 'includes', value: [], target: 'parent' });
    });

    it('an operator that takes no value drops the value; one that takes a value starts with the menu\'s', () => {
        const set = withOperator(due, 'isSet');
        expect(set).toEqual({ property: 'due', operator: 'isSet' });
        expect(withOperator(set, 'before')).toEqual({ property: 'due', operator: 'before', value: { preset: 'today' } });
        expect(withOperator({ property: 'due', operator: 'after', value: '2026-10-01' }, 'before'))
            .toEqual({ property: 'due', operator: 'before', value: '2026-10-01' });

        const length = withOperator({ property: 'length', operator: 'lessThan', value: 30, unit: 'minutes' }, 'isSet');
        expect(length).toEqual({ property: 'length', operator: 'isSet', unit: 'minutes' });
        expect(withOperator(length, 'greaterThan')).toEqual({ property: 'length', operator: 'greaterThan', value: 1, unit: 'hours' });

        expect(withOperator({ property: 'property', operator: 'equals', key: 'k', value: 'v' }, 'isNotSet'))
            .toEqual({ property: 'property', operator: 'isNotSet', key: 'k' });
        expect(withOperator(tag, 'only')).toEqual({ ...tag, operator: 'only' });
    });

    it('refuses an operator the property does not take', () => {
        expect(() => withOperator(tag, 'before')).toThrow(/'tag' takes no 'before'/);
    });

    it('writes the self target as no target', () => {
        const onParent = withTarget(tag, 'parent');
        expect(onParent).toEqual({ ...tag, target: 'parent' });
        expect(withTarget(onParent, 'self')).toEqual(tag);
        expect('target' in withTarget(onParent, 'self')).toBe(false);
    });
});
