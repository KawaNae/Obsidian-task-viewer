import { describe, it, expect } from 'vitest';
import {
    F,
    T,
    ViewConfigCodec,
    type ViewSchema,
} from '../../../../src/services/viewConfig';
import type { FilterState } from '../../../../src/services/filter/FilterTypes';
import type { PinnedListDefinition, AstronomyDisplay } from '../../../../src/types';

interface TestConfig {
    name?: string;
    enabled?: boolean;
    count?: 1 | 3 | 7;
    rate?: number;
    filter?: FilterState;
    pins?: PinnedListDefinition[];
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
    viewType: 'test-view',
    shortName: 'test',
    defaults: { count: 3, rate: 1.0, enabled: false },
    config: {
        name: F.optionalString('name'),
        enabled: F.boolean('enabled'),
        count: F.intEnum('count', [1, 3, 7], { legacyKeys: ['days'] }),
        rate: F.float('rate', { min: 0.25, max: 10, legacyKeys: ['zoom'] }),
        filter: F.filter('filter', { legacyKeys: ['filterState'] }),
        pins: F.pinnedLists('pins'),
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
    filter: {
        filters: [{ property: 'tag', operator: 'includes', value: ['x'] }],
        logic: 'and',
    },
    pins: [{
        id: 'pl-1',
        name: 'Today',
        filterState: { filters: [{ property: 'due', operator: 'equals', value: '2026-05-22' }], logic: 'and' },
        applyViewFilter: false,
    }],
    grid: [[{
        id: 'g-1',
        name: 'Col A',
        filterState: { filters: [{ property: 'status', operator: 'equals', value: ' ' }], logic: 'and' },
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
        it('intEnum rejects values outside allowed set', () => {
            expect(codec.parseConfig({ count: 5 }).count).toBeUndefined();
            expect(codec.parseConfig({ count: 1 }).count).toBe(1);
        });

        it('float clamps with min/max', () => {
            expect(codec.parseConfig({ rate: 0.1 }).rate).toBeUndefined();
            expect(codec.parseConfig({ rate: 20 }).rate).toBeUndefined();
            expect(codec.parseConfig({ rate: 1 }).rate).toBe(1);
        });

        it('dateString rejects malformed input', () => {
            expect(codec.parseConfig({ cursor: 'not-a-date' }).cursor).toBeUndefined();
            expect(codec.parseConfig({ cursor: '2026-05-22' }).cursor).toBe('2026-05-22');
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
                collapsed: { 'test::a': true, 'test::b': true },
            };
            const json = codec.serializeTransient(transient);
            const back = codec.parseTransient(json);
            expect(back).toEqual(transient);
        });

        it('collapsedKeys migrates legacy un-prefixed entries', () => {
            const json = { collapsed: { 'a': true, 'test::b': true } };
            const back = codec.parseTransient(json);
            expect(back.collapsed).toEqual({ 'test::a': true, 'test::b': true });
        });

        it('collapsedKeys drops false entries', () => {
            const json = codec.serializeTransient({ collapsed: { 'test::a': true, 'test::b': false } });
            expect(json.collapsed).toEqual({ 'test::a': true });
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
    it('codecFor unknown viewType returns undefined', async () => {
        const { codecFor } = await import('../../../../src/services/viewConfig');
        expect(codecFor('nonexistent-view')).toBeUndefined();
    });

    it('registerSchema makes codec available via codecFor', async () => {
        const { codecFor, schemaFor, resolveViewTypeFromShortName, registerSchema } = await import('../../../../src/services/viewConfig');
        const localSchema: ViewSchema<{ x?: boolean }, Record<string, never>> = {
            viewType: 'unit-test-throwaway-view',
            shortName: 'utt',
            defaults: {},
            config: { x: F.boolean('x') },
            transient: {},
        };
        registerSchema(localSchema);
        expect(codecFor('unit-test-throwaway-view')).toBeDefined();
        expect(schemaFor('unit-test-throwaway-view')).toBe(localSchema);
        expect(resolveViewTypeFromShortName('utt')).toBe('unit-test-throwaway-view');
    });
});
