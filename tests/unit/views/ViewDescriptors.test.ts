import { describe, it, expect } from 'vitest';
import {
    ALL_VIEWS,
    VIEW_DESCRIPTORS,
    descriptorOf,
    isViewType,
    viewTypesWhere,
} from '../../../src/views/ViewDescriptors';
import {
    codecFor,
    schemaFor,
    shortNameFor,
    resolveViewTypeFromShortName,
} from '../../../src/services/viewConfig';
import { exportDescriptorFor } from '../../../src/services/export/ExportRegistry';
import { exportableShortNames } from '../../../src/views/ViewDescriptors';
import { TimelineCodec } from '../../../src/views/timelineview/TimelineSchema';
import { ScheduleCodec } from '../../../src/views/scheduleview/ScheduleSchema';
import { TimerCodec } from '../../../src/views/TimerSchema';
import { CalendarCodec } from '../../../src/views/calendar/CalendarSchema';
import { MiniCalendarCodec } from '../../../src/views/calendar/MiniCalendarSchema';
import { KanbanCodec } from '../../../src/views/kanban/KanbanSchema';

/**
 * The view table is the one place a view is declared. Its keys are checked
 * against `ViewType` by the compiler (`satisfies Record<ViewType, …>`); these
 * tests check what the compiler cannot: that each entry is the view its key
 * names, and that the lists read from it are the ones the plugin had.
 */
const VIEW_TYPES = [
    'timeline-view', 'schedule-view', 'timer-view',
    'calendar-view', 'mini-calendar-view', 'kanban-view',
];

describe('the view table', () => {
    it('holds every view type, in the order of the ribbon', () => {
        expect(Object.keys(VIEW_DESCRIPTORS)).toEqual(VIEW_TYPES);
        expect(ALL_VIEWS.map(d => d.type)).toEqual(VIEW_TYPES);
    });

    it('keys each descriptor by the view type its schema declares', () => {
        for (const [key, d] of Object.entries(VIEW_DESCRIPTORS)) {
            expect(d.type, key).toBe(key);
            expect(d.schema.viewType, key).toBe(key);
            expect(d.codec.schema, key).toBe(d.schema);
            expect(d.shortName, key).toBe(d.schema.shortName);
        }
    });

    it('holds the codec each schema module exports, the one the string lookups hand out', () => {
        const typed = {
            'timeline-view': TimelineCodec,
            'schedule-view': ScheduleCodec,
            'timer-view': TimerCodec,
            'calendar-view': CalendarCodec,
            'mini-calendar-view': MiniCalendarCodec,
            'kanban-view': KanbanCodec,
        };
        for (const [viewType, codec] of Object.entries(typed)) {
            expect(descriptorOf(viewType)?.codec, viewType).toBe(codec);
            expect(codecFor(viewType), viewType).toBe(codec);
            expect(schemaFor(viewType), viewType).toBe(codec.schema);
        }
    });

    it('keeps the command ids users bind hotkeys to', () => {
        expect(ALL_VIEWS.map(d => d.commandId)).toEqual([
            'open-timeline-view', 'open-schedule-view', 'open-timer-view',
            'open-calendar-view', 'open-mini-calendar-view', 'open-kanban-view',
        ]);
    });

    it('knows only its own views', () => {
        expect(isViewType('timeline-view')).toBe(true);
        expect(isViewType('task-viewer-log-view')).toBe(false);
        expect(descriptorOf('task-viewer-log-view')).toBeUndefined();
    });
});

describe('the lists read from the table', () => {
    it('sends the plugin events to every view but the timer', () => {
        expect(viewTypesWhere(d => d.hearsEvents)).toEqual([
            'timeline-view', 'schedule-view', 'calendar-view', 'mini-calendar-view', 'kanban-view',
        ]);
    });

    it('counts every view, the timer too, as open', () => {
        expect(viewTypesWhere(d => d.countsAsActive)).toEqual(VIEW_TYPES);
    });

    it('keeps templates for every view but the timer', () => {
        expect(viewTypesWhere(d => d.hasTemplates)).toEqual([
            'timeline-view', 'schedule-view', 'calendar-view', 'mini-calendar-view', 'kanban-view',
        ]);
    });

    it('exports an image of Timeline, Schedule, Calendar and Kanban', () => {
        expect(viewTypesWhere(d => d.exportable)).toEqual([
            'timeline-view', 'schedule-view', 'calendar-view', 'kanban-view',
        ]);
        expect(exportableShortNames()).toEqual(['timeline', 'schedule', 'calendar', 'kanban']);
    });

    it('has an export target for exactly the views that export', () => {
        for (const d of ALL_VIEWS) {
            expect(exportDescriptorFor(d.type) !== undefined, d.type).toBe(d.exportable);
        }
        expect(exportDescriptorFor('task-viewer-log-view')).toBeUndefined();
    });
});

describe('view short names', () => {
    // A short name is what appears in `obsidian://task-viewer?view=…`, in
    // exported filenames and in template files.
    it('hands out a distinct short name per view type', () => {
        const names = VIEW_TYPES.map(v => shortNameFor(v));
        expect(names.every(Boolean)).toBe(true);
        expect(new Set(names).size).toBe(names.length);
    });

    it('round-trips a view type through its short name', () => {
        // The write side (ViewUriBuilder) and the read side (UriViewOpener)
        // read the same table; the round trip keeps a copied URI reopening
        // the view it came from.
        for (const viewType of VIEW_TYPES) {
            expect(resolveViewTypeFromShortName(shortNameFor(viewType)!)).toBe(viewType);
        }
    });

    it('returns nothing for a view type with no schema', () => {
        expect(shortNameFor('log-view')).toBeUndefined();
        expect(resolveViewTypeFromShortName('not-a-view')).toBeUndefined();
    });

    it('does not assume a short name is the view type minus "-view"', () => {
        expect(shortNameFor('mini-calendar-view')).toBe('mini-calendar');
        expect(shortNameFor('timer-view')).toBe('timer');
    });
});
