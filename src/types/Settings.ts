import { DEFAULT_STATUS_DEFINITIONS, type StatusDefinition } from './TaskModel';
import { DEFAULT_TV_FILE_KEYS, type TvFileKeys } from './TvFileKeys';

export type DefaultLeafPosition = 'left' | 'right' | 'tab' | 'window';

export type DoubleTapAction = 'detail' | 'open' | 'menu';

export interface TaskViewerSettings {
    startHour: number;
    applyGlobalStyles: boolean;
    enableStatusMenu: boolean;
    statusDefinitions: StatusDefinition[];
    tvFileKeys: TvFileKeys;
    zoomLevel: number;
    dailyNoteHeader: string;
    dailyNoteHeaderLevel: number;
    pomodoroWorkMinutes: number;
    pomodoroBreakMinutes: number;
    countdownMinutes: number;
    pastDaysToShow: number;
    startFromOldestOverdue: boolean;
    tvFileChildHeader: string;
    tvFileChildHeaderLevel: number;
    doubleTapAction: DoubleTapAction;
    longPressThreshold: number;
    reuseExistingTab: boolean;
    editorMenuForTasks: boolean;
    editorMenuForCheckboxes: boolean;
    fileMenuForTvFile: boolean;
    weekStartDay: 0 | 1;
    calendarShowWeekNumbers: boolean;
    weeklyNoteFormat: string;
    weeklyNoteFolder: string;
    weeklyNoteTemplate: string;
    monthlyNoteFormat: string;
    monthlyNoteFolder: string;
    monthlyNoteTemplate: string;
    yearlyNoteFormat: string;
    yearlyNoteFolder: string;
    yearlyNoteTemplate: string;
    intervalTemplateFolder: string;
    viewTemplateFolder: string;
    exportFolder: string;
    pinnedListPageSize: number;
    defaultViewPositions: {
        timeline: DefaultLeafPosition;
        schedule: DefaultLeafPosition;
        calendar: DefaultLeafPosition;
        miniCalendar: DefaultLeafPosition;
        timer: DefaultLeafPosition;
        kanban: DefaultLeafPosition;
    };
    enableCardFileLink: boolean;
    /** 子要素がこの数以上のとき、タスクカードはトグル付きの折りたたみ表示になる (1〜5) */
    childCollapseThreshold: number;
    suggestColor: boolean;
    suggestLinestyle: boolean;
    hideViewHeader: boolean;
    mobileTopOffset: number;
    fixMobileGradientWidth: boolean;
    showAllDay: boolean;
    showTimeline: boolean;
    showWeekRow: boolean;
    // External parser support (read-only).
    enableTasksPlugin: boolean;
    enableDayPlanner: boolean;
    tasksPluginMapping: TasksPluginMapping;

    /**
     * Astronomy sub-system. `display` is the global default for views
     * (each view can override per-instance via `viewState.astronomyDisplay`).
     * `location` is the observer position used for sun-time / horizon-dependent
     * calculations; moon illumination is essentially observer-independent.
     * Future: subLocations[] for multi-TZ travel scenarios.
     */
    astronomy: AstronomySettings;

    // Logging
    logRetentionDays: number;
    logMaxStorageMB: number;
    verboseNotice: boolean;
}

export interface AstronomyDisplay {
    /** Show sunrise/sunset horizontal lines on time-axis views. */
    sunTimes: boolean;
    /** Show moon phase indicator per visible date. */
    moonPhase: boolean;
    /**
     * Layer the sunrise/sunset lines in front of task cards instead of behind
     * them. Default false = behind all cards (ambient context). Only meaningful
     * when sunTimes is on.
     */
    sunTimesInFront: boolean;
}

export interface AstronomyLocation {
    /** Latitude in degrees, -90 to 90 */
    latitude: number;
    /** Longitude in degrees, -180 to 180 */
    longitude: number;
    // Phase B (multi-TZ): timezone?: string;
}

export interface AstronomySettings {
    display: AstronomyDisplay;
    location: AstronomyLocation;
    // Phase B (multi-TZ): subLocations?: AstronomyLocation[];
}

export type TaskFieldMapping = 'startDate' | 'endDate' | 'due' | 'ignore';

export interface TasksPluginMapping {
    /** 🛫 start date mapping */
    start: TaskFieldMapping;
    /** ⏳ scheduled date mapping */
    scheduled: TaskFieldMapping;
    /** 📅 due date mapping */
    due: TaskFieldMapping;
}

export const DEFAULT_SETTINGS: TaskViewerSettings = {
    startHour: 5,
    applyGlobalStyles: false,
    enableStatusMenu: true,
    statusDefinitions: [...DEFAULT_STATUS_DEFINITIONS],
    tvFileKeys: { ...DEFAULT_TV_FILE_KEYS },
    zoomLevel: 1.0,
    dailyNoteHeader: 'Tasks',
    dailyNoteHeaderLevel: 2,
    pomodoroWorkMinutes: 25,
    pomodoroBreakMinutes: 5,
    countdownMinutes: 25,
    pastDaysToShow: 0,
    startFromOldestOverdue: true,
    tvFileChildHeader: 'Tasks',
    tvFileChildHeaderLevel: 2,
    doubleTapAction: 'detail',
    longPressThreshold: 400,
    reuseExistingTab: true,
    editorMenuForTasks: true,
    editorMenuForCheckboxes: true,
    fileMenuForTvFile: true,
    weekStartDay: 0,
    calendarShowWeekNumbers: false,
    weeklyNoteFormat: 'gggg-[W]ww',
    weeklyNoteFolder: '',
    weeklyNoteTemplate: '',
    monthlyNoteFormat: 'YYYY-MM',
    monthlyNoteFolder: '',
    monthlyNoteTemplate: '',
    yearlyNoteFormat: 'YYYY',
    yearlyNoteFolder: '',
    yearlyNoteTemplate: '',
    intervalTemplateFolder: '',
    viewTemplateFolder: '',
    exportFolder: 'task-viewer-export',
    pinnedListPageSize: 10,
    defaultViewPositions: {
        timeline: 'tab',
        schedule: 'right',
        calendar: 'tab',
        miniCalendar: 'left',
        timer: 'right',
        kanban: 'tab',
    },
    enableCardFileLink: true,
    childCollapseThreshold: 3,
    suggestColor: true,
    suggestLinestyle: true,
    hideViewHeader: true,
    mobileTopOffset: 32,
    fixMobileGradientWidth: true,
    showAllDay: true,
    showTimeline: true,
    showWeekRow: true,
    enableTasksPlugin: false,
    enableDayPlanner: false,
    tasksPluginMapping: {
        start: 'startDate',
        scheduled: 'startDate',
        due: 'due',
    },
    astronomy: {
        display: { sunTimes: false, moonPhase: false, sunTimesInFront: false },
        location: { latitude: 35.6762, longitude: 139.6503 }, // Tokyo Station
    },
    logRetentionDays: 7,
    logMaxStorageMB: 50,
    verboseNotice: false,
};
