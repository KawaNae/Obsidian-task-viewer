import { describe, it, expect } from 'vitest';
import { FilterSerializer } from '../../../src/services/filter/FilterSerializer';
import type { FilterState, FilterCondition, FilterGroup } from '../../../src/services/filter/FilterTypes';
import { isFilterCondition } from '../../../src/services/filter/FilterTypes';
import { evaluateFilter } from '../helpers/filterContext';
import { makeTask } from '../helpers/makeTask';
import type { DisplayTask } from '../../../src/types';

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
        it('toJSON → parse preserves structure', () => {
            const state = makeState([
                makeCond('tag', 'includes', ['work', 'urgent']),
                makeCond('file', 'excludes', ['archive.md']),
            ], 'or');

            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.parse(json).state;

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

            const restored = FilterSerializer.parse(FilterSerializer.toJSON(state)).state;
            expect(restored.filters).toHaveLength(2);
            expect(isFilterCondition(restored.filters[0])).toBe(false);
            const restoredInner = restored.filters[0] as FilterGroup;
            expect(restoredInner.logic).toBe('or');
            expect(restoredInner.filters).toHaveLength(1);
        });

        it('serializes date condition (absolute)', () => {
            const state = makeState([makeCond('startDate', 'equals', '2026-03-10')]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.parse(json).state;
            const c = restored.filters[0] as FilterCondition;
            expect(c.value).toBe('2026-03-10');
        });

        it('serializes date condition (relative)', () => {
            const state = makeState([makeCond('startDate', 'equals', { preset: 'today' })]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.parse(json).state;
            const c = restored.filters[0] as FilterCondition;
            expect(c.value).toEqual({ preset: 'today' });
        });

        it('serializes length condition with unit', () => {
            const cond = makeCond('length', 'greaterThan', 2);
            cond.unit = 'hours';
            const state = makeState([cond]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.parse(json).state;
            const c = restored.filters[0] as FilterCondition;
            expect(c.value).toBe(2);
            expect(c.unit).toBe('hours');
        });

        it('serializes property condition with key', () => {
            const cond = makeCond('property', 'contains', 'high');
            cond.key = 'priority';
            const state = makeState([cond]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.parse(json).state;
            const c = restored.filters[0] as FilterCondition;
            expect(c.value).toBe('high');
            expect(c.key).toBe('priority');
        });

        it('serializes isSet condition (no value)', () => {
            const state = makeState([makeCond('parent', 'isSet')]);
            const json = FilterSerializer.toJSON(state);
            const restored = FilterSerializer.parse(json).state;
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
            const restored = FilterSerializer.parse(json).state;
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
            const result = FilterSerializer.parse(v5).state;
            expect(result.filters).toHaveLength(1);
            const c = result.filters[0] as FilterCondition;
            expect(c.property).toBe('tag');
            expect(c.value).toEqual(['work']);
        });
    });

    describe('invalid input', () => {
        const notAGroup = [{ at: 'filter', reason: 'not a filter group ({ logic, filters })' }];

        it('null → empty state, with an issue', () => {
            expect(FilterSerializer.parse(null)).toEqual({ state: { filters: [], logic: 'and' }, issues: notAGroup });
        });

        it('undefined → empty state, with an issue', () => {
            expect(FilterSerializer.parse(undefined)).toEqual({ state: { filters: [], logic: 'and' }, issues: notAGroup });
        });

        it('empty object → empty state, with an issue', () => {
            expect(FilterSerializer.parse({})).toEqual({ state: { filters: [], logic: 'and' }, issues: notAGroup });
        });

        it('a group without conditions → empty state, no issue', () => {
            expect(FilterSerializer.parse({ logic: 'or' })).toEqual({ state: { filters: [], logic: 'or' }, issues: [] });
        });
    });

    describe('URI encoding', () => {
        it('round-trip toURIParam → parseURIParam', () => {
            const state = makeState([makeCond('tag', 'includes', ['work'])]);
            const uri = FilterSerializer.toURIParam(state);
            expect(uri).not.toBe('');

            const restored = FilterSerializer.parseURIParam(uri).state;
            expect(restored.filters).toHaveLength(1);
            const c = restored.filters[0] as FilterCondition;
            expect(c.property).toBe('tag');
        });

        it('empty filter → empty string', () => {
            const state: FilterState = { filters: [], logic: 'and' };
            expect(FilterSerializer.toURIParam(state)).toBe('');
        });

        it('empty param → empty state', () => {
            const result = FilterSerializer.parseURIParam('').state;
            expect(result.filters).toHaveLength(0);
        });

        it('invalid param → empty state', () => {
            const result = FilterSerializer.parseURIParam('not-valid-base64!!!').state;
            expect(result.filters).toHaveLength(0);
        });
    });
});

// `kind` told inline tasks from file tasks. With frontmatter no longer making
// tasks it is gone, and saved views / pinned lists that still name it must
// load: the condition is dropped wherever it sits, and everything around it
// keeps its meaning.
describe('FilterSerializer.parse: retired kind conditions', () => {
    const tag = { property: 'tag', operator: 'includes', value: ['work'] };
    const kind = { property: 'kind', operator: 'includes', value: ['inline'] };

    it('drops a top-level kind condition and keeps the rest', () => {
        const state = FilterSerializer.parse({ logic: 'and', filters: [kind, tag] }).state;
        expect(state).toEqual({ logic: 'and', filters: [tag] });
    });

    it('drops a lone single-condition kind filter to an empty state', () => {
        expect(FilterSerializer.parse(kind).state).toEqual({ logic: 'and', filters: [] });
    });

    it('drops kind inside nested groups', () => {
        const { state, issues } = FilterSerializer.parse({
            logic: 'and',
            filters: [{ logic: 'or', filters: [tag, { logic: 'and', filters: [kind, tag] }] }],
        });
        expect(issues).toEqual([]);
        expect(state).toEqual({
            logic: 'and',
            filters: [{ logic: 'or', filters: [tag, { logic: 'and', filters: [tag] }] }],
        });
    });

    // An OR group whose only condition was kind becomes empty. An empty group
    // evaluates as true, so the AND around it still filters on the tag alone.
    it('leaves an emptied OR group empty, and the AND beside it intact', () => {
        const state = FilterSerializer.parse({
            logic: 'and',
            filters: [{ logic: 'or', filters: [kind] }, tag],
        }).state;
        expect(state).toEqual({ logic: 'and', filters: [{ logic: 'or', filters: [] }, tag] });

        const task = (tags: string[]) => makeTask({ tags }) as unknown as DisplayTask;
        expect(evaluateFilter(task(['work']), state)).toBe(true);
        expect(evaluateFilter(task(['home']), state)).toBe(false);
    });
});

// The one reader: a condition keeps its place only when the engine can
// evaluate it — a known property, an operator of that property, a value of
// the shape the filter menu writes. Anything else is dropped and told.
describe('FilterSerializer.parse: what a condition must be', () => {
    const read = (c: Record<string, unknown>) => FilterSerializer.parse({ logic: 'and', filters: [c] });
    const kept = (c: Record<string, unknown>) => {
        const r = read(c);
        expect(r.issues).toEqual([]);
        return r.state.filters[0];
    };
    const reason = (c: Record<string, unknown>) => {
        const r = read(c);
        expect(r.state.filters).toEqual([]);
        return r.issues.map(i => `${i.at}: ${i.reason}`).join('; ');
    };

    it.each([
        [{ property: 'nope', operator: 'includes' }, /^filters\[0\]: Unknown filter property: nope\. Available: file, tag/],
        [{ property: 'tag', operator: 'contains', value: ['a'] }, /Invalid operator 'contains' for filter property 'tag'\. Available: includes, excludes, equals, only/],
        [{ property: 'file', operator: 'includes', value: 'a.md' }, /'file' takes a list of strings/],
        [{ property: 'tag', operator: 'includes', value: ['a', 1] }, /'tag' takes a list of strings/],
        [{ property: 'content', operator: 'contains', value: ['a'] }, /'content' takes text/],
        [{ property: 'length', operator: 'lessThan', value: '2' }, /'length' takes a number/],
        [{ property: 'length', operator: 'lessThan', value: 2, unit: 'days' }, /Invalid unit 'days' for 'length'/],
        [{ property: 'due', operator: 'equals', value: '2026-02-30' }, /'due' takes a date that exists/],
        [{ property: 'due', operator: 'equals', value: '2026/03/01' }, /'due' takes a date that exists/],
        [{ property: 'startDate', operator: 'after', value: { preset: 'tomorrow' } }, /'startDate' takes a date that exists/],
        [{ property: 'due', operator: 'equals', value: { preset: 'nextNDays', n: 0 } }, /'due' takes a date that exists/],
        [{ property: 'property', operator: 'equals', key: 3, value: 'x' }, /'property' takes a key that is text/],
        [{ property: 'tag', operator: 'includes', value: ['a'], target: 'child' }, /Invalid target 'child'\. Use self or parent/],
    ])('drops %j', (c, expected) => {
        expect(reason(c)).toMatch(expected);
    });

    it('drops a child that is neither a condition nor a group', () => {
        const r = FilterSerializer.parse({ logic: 'and', filters: ['tag', { logic: 'or', filters: [null] }] });
        expect(r.state).toEqual({ logic: 'and', filters: [{ logic: 'or', filters: [] }] });
        expect(r.issues).toEqual([
            { at: 'filters[0]', reason: 'not a condition or a group' },
            { at: 'filters[1].filters[0]', reason: 'not a condition or a group' },
        ]);
    });

    // A value not chosen yet is a row a user left unfinished: kept as it was
    // saved, constraining nothing.
    it.each([
        { property: 'tag', operator: 'includes', value: [] },
        { property: 'due', operator: 'equals' },
        { property: 'due', operator: 'equals', value: '' },
        { property: 'length', operator: 'greaterThan' },
        { property: 'property', operator: 'equals', key: '', value: '' },
    ])('keeps the unfinished %j', c => {
        expect(kept(c)).toEqual(c);
    });

    it('drops a value an operator does not take, and keys a property does not take', () => {
        expect(kept({ property: 'due', operator: 'isSet', value: '2026-03-01' })).toEqual({ property: 'due', operator: 'isSet' });
        expect(kept({ property: 'tag', operator: 'includes', value: ['a'], key: 'k', unit: 'hours' }))
            .toEqual({ property: 'tag', operator: 'includes', value: ['a'] });
        expect(kept({ property: 'tag', operator: 'includes', value: ['a'], target: 'self' }))
            .toEqual({ property: 'tag', operator: 'includes', value: ['a'] });
    });

    // The saved shape does not change: what the menu wrote reads back and
    // writes out as the same JSON, negative operators and the parent target
    // included.
    it('round-trips every saved shape the menu writes', () => {
        const saved = {
            logic: 'or',
            filters: [
                { property: 'tag', operator: 'excludes', value: ['sub'], target: 'parent' },
                { property: 'content', operator: 'notContains', value: 'draft' },
                { property: 'due', operator: 'isNotSet', target: 'parent' },
                { logic: 'and', filters: [
                    { property: 'startDate', operator: 'onOrAfter', value: { preset: 'nextNDays', n: 3 } },
                    { property: 'endDate', operator: 'before', value: '2026-03-01' },
                    { property: 'length', operator: 'greaterThanOrEqual', value: 1.5, unit: 'minutes' },
                    { property: 'property', operator: 'notContains', key: 'owner', value: 'me' },
                    { property: 'notation', operator: 'includes', value: ['tv-inline'] },
                    { property: 'children', operator: 'isSet' },
                ] },
            ],
        };
        const { state, issues } = FilterSerializer.parse(saved);
        expect(issues).toEqual([]);
        expect(FilterSerializer.toJSON(state)).toEqual(saved);
    });
});
