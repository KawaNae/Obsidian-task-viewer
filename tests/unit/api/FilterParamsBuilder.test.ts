import { describe, it, expect } from 'vitest';
import type { App } from 'obsidian';
import { resolveQuery } from '../../../src/api/FilterParamsBuilder';
import type { FilterState } from '../../../src/services/filter/FilterTypes';

function appHolding(files: Record<string, string> = {}): App {
    return {
        vault: {
            adapter: {
                exists: async (p: string) => p in files,
                read: async (p: string) => files[p],
            },
        },
    } as unknown as App;
}

const statusX: FilterState = { filters: [{ property: 'status', operator: 'includes', value: ['x'] }], logic: 'and' };
const tagHome: FilterState = { filters: [{ property: 'tag', operator: 'includes', value: ['home'] }], logic: 'or' };

describe('resolveQuery: every param taken together', () => {
    it('names no filter when the params name none', async () => {
        expect(await resolveQuery(appHolding(), {})).toEqual({ filter: null, includeInvalid: true });
    });

    it('gives the shorthand as one and-group', async () => {
        const { filter } = await resolveQuery(appHolding(), { status: 'x', date: '2026-03-01' });
        expect(filter).toEqual({
            logic: 'and',
            filters: [
                { property: 'status', operator: 'includes', value: ['x'] },
                { property: 'period', operator: 'overlaps', value: '2026-03-01' },
            ],
        });
    });

    it('gives filter as it is when nothing else is given', async () => {
        const empty = { filters: [], logic: 'or' as const };
        expect((await resolveQuery(appHolding(), { filter: empty })).filter).toEqual(empty);
        expect((await resolveQuery(appHolding(), { filter: statusX })).filter).toEqual(statusX);
    });

    it('takes filter and the shorthand together, filter first', async () => {
        const { filter } = await resolveQuery(appHolding(), { filter: tagHome, status: 'x', date: 'today' });
        expect(filter).toEqual({
            logic: 'and',
            filters: [
                tagHome,
                { property: 'status', operator: 'includes', value: ['x'] },
                { property: 'period', operator: 'overlaps', value: { preset: 'today' } },
            ],
        });
    });

    it('reads, and so refuses, a shorthand value beside filter', async () => {
        await expect(resolveQuery(appHolding(), { filter: statusX, due: 'xyz' }))
            .rejects.toThrow(/Invalid date value for due: xyz/);
    });

    it('takes a filter file and the shorthand together, keeping the file\'s answer: no invalid tasks, its order', async () => {
        const app = appHolding({ 'f.json': JSON.stringify(statusX) });
        const query = await resolveQuery(app, { filterFile: 'f.json', tag: 'work' });
        expect(query.filter).toEqual({
            logic: 'and',
            filters: [statusX, { property: 'tag', operator: 'includes', value: ['work'] }],
        });
        expect(query.includeInvalid).toBe(false);
    });

    it('gives a filter file as it is when nothing else is given', async () => {
        const app = appHolding({ 'f.json': JSON.stringify(statusX) });
        expect(await resolveQuery(app, { filterFile: 'f.json' })).toEqual({ filter: statusX, includeInvalid: false });
    });

    it('takes filter and a filter file together, the file first', async () => {
        const app = appHolding({ 'f.json': JSON.stringify(statusX) });
        const query = await resolveQuery(app, { filterFile: 'f.json', filter: tagHome });
        expect(query.filter).toEqual({ logic: 'and', filters: [statusX, tagHome] });
        expect(query.includeInvalid).toBe(false);
    });

    it('refuses list without filterFile, the same for every query', async () => {
        await expect(resolveQuery(appHolding(), { list: 'a' }))
            .rejects.toThrow("'list' requires 'filterFile'");
    });

    it('checks a filter file as it checks filter', async () => {
        const app = appHolding({ 'bad.json': JSON.stringify({ filters: [{ property: 'nope', operator: 'equals' }], logic: 'and' }) });
        await expect(resolveQuery(app, { filterFile: 'bad.json' })).rejects.toThrow(/Unknown filter property/);
    });
});

describe('resolveQuery: filter read at the boundary (FilterSerializer.parse\'s issues are errors)', () => {
    const read = (filter: unknown) => resolveQuery(appHolding(), { filter: filter as FilterState });

    it('refuses an unknown property', async () => {
        await expect(read({ filters: [{ property: 'statuss', operator: 'includes' }], logic: 'and' }))
            .rejects.toThrow(/filters\[0\]: Unknown filter property: statuss/);
    });

    it('refuses an operator the property does not take', async () => {
        await expect(read({ filters: [{ property: 'status', operator: 'onOrAfter' }], logic: 'and' }))
            .rejects.toThrow(/Invalid operator 'onOrAfter' for filter property 'status'/);
    });

    it('refuses a value of the wrong shape (a string for a list, a day that does not exist)', async () => {
        await expect(read({ filters: [
            { property: 'tag', operator: 'includes', value: 'work' },
            { logic: 'or', filters: [{ property: 'due', operator: 'equals', value: '2026-02-30' }] },
        ], logic: 'and' })).rejects.toThrow(
            /Invalid filter: filters\[0\]: 'tag' takes a list of strings; filters\[1\]\.filters\[0\]: 'due' takes a date that exists/,
        );
    });
});
