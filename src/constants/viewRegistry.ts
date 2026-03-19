import { t } from '../i18n';

export type ViewType = 'timeline-view' | 'schedule-view' | 'timer-view' | 'calendar-view' | 'mini-calendar-view' | 'kanban-view';

export type ViewMeta = {
    type: ViewType;
    displayText: string;
    icon: string;
    ribbonTitle: string;
    commandName: string;
};

type ViewMetaStatic = {
    type: ViewType;
    icon: string;
    displayTextKey: string;
    ribbonTitleKey: string;
    commandNameKey: string;
};

const VIEW_META_DEFS: Record<ViewType, ViewMetaStatic> = {
    'timeline-view': {
        type: 'timeline-view',
        icon: 'chart-gantt',
        displayTextKey: 'view.timeline',
        ribbonTitleKey: 'ribbon.openTimeline',
        commandNameKey: 'command.openTimeline',
    },
    'schedule-view': {
        type: 'schedule-view',
        icon: 'ruler',
        displayTextKey: 'view.schedule',
        ribbonTitleKey: 'ribbon.openSchedule',
        commandNameKey: 'command.openSchedule',
    },
    'timer-view': {
        type: 'timer-view',
        icon: 'timer',
        displayTextKey: 'view.timer',
        ribbonTitleKey: 'ribbon.openTimer',
        commandNameKey: 'command.openTimer',
    },
    'calendar-view': {
        type: 'calendar-view',
        icon: 'calendar',
        displayTextKey: 'view.calendar',
        ribbonTitleKey: 'ribbon.openCalendar',
        commandNameKey: 'command.openCalendar',
    },
    'mini-calendar-view': {
        type: 'mini-calendar-view',
        icon: 'calendar-days',
        displayTextKey: 'view.miniCalendar',
        ribbonTitleKey: 'ribbon.openMiniCalendar',
        commandNameKey: 'command.openMiniCalendar',
    },
    'kanban-view': {
        type: 'kanban-view',
        icon: 'layout-grid',
        displayTextKey: 'view.kanban',
        ribbonTitleKey: 'ribbon.openKanban',
        commandNameKey: 'command.openKanban',
    },
};

function buildViewMeta(def: ViewMetaStatic): ViewMeta {
    return {
        type: def.type,
        icon: def.icon,
        displayText: t(def.displayTextKey),
        ribbonTitle: t(def.ribbonTitleKey),
        commandName: t(def.commandNameKey),
    };
}

// Lazy accessors — t() is called at access time (after initI18n)
export const VIEW_META_TIMELINE: ViewMeta = Object.defineProperties({} as ViewMeta, makeLazyProps('timeline-view'));
export const VIEW_META_SCHEDULE: ViewMeta = Object.defineProperties({} as ViewMeta, makeLazyProps('schedule-view'));
export const VIEW_META_TIMER: ViewMeta = Object.defineProperties({} as ViewMeta, makeLazyProps('timer-view'));
export const VIEW_META_CALENDAR: ViewMeta = Object.defineProperties({} as ViewMeta, makeLazyProps('calendar-view'));
export const VIEW_META_MINI_CALENDAR: ViewMeta = Object.defineProperties({} as ViewMeta, makeLazyProps('mini-calendar-view'));
export const VIEW_META_KANBAN: ViewMeta = Object.defineProperties({} as ViewMeta, makeLazyProps('kanban-view'));

function makeLazyProps(viewType: ViewType): PropertyDescriptorMap {
    const def = VIEW_META_DEFS[viewType];
    return {
        type: { get: () => def.type, enumerable: true },
        icon: { get: () => def.icon, enumerable: true },
        displayText: { get: () => t(def.displayTextKey), enumerable: true },
        ribbonTitle: { get: () => t(def.ribbonTitleKey), enumerable: true },
        commandName: { get: () => t(def.commandNameKey), enumerable: true },
    };
}

export function getViewMeta(viewType: string): ViewMeta {
    const def = VIEW_META_DEFS[viewType as ViewType];
    if (!def) {
        throw new Error(`[viewRegistry] Unknown view type: ${viewType}`);
    }
    return buildViewMeta(def);
}
