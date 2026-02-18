export type ViewType = 'timeline-view' | 'schedule-view' | 'pomodoro-view' | 'calendar-view';

export type ViewMeta = {
    type: ViewType;
    displayText: string;
    icon: string;
    ribbonTitle: string;
    commandName: string;
};

export const VIEW_META_TIMELINE: ViewMeta = {
    type: 'timeline-view',
    displayText: 'Timeline View',
    icon: 'chart-gantt',
    ribbonTitle: 'Open Timeline',
    commandName: 'Open Timeline View',
};

export const VIEW_META_SCHEDULE: ViewMeta = {
    type: 'schedule-view',
    displayText: 'Schedule View',
    icon: 'ruler',
    ribbonTitle: 'Open Schedule',
    commandName: 'Open Schedule View',
};

export const VIEW_META_POMODORO: ViewMeta = {
    type: 'pomodoro-view',
    displayText: 'Pomodoro Timer',
    icon: 'timer',
    ribbonTitle: 'Open Pomodoro Timer',
    commandName: 'Open Pomodoro Timer',
};

export const VIEW_META_CALENDAR: ViewMeta = {
    type: 'calendar-view',
    displayText: 'Calendar View',
    icon: 'calendar',
    ribbonTitle: 'Open Calendar',
    commandName: 'Open Calendar View',
};

export const VIEW_REGISTRY: Readonly<Record<ViewType, ViewMeta>> = {
    'timeline-view': VIEW_META_TIMELINE,
    'schedule-view': VIEW_META_SCHEDULE,
    'pomodoro-view': VIEW_META_POMODORO,
    'calendar-view': VIEW_META_CALENDAR,
};

export function getViewMeta(viewType: string): ViewMeta {
    const meta = VIEW_REGISTRY[viewType as ViewType];
    if (!meta) {
        throw new Error(`[viewRegistry] Unknown view type: ${viewType}`);
    }
    return meta;
}
