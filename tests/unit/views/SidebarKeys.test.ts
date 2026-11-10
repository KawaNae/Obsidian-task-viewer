import { describe, expect, it } from 'vitest';
import { TimelineCodec } from '../../../src/views/timelineview/TimelineSchema';
import { CalendarCodec } from '../../../src/views/calendar/CalendarSchema';
import { ViewUriBuilder } from '../../../src/views/sharedLogic/ViewUriBuilder';
import { unicodeBtoa } from '../../../src/utils/base64';

/** A list as it is stored: a frame's entry without a kind. */
const stored = (id: string) => ({
    id,
    name: `List ${id}`,
    filterState: { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: [id] }] },
    applyViewFilter: false,
});
const frame = (id: string) => ({ kind: 'list', ...stored(id) });
const base64 = (value: unknown) => unicodeBtoa(JSON.stringify(value));

describe.each([
    ['timeline', 'timeline-view', TimelineCodec],
    ['calendar', 'calendar-view', CalendarCodec],
] as const)("the keys %s's sidebar is stored under", (view, viewType, codec) => {
    describe('the frames, in a template and the workspace', () => {
        it('are read from a state that holds only the older key `pinnedLists`', () => {
            expect(codec.parseConfig({ pinnedLists: [stored('a'), stored('b')] }).sidebar).toEqual([frame('a'), frame('b')]);
        });

        it('are read from `sidebar` where both keys are there', () => {
            const config = codec.parseConfig({ sidebar: [stored('new')], pinnedLists: [stored('old')] });
            expect(config.sidebar).toEqual([frame('new')]);
        });

        it('are written under `sidebar` alone, what was read from the older key too', () => {
            const written = codec.serializeConfig(codec.parseConfig({ pinnedLists: [stored('a')] }));
            expect(written).toEqual({ sidebar: [stored('a')] });
            expect(written).not.toHaveProperty('pinnedLists');
        });
    });

    describe('which frames are collapsed', () => {
        it('is read from a state that holds only the older key `pinnedListCollapsed`', () => {
            expect(codec.parseTransient({ pinnedListCollapsed: { a: true, b: false } }).sidebarCollapsed).toEqual({ a: true });
        });

        it("is read from the older key in the older form of an id too, the view's name before it", () => {
            const state = { pinnedListCollapsed: { [`${view}::a`]: true, b: true, 'other::c': true } };
            expect(codec.parseTransient(state).sidebarCollapsed).toEqual({ a: true, b: true });
        });

        it('is read from `sidebarCollapsed` where both keys are there, in either form of an id', () => {
            const state = { sidebarCollapsed: { [`${view}::new`]: true }, pinnedListCollapsed: { old: true } };
            expect(codec.parseTransient(state).sidebarCollapsed).toEqual({ new: true });
        });

        it('is written under `sidebarCollapsed` alone, what was read from the older key too', () => {
            const written = codec.serializeTransient(codec.parseTransient({ pinnedListCollapsed: { [`${view}::a`]: true } }));
            expect(written).toEqual({ sidebarCollapsed: { a: true } });
            expect(written).not.toHaveProperty('pinnedListCollapsed');
        });
    });

    describe('the frames, in a URI', () => {
        it('are read from an older URI that said `pinnedLists=`', () => {
            expect(codec.fromUriParams({ pinnedLists: base64([stored('a')]) }).sidebar).toEqual([frame('a')]);
        });

        it('are read from `sidebar=` where both are there', () => {
            const params = { sidebar: base64([stored('new')]), pinnedLists: base64([stored('old')]) };
            expect(codec.fromUriParams(params).sidebar).toEqual([frame('new')]);
        });

        it('are written as `sidebar=` into a copied URI, and read back', () => {
            const config = codec.fromUriParams({ pinnedLists: base64([stored('a')]) });
            const uri = ViewUriBuilder.build(viewType, { configParams: codec.toUriParams(config) });

            expect(uri).toContain(`view=${view}`);
            expect(uri).not.toMatch(/[?&]pinnedLists=/);
            const query = Object.fromEntries(new URL(uri.replace('obsidian://', 'http://x/')).searchParams);
            expect(query).toEqual({ view, sidebar: base64([stored('a')]) });
            expect(codec.fromUriParams(query).sidebar).toEqual([frame('a')]);
        });
    });
});
