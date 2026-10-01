import { describe, it, expect } from 'vitest';
import { compileFilter, ALWAYS } from '../../../src/services/filter/FilterExpr';
import type { FilterCondition, FilterState } from '../../../src/services/filter/FilterTypes';

const one = (c: FilterCondition): FilterState => ({ logic: 'and', filters: [c] });
const compiled = (c: FilterCondition) => compileFilter(one(c));
const all = (...items: unknown[]) => ({ kind: 'all', items });

// The saved condition names its negation in the operator and its subject in
// `target`; the tree the engine evaluates holds both as nodes of their own,
// over positive atoms.
describe('compileFilter', () => {
    const work = { kind: 'tagUnder', tags: ['work'] };

    it('includes is the atom itself', () => {
        expect(compiled({ property: 'tag', operator: 'includes', value: ['work'] })).toEqual(all(work));
    });

    it('excludes is not(includes)', () => {
        expect(compiled({ property: 'tag', operator: 'excludes', value: ['work'] })).toEqual(all({ kind: 'not', item: work }));
    });

    it('notContains is not(contains), isNotSet is not(isSet)', () => {
        expect(compiled({ property: 'content', operator: 'notContains', value: 'x' }))
            .toEqual(all({ kind: 'not', item: { kind: 'contentContains', text: 'x' } }));
        expect(compiled({ property: 'due', operator: 'isNotSet' }))
            .toEqual(all({ kind: 'not', item: { kind: 'has', property: 'due' } }));
        expect(compiled({ property: 'property', operator: 'isNotSet', key: 'owner' }))
            .toEqual(all({ kind: 'not', item: { kind: 'propertySet', key: 'owner' } }));
    });

    it('target parent is ancestors(atom), and with a negative operator not(ancestors(atom))', () => {
        expect(compiled({ property: 'tag', operator: 'includes', value: ['work'], target: 'parent' }))
            .toEqual(all({ kind: 'ancestors', item: work }));
        expect(compiled({ property: 'tag', operator: 'excludes', value: ['work'], target: 'parent' }))
            .toEqual(all({ kind: 'not', item: { kind: 'ancestors', item: work } }));
    });

    it('reads the value each property holds', () => {
        expect(compiled({ property: 'status', operator: 'includes', value: ['x'] }))
            .toEqual(all({ kind: 'textIn', property: 'status', values: ['x'] }));
        expect(compiled({ property: 'tag', operator: 'equals', value: ['a'] })).toEqual(all({ kind: 'tagIs', tags: ['a'] }));
        expect(compiled({ property: 'tag', operator: 'only', value: ['a'] })).toEqual(all({ kind: 'tagsExactly', tags: ['a'] }));
        expect(compiled({ property: 'due', operator: 'before', value: { preset: 'today' } }))
            .toEqual(all({ kind: 'date', property: 'due', op: 'before', value: { preset: 'today' } }));
        expect(compiled({ property: 'length', operator: 'lessThan', value: 2 }))
            .toEqual(all({ kind: 'length', op: 'lessThan', value: 2, unit: 'hours' }));
        expect(compiled({ property: 'property', operator: 'equals', key: 'k' }))
            .toEqual(all({ kind: 'propertyEquals', key: 'k', value: '' }));
    });

    // Mapping an unfinished excludes to not(includes []) would match nothing;
    // the whole condition, target and operator unread, constrains nothing.
    it.each<FilterCondition>([
        { property: 'tag', operator: 'excludes', value: [], target: 'parent' },
        { property: 'file', operator: 'includes' },
        { property: 'due', operator: 'equals', target: 'parent' },
        { property: 'due', operator: 'equals', value: '' },
        { property: 'length', operator: 'greaterThan' },
        { property: 'content', operator: 'notContains' },
        { property: 'property', operator: 'notContains', key: '', value: 'x' },
    ])('an unfinished condition compiles to ALWAYS: %j', c => {
        expect(compiled(c)).toEqual(all(ALWAYS));
    });

    it('content "" and a property without text are values, not unfinished', () => {
        expect(compiled({ property: 'content', operator: 'notContains', value: '' }))
            .toEqual(all({ kind: 'not', item: { kind: 'contentContains', text: '' } }));
    });

    it('a group with nothing in it is ALWAYS, whatever its logic', () => {
        expect(compileFilter({ logic: 'or', filters: [] })).toEqual(ALWAYS);
        expect(compileFilter({ logic: 'and', filters: [{ logic: 'or', filters: [] }] })).toEqual(all(ALWAYS));
    });

    it('groups keep their logic', () => {
        expect(compileFilter({ logic: 'or', filters: [{ property: 'parent', operator: 'isSet' }, { property: 'children', operator: 'isSet' }] }))
            .toEqual({ kind: 'any', items: [{ kind: 'has', property: 'parent' }, { kind: 'has', property: 'children' }] });
    });
});
