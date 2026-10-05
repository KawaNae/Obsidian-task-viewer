/**
 * The views of this plugin, one descriptor each.
 *
 * Every list of views the plugin needs — what main registers, the ribbon and
 * the commands, the views that hear the plugin's events, the views counted as
 * open, each view's home in the settings, the views that export an image or
 * keep templates, and the string-keyed lookups of a schema by type or short
 * name — is read from this table, so a view is added here and nowhere else.
 *
 * The table imports the schemas and no view class: a view imports the table
 * for its name and icon, and a class here would close a cycle. main keeps the
 * constructors as its own `Record<ViewType, …>`, so a view without one is a
 * compile error there.
 *
 * Display text is held as an i18n key and translated when read
 * (`viewDisplayName`), since the table is built before `initI18n` runs.
 */

import type { TaskViewerSettings } from '../types';
import type { ViewSchema } from '../services/viewConfig/ViewConfigSchema';
import type { ViewConfigCodec } from '../services/viewConfig/ViewConfigCodec';
import { t } from '../i18n';
import { TimelineCodec } from './timelineview/TimelineSchema';
import { ScheduleCodec } from './scheduleview/ScheduleSchema';
import { TimerCodec } from './TimerSchema';
import { CalendarCodec } from './calendar/CalendarSchema';
import { MiniCalendarCodec } from './calendar/MiniCalendarSchema';
import { KanbanCodec } from './kanban/KanbanSchema';

export type ViewType = 'timeline-view' | 'schedule-view' | 'timer-view' | 'calendar-view' | 'mini-calendar-view' | 'kanban-view';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCodec = ViewConfigCodec<any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = ViewSchema<any, any>;

export interface ViewDescriptor {
    readonly type: ViewType;
    /** The name a URI, a template and the CLI use (`view=<shortName>`); the schema's. */
    readonly shortName: string;
    readonly icon: string;
    readonly displayNameKey: string;
    readonly ribbonTitleKey: string;
    readonly commandNameKey: string;
    /** The command's id; kept as it was, since users bind hotkeys to it. */
    readonly commandId: string;
    /** The settings field that holds where the view opens when none is said. */
    readonly positionField: keyof TaskViewerSettings['defaultViewPositions'];
    readonly schema: AnySchema;
    /** The schema's codec, the same instance the view and its toolbar use. */
    readonly codec: AnyCodec;
    /** Whether the view can be exported as an image (its selectors are in `ExportRegistry`). */
    readonly exportable: boolean;
    /** Whether the view saves and loads view templates. */
    readonly hasTemplates: boolean;
    /**
     * Whether the view hears the plugin's events: settings saved, the visual
     * day changed and the minute passed (`ViewEvents`).
     */
    readonly hearsEvents: boolean;
    /** Whether the view counts as an open view in the diagnostics report. */
    readonly countsAsActive: boolean;
}

/** The parts a descriptor takes from its codec: the type and short name are the schema's. */
type DescriptorBody = Omit<ViewDescriptor, 'type' | 'shortName' | 'schema' | 'codec'>;

/** `const` keeps the body's literals (`exportable: true`), which `ExportableViewType` reads. */
function describe<const B extends DescriptorBody>(codec: AnyCodec, body: B): ViewDescriptor & B {
    const schema = codec.schema;
    return { type: schema.viewType, shortName: schema.shortName, schema, codec, ...body };
}

/**
 * The views, in the order the ribbon and the commands list them.
 *
 * The timer view hears none of the plugin's events: it draws no tasks, and it
 * runs its own clock of seconds while a timer runs. It still counts as open.
 */
export const VIEW_DESCRIPTORS = {
    'timeline-view': describe(TimelineCodec, {
        icon: 'chart-gantt',
        displayNameKey: 'view.timeline',
        ribbonTitleKey: 'ribbon.openTimeline',
        commandNameKey: 'command.openTimeline',
        commandId: 'open-timeline-view',
        positionField: 'timeline',
        exportable: true,
        hasTemplates: true,
        hearsEvents: true,
        countsAsActive: true,
    }),
    'schedule-view': describe(ScheduleCodec, {
        icon: 'ruler',
        displayNameKey: 'view.schedule',
        ribbonTitleKey: 'ribbon.openSchedule',
        commandNameKey: 'command.openSchedule',
        commandId: 'open-schedule-view',
        positionField: 'schedule',
        exportable: true,
        hasTemplates: true,
        hearsEvents: true,
        countsAsActive: true,
    }),
    'timer-view': describe(TimerCodec, {
        icon: 'timer',
        displayNameKey: 'view.timer',
        ribbonTitleKey: 'ribbon.openTimer',
        commandNameKey: 'command.openTimer',
        commandId: 'open-timer-view',
        positionField: 'timer',
        exportable: false,
        hasTemplates: false,
        hearsEvents: false,
        countsAsActive: true,
    }),
    'calendar-view': describe(CalendarCodec, {
        icon: 'calendar',
        displayNameKey: 'view.calendar',
        ribbonTitleKey: 'ribbon.openCalendar',
        commandNameKey: 'command.openCalendar',
        commandId: 'open-calendar-view',
        positionField: 'calendar',
        exportable: true,
        hasTemplates: true,
        hearsEvents: true,
        countsAsActive: true,
    }),
    'mini-calendar-view': describe(MiniCalendarCodec, {
        icon: 'calendar-days',
        displayNameKey: 'view.miniCalendar',
        ribbonTitleKey: 'ribbon.openMiniCalendar',
        commandNameKey: 'command.openMiniCalendar',
        commandId: 'open-mini-calendar-view',
        positionField: 'miniCalendar',
        exportable: false,
        hasTemplates: true,
        hearsEvents: true,
        countsAsActive: true,
    }),
    'kanban-view': describe(KanbanCodec, {
        icon: 'layout-grid',
        displayNameKey: 'view.kanban',
        ribbonTitleKey: 'ribbon.openKanban',
        commandNameKey: 'command.openKanban',
        commandId: 'open-kanban-view',
        positionField: 'kanban',
        exportable: true,
        hasTemplates: true,
        hearsEvents: true,
        countsAsActive: true,
    }),
} satisfies Record<ViewType, ViewDescriptor>;

/** The views that export an image; `ExportRegistry` holds a target for each, checked by the compiler. */
export type ExportableViewType = {
    [K in ViewType]: (typeof VIEW_DESCRIPTORS)[K]['exportable'] extends true ? K : never
}[ViewType];

/** Every descriptor, in table order. */
export const ALL_VIEWS: readonly ViewDescriptor[] = Object.values(VIEW_DESCRIPTORS);

/** Whether `viewType` is one of this plugin's views. */
export function isViewType(viewType: string): viewType is ViewType {
    return Object.prototype.hasOwnProperty.call(VIEW_DESCRIPTORS, viewType);
}

/** The descriptor of `viewType`, or undefined for a view not of this plugin (the log view). */
export function descriptorOf(viewType: string): ViewDescriptor | undefined {
    return isViewType(viewType) ? VIEW_DESCRIPTORS[viewType] : undefined;
}

/** The types of the views a descriptor field selects, in table order. */
export function viewTypesWhere(pred: (d: ViewDescriptor) => boolean): ViewType[] {
    return ALL_VIEWS.filter(pred).map(d => d.type);
}

/** The short names of the views that export an image, for the CLI's help and errors. */
export function exportableShortNames(): string[] {
    return ALL_VIEWS.filter(d => d.exportable).map(d => d.shortName);
}

/** The view's name in the current language. */
export function viewDisplayName(viewType: ViewType): string {
    return t(VIEW_DESCRIPTORS[viewType].displayNameKey);
}
