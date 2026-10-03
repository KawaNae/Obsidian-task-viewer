import { describe, it, expect, vi } from 'vitest';
import { buildViewSettingsOptions, resetPatch, templatePatch } from '../../../../src/views/base/ViewSettings';
import { ViewStore } from '../../../../src/views/base/ViewStore';
import { VIEW_DESCRIPTORS } from '../../../../src/views/ViewDescriptors';
import { TimelineCodec, type TimelineState } from '../../../../src/views/timelineview/TimelineSchema';
import { MiniCalendarCodec } from '../../../../src/views/calendar/MiniCalendarSchema';

function source<S extends object>(codec: unknown, viewType: keyof typeof VIEW_DESCRIPTORS, state: S) {
    const store = new ViewStore<S>(state);
    const plugin = {
        settings: { viewTemplateFolder: 'Templates', exportFolder: '' },
        getOperations: () => ({}),
        menuPresenter: {},
    };
    return {
        store,
        options: buildViewSettingsOptions({
            app: {} as never,
            leaf: {} as never,
            plugin: plugin as never,
            descriptor: VIEW_DESCRIPTORS[viewType],
            codec: codec as never,
            store: store as never,
        }),
    };
}

describe('resetPatch', () => {
    it('puts the config back to the defaults, name included, and clears the collapse state but not the date', () => {
        const patch = resetPatch(TimelineCodec);
        expect(patch.daysToShow).toBe(3);
        expect(patch.zoomLevel).toBe(1.0);
        expect('customName' in patch && patch.customName === undefined).toBe(true);
        expect('filterState' in patch && patch.filterState === undefined).toBe(true);
        expect('pinnedListCollapsed' in patch && patch.pinnedListCollapsed === undefined).toBe(true);
        expect('date' in patch).toBe(false);
    });
});

describe('templatePatch', () => {
    it('applies the template\'s config over the defaults and names the view after it', () => {
        const patch = templatePatch(TimelineCodec, {
            filePath: 'x.md', name: 'Work', viewType: 'timeline',
            config: { daysToShow: 7 },
        });
        expect(patch.daysToShow).toBe(7);
        expect(patch.zoomLevel).toBe(1.0);
        expect(patch.customName).toBe('Work');
    });
});

describe('buildViewSettingsOptions', () => {
    it('saves a template under the view\'s own short name (MiniCalendar used to write "calendar")', () => {
        const { options } = source(MiniCalendarCodec, 'mini-calendar-view', {});
        expect(options.getViewTemplate().viewType).toBe('mini-calendar');
    });

    it('reads the name and the config from the store, and writes a rename to it', () => {
        const { store, options } = source<TimelineState>(TimelineCodec, 'timeline-view', { daysToShow: 5, customName: 'Mine' });
        expect(options.getCustomName()).toBe('Mine');
        const template = options.getViewTemplate();
        expect(template.name).toBe('Mine');
        expect(template.config).toEqual({ customName: 'Mine', daysToShow: 5 });
        options.onRename('Other');
        expect(store.get().customName).toBe('Other');
    });

    it('reset and template load each write one patch', () => {
        const { store, options } = source<TimelineState>(TimelineCodec, 'timeline-view', { daysToShow: 5, customName: 'Mine', date: '2026-10-01' });
        const heard = vi.fn();
        store.subscribe(heard);
        options.onReset();
        expect(heard).toHaveBeenCalledTimes(1);
        expect(store.get()).toMatchObject({ daysToShow: 3, customName: undefined, date: '2026-10-01' });
        options.onApplyTemplate({ filePath: '', name: 'T', viewType: 'timeline', config: { daysToShow: 2 } });
        expect(heard).toHaveBeenCalledTimes(2);
        expect(store.get()).toMatchObject({ daysToShow: 2, customName: 'T' });
    });

    it('offers export only for a view that exports an image', () => {
        expect(source(TimelineCodec, 'timeline-view', {}).options.getExportFolder).toBeDefined();
        expect(source(MiniCalendarCodec, 'mini-calendar-view', {}).options.getExportFolder).toBeUndefined();
    });
});
