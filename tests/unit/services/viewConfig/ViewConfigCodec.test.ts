import { describe, it, expect } from 'vitest';
import {
    F,
    T,
    ViewConfigCodec,
    type ViewSchema,
} from '../../../../src/services/viewConfig';
import type { ViewType } from '../../../../src/views/ViewDescriptors';
import type { ConfigIssue } from '../../../../src/services/viewConfig/ViewConfigSchema';
import type { FilterState } from '../../../../src/services/filter/FilterTypes';
import { unicodeBtoa } from '../../../../src/utils/base64';
import { listFrame, type PinnedListDefinition, type SidebarFrame, type AstronomyDisplay } from '../../../../src/types';

interface TestConfig {
    name?: string;
    enabled?: boolean;
    count?: number;
    rate?: number;
    span?: number;
    filter?: FilterState;
    pins?: SidebarFrame[];
    grid?: PinnedListDefinition[][];
    sky?: Partial<AstronomyDisplay>;
    cursor?: string;
}

interface TestTransient {
    date?: string;
    expanded?: boolean;
    collapsed?: Record<string, boolean>;
}

const SCHEMA: ViewSchema<TestConfig, TestTransient> = {
    // Not a view of the plugin: the codec reads only the fields.
    viewType: 'test-view' as ViewType,
    shortName: 'test',
    defaults: { count: 3, rate: 1.0, enabled: false },
    config: {
        name: F.optionalString('name'),
        enabled: F.boolean('enabled'),
        count: F.int('count', { min: 1, max: 7, legacyKeys: ['days'] }),
        rate: F.float('rate', { min: 0.25, max: 10, legacyKeys: ['zoom'] }),
        span: F.int('span', { min: 1, max: 30, legacyKeys: ['spanLegacy'] }),
        filter: F.filter('filter', { legacyKeys: ['filterState'] }),
        pins: F.sidebarFrames('pins'),
        grid: F.grid('grid'),
        sky: F.astronomyDisplay('sky', { legacyKeys: ['astronomyDisplay'] }),
        cursor: F.dateString('cursor'),
    },
    transient: {
        date: T.dateString('date'),
        expanded: T.boolean('expanded'),
        collapsed: T.collapsedKeys('collapsed', 'test'),
    },
};

const codec = new ViewConfigCodec(SCHEMA);

const fullFixture: TestConfig = {
    name: 'pilot',
    enabled: true,
    count: 7,
    rate: 1.5,
    span: 10,
    filter: {
        filters: [{ property: 'tag', operator: 'includes', value: ['x'] }],
        logic: 'and',
    },
    pins: [{
        kind: 'list',
        id: 'pl-1',
        name: 'Today',
        filterState: { filters: [{ property: 'due', operator: 'equals', value: '2026-05-22' }], logic: 'and' },
        applyViewFilter: false,
    }],
    grid: [[{
        id: 'g-1',
        name: 'Col A',
        filterState: { filters: [{ property: 'status', operator: 'includes', value: [' '] }], logic: 'and' },
        applyViewFilter: true,
    }]],
    sky: { sunTimes: true, moonPhase: true },
    cursor: '2026-05-22',
};

describe('ViewConfigCodec', () => {
    describe('config round-trip', () => {
        it('serializeConfig → parseConfig preserves all fields', () => {
            const json = codec.serializeConfig(fullFixture);
            const back = codec.parseConfig(json);
            expect(back).toEqual(fullFixture);
        });

        it('parseConfig drops a filter condition or a sort rule it cannot read, and reports where', () => {
            const issues: ConfigIssue[] = [];
            const back = codec.parseConfig({
                filter: { logic: 'and', filters: [
                    { property: 'tag', operator: 'includes', value: ['x'] },
                    { property: 'tagg', operator: 'includes', value: ['x'] },
                ] },
                grid: [[{
                    id: 'g-1', name: 'A', applyViewFilter: false,
                    filterState: { logic: 'and', filters: [
                        { property: 'status', operator: 'equals', value: ' ' },
                        { property: 'due', operator: 'isSet' },
                    ] },
                    sortState: { rules: [{ property: 'due', direction: 'up' }, { id: 's-1', property: 'file', direction: 'desc' }] },
                }]],
            }, issues);
            expect(back.filter?.filters).toEqual([{ property: 'tag', operator: 'includes', value: ['x'] }]);
            expect(back.grid?.[0][0].filterState.filters).toEqual([{ property: 'due', operator: 'isSet' }]);
            expect(back.grid?.[0][0].sortState).toEqual({ rules: [{ property: 'file', direction: 'desc' }] });
            expect(issues).toEqual([
                { field: 'filter', text: expect.stringMatching(/^filters\[1\]: Unknown filter property: tagg/) },
                { field: 'grid', text: `list "A" filters[0]: Invalid operator 'equals' for filter property 'status'. Available: includes, excludes` },
                { field: 'grid', text: 'list "A" sort rules[0]: Invalid sort direction: up. Use asc or desc' },
            ]);
        });

        it('fromUriParams reports what it dropped too', () => {
            const issues: ConfigIssue[] = [];
            const uri = codec.toUriParams({ filter: { logic: 'and', filters: [{ property: 'content', operator: 'contains', value: 'a' }] } });
            const bad = codec.toUriParams({ filter: { logic: 'and', filters: [{ property: 'content', operator: 'contains', value: 3 as never }] } });
            expect(codec.fromUriParams(uri, issues).filter?.filters).toHaveLength(1);
            expect(codec.fromUriParams(bad, issues).filter).toBeUndefined();
            expect(issues).toEqual([{ field: 'filter', text: "filters[0]: 'content' takes text" }]);
        });

        it('serializeConfig omits undefined fields', () => {
            const partial: TestConfig = { name: 'x' };
            const json = codec.serializeConfig(partial);
            expect(Object.keys(json).sort()).toEqual(['name']);
        });

        it('serializeConfig drops empty filter state (no conditions)', () => {
            const empty: TestConfig = { filter: { filters: [], logic: 'and' } };
            const json = codec.serializeConfig(empty);
            expect(json.filter).toBeUndefined();
        });

        it('serializeConfig drops empty astronomyDisplay', () => {
            const empty: TestConfig = { sky: {} };
            const json = codec.serializeConfig(empty);
            expect(json.sky).toBeUndefined();
        });

        it('parseConfig ignores unrelated keys', () => {
            const cfg = codec.parseConfig({ foo: 'bar', baz: 123 });
            expect(cfg).toEqual({});
        });
    });

    describe('applyViewFilter is always a boolean past the codec', () => {
        const list = { id: 'pl-1', name: 'L', filterState: { filters: [], logic: 'and' } };

        it('a list saved without the key reads as false', () => {
            expect(F.sidebarFrames('pins').parse([list])?.[0]).toMatchObject({ kind: 'list', applyViewFilter: false });
            expect(F.grid('grid').parse([[list]])?.[0][0].applyViewFilter).toBe(false);
        });

        it('a value that is not a boolean reads as false', () => {
            expect(F.sidebarFrames('pins').parse([{ ...list, applyViewFilter: 'yes' }])?.[0]).toMatchObject({ kind: 'list', applyViewFilter: false });
        });

        it('false is written, not omitted', () => {
            const json = codec.serializeConfig({ pins: [listFrame({ ...list, applyViewFilter: false } as PinnedListDefinition)] });
            expect((json.pins as Record<string, unknown>[])[0].applyViewFilter).toBe(false);
        });
    });

    describe('the frames of a sidebar', () => {
        const pins = F.sidebarFrames('pins');
        // Two lists as they are stored, the second with every field a list can hold.
        const today = {
            id: 'pl-1',
            name: 'Today',
            filterState: { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: ['x'] }] },
            applyViewFilter: false,
        };
        const next = {
            id: 'pl-2',
            name: 'Next',
            filterState: { logic: 'and', filters: [{ property: 'parent', operator: 'isNotSet' }] },
            applyViewFilter: true,
            sortState: { rules: [{ property: 'due', direction: 'asc' }] },
            topRight: { fields: ['due'], separator: ' ', prefix: '(', suffix: ')' },
        };

        it('an entry stored without a kind is read as a list frame', () => {
            expect(pins.parse([today, next])).toEqual([
                { kind: 'list', ...today },
                { kind: 'list', ...next },
            ]);
        });

        it("an entry of the kind 'list' is read as the same frame", () => {
            expect(pins.parse([{ kind: 'list', ...today }])).toEqual(pins.parse([today]));
            expect(pins.parse([{ ...today, kind: 'list' }])).toEqual([{ kind: 'list', ...today }]);
        });

        it('an entry of a kind that is not known is skipped without a report, and the lists around it are kept', () => {
            const note = { kind: 'note', id: 'n-1', name: 'Memo', path: 'Dashboard.md' };
            // Readable as a list but for its kind: the kind decides.
            const listLike = { ...today, kind: 'note', id: 'n-2', name: 'Not a list' };
            const noKind = { ...today, kind: null, id: 'n-3', name: 'Null kind' };
            const reported: string[] = [];
            const frames = pins.parse([today, note, listLike, noKind, next], text => reported.push(text));
            expect(frames?.map(f => f.id)).toEqual(['pl-1', 'pl-2']);
            expect(reported).toEqual([]);
            expect(pins.parse([note])).toBeUndefined();
        });

        it('a list frame is written as the list alone: what was read is written back as it was stored', () => {
            const stored = [today, next];
            const written = pins.serialize(pins.parse(stored));
            expect(JSON.stringify(written)).toBe(JSON.stringify(stored));
            expect(JSON.stringify(pins.serialize(pins.parse([{ kind: 'list', ...today }])))).toBe(JSON.stringify([today]));
        });

        it('a URI carries the same form, and is read as the stored form is', () => {
            const frames = pins.parse([today, next])!;
            const param = pins.toUriParam!(frames);
            expect(param).toBe(unicodeBtoa(JSON.stringify([today, next])));
            expect(pins.fromUriParam!(param!)).toEqual(frames);
            const withUnknown = unicodeBtoa(JSON.stringify([{ kind: 'note', id: 'n-1', name: 'Memo' }, next]));
            expect(pins.fromUriParam!(withUnknown)?.map(f => f.id)).toEqual(['pl-2']);
        });

        describe('a markdown frame', () => {
            const memo = { kind: 'markdown', id: 'md-1', link: 'Folder/Note#Parent#Memo' };
            const whole = { kind: 'markdown', id: 'md-2', link: 'Dashboard' };

            it('is read as its kind, its id and its link, and written back as it was stored', () => {
                const frames = pins.parse([memo, whole]);
                expect(frames).toEqual([memo, whole]);
                expect(JSON.stringify(pins.serialize(frames))).toBe(JSON.stringify([memo, whole]));
            });

            it('keeps nothing else an entry holds', () => {
                const frames = pins.parse([{ ...memo, name: 'Memo', filterState: today.filterState }]);
                expect(frames).toEqual([memo]);
            });

            it('is skipped, and the reason reported, when its link is missing, is not a text, or names no note', () => {
                const reported: string[] = [];
                const frames = pins.parse([
                    { kind: 'markdown', id: 'a' },
                    { kind: 'markdown', id: 'b', link: '' },
                    { kind: 'markdown', id: 'c', link: 3 },
                    { kind: 'markdown', id: 'd', link: null },
                    { kind: 'markdown', id: 'e', link: '#Heading' },
                    { kind: 'markdown', link: '#' },
                    whole,
                ], text => reported.push(text));
                expect(frames).toEqual([whole]);
                expect(reported).toEqual([
                    'markdown frame "a" link: missing',
                    'markdown frame "b" link: "" names no note',
                    'markdown frame "c" link: not a text',
                    'markdown frame "d" link: not a text',
                    'markdown frame "e" link: "#Heading" names no note',
                    'markdown frame link: "#" names no note',
                ]);
                expect(pins.parse([{ kind: 'markdown', id: 'a' }])).toBeUndefined();
            });

            it('names no note with a heading alone, and names one with a note before the heading', () => {
                expect(pins.parse([{ kind: 'markdown', id: 'h', link: '#Memo' }])).toBeUndefined();
                expect(pins.parse([{ kind: 'markdown', id: 'h', link: 'Note#Memo' }])).toEqual([{ kind: 'markdown', id: 'h', link: 'Note#Memo' }]);
            });

            it('is reported through the config it is read with, under its field', () => {
                const issues: ConfigIssue[] = [];
                codec.parseConfig({ pins: [{ kind: 'markdown', id: 'a', link: 3 }, whole] }, issues);
                expect(issues).toEqual([{ field: 'pins', text: 'markdown frame "a" link: not a text' }]);
            });

            it('stored without an id is given one of its own', () => {
                const frames = pins.parse([{ kind: 'markdown', link: 'A' }, { kind: 'markdown', id: '', link: 'B' }])!;
                expect(frames.map(f => f.kind === 'markdown' && f.link)).toEqual(['A', 'B']);
                expect(frames[0].id).toBeTruthy();
                expect(frames[1].id).toBeTruthy();
                expect(frames[0].id).not.toBe(frames[1].id);
            });

            it('keeps its place among the lists, each written in its own form', () => {
                const stored = [memo, today, whole, next];
                const frames = pins.parse(stored)!;
                expect(frames.map(f => f.id)).toEqual(['md-1', 'pl-1', 'md-2', 'pl-2']);
                expect(frames.map(f => f.kind)).toEqual(['markdown', 'list', 'markdown', 'list']);
                expect(JSON.stringify(pins.serialize(frames))).toBe(JSON.stringify(stored));
            });

            it('is carried by a URI in the stored form, and read back', () => {
                const frames = pins.parse([today, memo, whole])!;
                const param = pins.toUriParam!(frames);
                expect(param).toBe(unicodeBtoa(JSON.stringify([today, memo, whole])));
                expect(pins.fromUriParam!(param!)).toEqual(frames);
                const japanese = { kind: 'markdown', id: 'md-3', link: 'SyncIgnore/見本#メモ' };
                expect(pins.fromUriParam!(pins.toUriParam!(pins.parse([japanese])!)!)).toEqual([japanese]);
            });

            it("is no cell of Kanban's grid", () => {
                expect(F.grid('grid').parse([[memo, today]])).toEqual([[today]]);
            });
        });

        describe('ids', () => {
            const memo = { kind: 'markdown', id: 'pl-1', link: 'Folder/Note#Memo' };

            it('a frame stored under the id of a frame of its kind before it is kept, under a new id of its kind', () => {
                const frames = pins.parse([today, { ...next, id: 'pl-1' }, today])!;
                expect(frames.map(f => f.kind === 'list' && f.name)).toEqual(['Today', 'Next', 'Today']);
                expect(frames[0].id).toBe('pl-1');
                expect(new Set(frames.map(f => f.id)).size).toBe(3);
                expect(frames[1].id).toMatch(/^list-/);
                expect(frames[2].id).toMatch(/^list-/);

                const twice = pins.parse([{ ...memo, id: 'md-1' }, { ...memo, id: 'md-1' }])!;
                expect(twice.map(f => f.kind === 'markdown' && f.link)).toEqual(['Folder/Note#Memo', 'Folder/Note#Memo']);
                expect(twice[0].id).toBe('md-1');
                expect(twice[1].id).toMatch(/^md-/);
                expect(twice[1].id).not.toBe('md-1');
            });

            it('a frame stored under the id of a frame of another kind is kept, under a new id of its own kind', () => {
                const frames = pins.parse([today, memo])!;
                expect(frames.map(f => f.kind)).toEqual(['list', 'markdown']);
                expect(frames[0].id).toBe('pl-1');
                expect(frames[1].id).toMatch(/^md-/);

                const listAfter = pins.parse([memo, today])!;
                expect(listAfter[0].id).toBe('pl-1');
                expect(listAfter[1].id).toMatch(/^list-/);
            });

            it('frames of ids of their own keep them, and so does every road the sidebar is read by', () => {
                const stored = [today, { ...memo, id: 'md-1' }, next];
                expect(pins.parse(stored)!.map(f => f.id)).toEqual(['pl-1', 'md-1', 'pl-2']);
                expect(pins.fromUriParam!(unicodeBtoa(JSON.stringify(stored)))!.map(f => f.id)).toEqual(['pl-1', 'md-1', 'pl-2']);

                const repeated = [today, memo];
                const ids = (frames: SidebarFrame[] | undefined) => frames?.map(f => f.id) ?? [];
                // The sidebar's field as Timeline and Calendar declare it, read under its older key too.
                const sidebar = new ViewConfigCodec<{ sidebar?: SidebarFrame[] }>({
                    viewType: 'test-view' as ViewType,
                    shortName: 'test',
                    defaults: {},
                    config: { sidebar: F.sidebarFrames('sidebar', { legacyKeys: ['pinnedLists'] }) },
                    transient: {},
                });
                for (const frames of [
                    pins.fromUriParam!(unicodeBtoa(JSON.stringify(repeated))),
                    sidebar.parseConfig({ sidebar: repeated }).sidebar,
                    sidebar.parseConfig({ pinnedLists: repeated }).sidebar,
                    sidebar.fromUriParams({ pinnedLists: unicodeBtoa(JSON.stringify(repeated)) }).sidebar,
                ]) {
                    expect(new Set(ids(frames)).size).toBe(2);
                    expect(ids(frames)[0]).toBe('pl-1');
                }
            });

            it("leaves Kanban's cells as they are stored", () => {
                expect(F.grid('grid').parse([[today, today]])).toEqual([[today, today]]);
            });
        });

        it("Kanban's cells are lists, not frames: a cell is read without a kind, whatever the entry says", () => {
            const cells = F.grid('grid').parse([[today, { ...next, kind: 'note' }]]);
            expect(cells).toEqual([[today, next]]);
            expect(cells?.[0][0]).not.toHaveProperty('kind');
            expect(JSON.stringify(F.grid('grid').serialize(cells))).toBe(JSON.stringify([[today, next]]));
        });
    });

    describe('URI round-trip', () => {
        it('toUriParams → fromUriParams preserves all fields', () => {
            const params = codec.toUriParams(fullFixture);
            const back = codec.fromUriParams(params);
            expect(back).toEqual(fullFixture);
        });

        it('toUriParams encodes boolean as "true"/"false"', () => {
            const params = codec.toUriParams({ enabled: true });
            expect(params.enabled).toBe('true');
        });

        it('toUriParams emits filter as base64 only when conditions exist', () => {
            const empty = codec.toUriParams({ filter: { filters: [], logic: 'and' } });
            expect(empty.filter).toBeUndefined();
            const populated = codec.toUriParams({
                filter: { filters: [{ property: 'tag', operator: 'includes', value: ['x'] }], logic: 'and' },
            });
            expect(typeof populated.filter).toBe('string');
            expect(populated.filter!.length).toBeGreaterThan(0);
        });

        it('fromUriParams ignores invalid base64', () => {
            const back = codec.fromUriParams({ filter: 'not-base64!@#$' });
            expect(back.filter).toBeUndefined();
        });
    });

    describe('legacyKeys', () => {
        it('parseConfig reads legacy "days" into count', () => {
            const cfg = codec.parseConfig({ days: 7 });
            expect(cfg.count).toBe(7);
        });

        it('parseConfig reads legacy "zoom" into rate', () => {
            const cfg = codec.parseConfig({ zoom: 2.5 });
            expect(cfg.rate).toBe(2.5);
        });

        it('parseConfig reads legacy "spanLegacy" into span', () => {
            const cfg = codec.parseConfig({ spanLegacy: 10 });
            expect(cfg.span).toBe(10);
        });

        it('parseConfig reads legacy "filterState" into filter', () => {
            const cfg = codec.parseConfig({
                filterState: { filters: [{ property: 'tag', operator: 'includes', value: ['x'] }], logic: 'and' },
            });
            expect(cfg.filter).toBeDefined();
            expect(cfg.filter!.logic).toBe('and');
        });

        it('parseConfig reads legacy "astronomyDisplay" into sky', () => {
            const cfg = codec.parseConfig({ astronomyDisplay: { moonPhase: true } });
            expect(cfg.sky).toEqual({ moonPhase: true });
        });

        it('canonical key wins over legacy when both present', () => {
            const cfg = codec.parseConfig({ count: 3, days: 7 });
            expect(cfg.count).toBe(3);
        });

        it('serializeConfig always uses canonical key (not legacy)', () => {
            const json = codec.serializeConfig({ count: 3, rate: 1 });
            expect(json.count).toBe(3);
            expect(json.days).toBeUndefined();
            expect(json.rate).toBe(1);
            expect(json.zoom).toBeUndefined();
        });

        it('fromUriParams accepts legacy short URI param names', () => {
            const cfg = codec.fromUriParams({ days: '3', zoom: '1.5' });
            expect(cfg.count).toBe(3);
            expect(cfg.rate).toBe(1.5);
        });
    });

    describe('validation', () => {
        it('float clamps with min/max', () => {
            expect(codec.parseConfig({ rate: 0.1 }).rate).toBeUndefined();
            expect(codec.parseConfig({ rate: 20 }).rate).toBeUndefined();
            expect(codec.parseConfig({ rate: 1 }).rate).toBe(1);
        });

        it('int rejects values outside min/max', () => {
            expect(codec.parseConfig({ span: 0 }).span).toBeUndefined();
            expect(codec.parseConfig({ span: 31 }).span).toBeUndefined();
            expect(codec.parseConfig({ span: 1 }).span).toBe(1);
            expect(codec.parseConfig({ span: 30 }).span).toBe(30);
        });

        it('int rejects non-integer values', () => {
            expect(codec.parseConfig({ span: 5.5 }).span).toBeUndefined();
            expect(codec.parseConfig({ span: 5 }).span).toBe(5);
        });

        it('int fromUriParam parses and rejects the same as parseConfig', () => {
            expect(codec.fromUriParams({ span: '10' }).span).toBe(10);
            expect(codec.fromUriParams({ span: '31' }).span).toBeUndefined();
            expect(codec.fromUriParams({ span: 'abc' }).span).toBeUndefined();
        });

        it('int rejects string input that Number() would parse but is not a plain decimal integer', () => {
            // Number() alone accepts hex and exponent notation as valid
            // integers — this field should not. parseInt would take a
            // leading number out of '3days'.
            expect(codec.fromUriParams({ span: '0x10' }).span).toBeUndefined();
            expect(codec.fromUriParams({ span: '1e1' }).span).toBeUndefined();
            expect(codec.fromUriParams({ span: '3days' }).span).toBeUndefined();
            expect(codec.parseConfig({ span: '0x10' }).span).toBeUndefined();
            expect(codec.parseConfig({ span: '1e1' }).span).toBeUndefined();
        });

        it('int reads typed text as the input codec does: space around it and full-width digits', () => {
            // A URI carries text a person typed.
            expect(codec.fromUriParams({ span: ' 5 ' }).span).toBe(5);
            expect(codec.fromUriParams({ span: '１２' }).span).toBe(12);
            expect(codec.parseConfig({ span: ' 5 ' }).span).toBe(5);
        });

        it('float reads only a decimal number (no parseFloat prefix)', () => {
            expect(codec.fromUriParams({ rate: '1.5' }).rate).toBe(1.5);
            expect(codec.fromUriParams({ rate: '1.5x' }).rate).toBeUndefined();
            expect(codec.fromUriParams({ rate: '2e0' }).rate).toBeUndefined();
            expect(codec.parseConfig({ rate: '1.5x' }).rate).toBeUndefined();
        });

        it('dateString rejects malformed input', () => {
            expect(codec.parseConfig({ cursor: 'not-a-date' }).cursor).toBeUndefined();
            expect(codec.parseConfig({ cursor: '2026-05-22' }).cursor).toBe('2026-05-22');
        });

        it('dateString reads only a day that exists, from the URI and the stored state alike', () => {
            expect(codec.fromUriParams({ cursor: '2026-02-30' }).cursor).toBeUndefined();
            expect(codec.fromUriParams({ cursor: '2026-13-45' }).cursor).toBeUndefined();
            expect(codec.parseConfig({ cursor: '2026-02-30' }).cursor).toBeUndefined();
            expect(codec.parseTransient({ date: '2026-02-30' }).date).toBeUndefined();
            expect(codec.parseTransient({ date: '2026-02-28' }).date).toBe('2026-02-28');
        });

        it('dateString reads full-width digits and hyphen-like characters as the date', () => {
            expect(codec.fromUriParams({ cursor: '２０２６－０５－２２' }).cursor).toBe('2026-05-22');
            expect(codec.fromUriParams({ cursor: '2026ー05ー22' }).cursor).toBe('2026-05-22');
        });

        it('boolean reads true and false around space, and nothing else', () => {
            expect(codec.fromUriParams({ enabled: ' true ' }).enabled).toBe(true);
            expect(codec.fromUriParams({ enabled: 'yes' }).enabled).toBeUndefined();
        });

        it('astronomyDisplay strips unknown keys', () => {
            const cfg = codec.parseConfig({
                sky: { sunTimes: true, moonPhase: false, evil: 'injection' },
            });
            expect(cfg.sky).toEqual({ sunTimes: true, moonPhase: false });
        });

        it('optionalString rejects whitespace-only', () => {
            expect(codec.parseConfig({ name: '   ' }).name).toBeUndefined();
            expect(codec.parseConfig({ name: 'x' }).name).toBe('x');
        });
    });

    describe('transient', () => {
        it('parseTransient + serializeTransient round-trip', () => {
            const transient: TestTransient = {
                date: '2026-05-22',
                expanded: true,
                collapsed: { a: true, b: true },
            };
            const json = codec.serializeTransient(transient);
            const back = codec.parseTransient(json);
            expect(back).toEqual(transient);
        });

        it("collapsedKeys reads a key saved with the view's name as the list id, and drops another view's", () => {
            const json = { collapsed: { 'a': true, 'test::b': true, 'other::c': true } };
            const back = codec.parseTransient(json);
            expect(back.collapsed).toEqual({ a: true, b: true });
        });

        it('collapsedKeys drops false entries', () => {
            const json = codec.serializeTransient({ collapsed: { a: true, b: false } });
            expect(json.collapsed).toEqual({ a: true });
        });

        it('transient stays separate from config', () => {
            const configJson = codec.serializeConfig({ name: 'x' } as TestConfig);
            expect(configJson.date).toBeUndefined();
            expect(configJson.expanded).toBeUndefined();
            expect(configJson.collapsed).toBeUndefined();
        });
    });

    describe('null/undefined safety', () => {
        it('parseConfig handles null/undefined', () => {
            expect(codec.parseConfig(null)).toEqual({});
            expect(codec.parseConfig(undefined)).toEqual({});
        });

        it('serializeConfig handles null/undefined', () => {
            expect(codec.serializeConfig(null)).toEqual({});
            expect(codec.serializeConfig(undefined)).toEqual({});
        });

        it('toUriParams handles null/undefined', () => {
            expect(codec.toUriParams(null)).toEqual({});
            expect(codec.toUriParams(undefined)).toEqual({});
        });

        it('fromUriParams handles null/undefined', () => {
            expect(codec.fromUriParams(null)).toEqual({});
            expect(codec.fromUriParams(undefined)).toEqual({});
        });
    });
});

describe('SchemaRegistry', () => {
    describe('withDefaults (REPLACE-over-defaults)', () => {
        it('keeps every field the caller supplied', () => {
            const merged = codec.withDefaults({ count: 7, rate: 2.0, name: 'pilot' });
            expect(merged.count).toBe(7);
            expect(merged.rate).toBe(2.0);
            expect(merged.name).toBe('pilot');
        });

        it('restores schema defaults for fields the caller omitted', () => {
            // The whole point of REPLACE: an omitted field reverts to its
            // declared default instead of keeping whatever was there before.
            const merged = codec.withDefaults({ name: 'pilot' });
            expect(merged.count).toBe(3);
            expect(merged.rate).toBe(1.0);
            expect(merged.enabled).toBe(false);
        });

        it('leaves fields with no declared default undefined', () => {
            const merged = codec.withDefaults({ count: 1 });
            expect(merged.name).toBeUndefined();
            expect(merged.filter).toBeUndefined();
        });

        it('emits a key for every declared field, defaulted or not', () => {
            // Views that apply the result with Object.assign rely on this: a
            // key that is simply absent would leave the previous value in
            // place, so a field with no default would never clear.
            const merged = codec.withDefaults({ count: 1 });
            expect(Object.keys(merged).sort()).toEqual(Object.keys(SCHEMA.config).sort());
            expect('name' in merged).toBe(true);
            expect('filter' in merged).toBe(true);
        });

        it('clears a previously held value when the field is absent from cfg', () => {
            const held = { name: 'stale', count: 7, rate: 2.0 };
            Object.assign(held, codec.withDefaults({ count: 1 }));
            expect(held.name).toBeUndefined();
            expect(held.count).toBe(1);
            expect(held.rate).toBe(1.0);
        });

        it('lets an explicit undefined win over the default', () => {
            const merged = codec.withDefaults({ count: undefined });
            expect('count' in merged).toBe(true);
            expect(merged.count).toBeUndefined();
        });

        it('treats a missing config as "all defaults"', () => {
            expect(codec.withDefaults({})).toEqual(SCHEMA.defaults);
            expect(codec.withDefaults(undefined)).toEqual(SCHEMA.defaults);
            expect(codec.withDefaults(null)).toEqual(SCHEMA.defaults);
        });

        it('does not hand out the schema defaults object itself', () => {
            const merged = codec.withDefaults({});
            expect(merged).not.toBe(SCHEMA.defaults);
            merged.count = 7;
            expect(SCHEMA.defaults.count).toBe(3);
        });
    });

    it('codecFor unknown viewType returns undefined', async () => {
        const { codecFor } = await import('../../../../src/services/viewConfig');
        expect(codecFor('nonexistent-view')).toBeUndefined();
    });
});
