import type { FilterState } from '../services/filter/FilterTypes';
import type { SortState } from '../services/sort/SortTypes';

export interface StatusDefinition {
    char: string;
    label: string;
    isComplete: boolean;
}

export const FIXED_STATUS_CHARS = [' ', 'x'] as const;

export const DEFAULT_STATUS_DEFINITIONS: StatusDefinition[] = [
    { char: ' ', label: 'Todo',        isComplete: false },
    { char: '/', label: 'Doing',       isComplete: false },
    { char: 'x', label: 'Done',        isComplete: true },
    { char: '-', label: 'Cancelled',   isComplete: true },
    { char: '!', label: 'Important',   isComplete: true },
    { char: '?', label: 'Question',    isComplete: false },
    { char: '>', label: 'Deferred',    isComplete: false },
];

/**
 * Returns true when statusChar is considered completed by settings.
 */
export function isCompleteStatusChar(statusChar: string, defs: StatusDefinition[]): boolean {
    return defs.some(d => d.char === statusChar && d.isComplete);
}

export type HabitType = 'boolean' | 'number' | 'string';

export interface HabitDefinition {
    // Frontmatter key name used to store habit value.
    name: string;
    type: HabitType;
    // Optional display unit for number habits.
    unit?: string;
}

export type PropertyType = 'string' | 'number' | 'boolean' | 'array';

export interface PropertyValue {
    value: string;
    type: PropertyType;
}

export interface ChildLine {
    text: string;
    indent: string;
    checkboxChar: string | null;
    wikilinkTarget: string | null;
    propertyKey: string | null;
    propertyValue: string | null;
}

export interface Task {
    // Identity and source location.
    id: string;
    file: string;
    /**
     * 0-indexed line number in the source file.
     * `-1` is a generic sentinel meaning "no body line" (e.g., frontmatter root tasks).
     * Use `hasBodyLine(task)` to test validity. `-1` is NOT a frontmatter discriminator
     * — use `isFrontmatterTask(task)` for type identification.
     */
    line: number;

    // Core task text/status.
    content: string;
    statusChar: string;

    // Tree relationship.
    parentId?: string;
    indent: number;
    childIds: string[];
    childLines: ChildLine[];
    /**
     * Line map for childLines.
     * - frontmatter tasks: absolute file line numbers
     * - inline tasks: may be empty and fallback to (task.line + 1 + index)
     */
    childLineBodyOffsets: number[];

    // Date/time fields.
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;

    // True when startDate was inherited from the daily note filename.
    startDateInherited?: boolean;

    // Original parsed text and stable IDs.
    originalText: string;
    blockId?: string;
    timerTargetId?: string;

    // Tags extracted from task content and/or frontmatter.
    tags: string[];

    // Parsed flow commands.
    commands?: FlowCommand[];

    // Parse-time validation result (error or warning).
    validation?: {
        severity: 'error' | 'warning';
        rule: string;
        message: string;
        hint: string;
    };

    /**
     * Parser identifier that produced this task (e.g. at-notation/frontmatter).
     * Used for parser-specific writeback behavior.
     */
    parserId: string;

    // Resolved styling (from child lines or parent-task inheritance).
    color?: string;
    linestyle?: string;

    // Resolved mask for export masking.
    mask?: string;

    /** True when parsed by a read-only parser (no writeback support). */
    isReadOnly?: boolean;

    /** Custom properties parsed from childLines / frontmatter. Read-only. */
    properties: Record<string, PropertyValue>;
}

/** Check whether a task was produced by the file-level (frontmatter) parser. */
export function isFrontmatterTask(task: Pick<Task, 'parserId'>): boolean {
    return task.parserId === 'tv-file';
}

/** Check whether a task was produced by the TaskViewer inline parser. */
export function isTaskViewerInlineTask(task: Pick<Task, 'parserId'>): boolean {
    return task.parserId === 'tv-inline';
}

/**
 * task.line が body 行アクセスに使える有効値かを判定する。
 * `false` の場合: frontmatter task (line === -1) など、ファイル本体に
 * 紐付く行を持たないタスク。
 *
 * 注意: 種別判定（frontmatter かどうか）には使わないこと。
 * `-1` は「body 行なし」の汎用 sentinel であり、frontmatter discriminator
 * ではない。種別判定は `isFrontmatterTask()` を使用する。
 */
export function hasBodyLine(task: Pick<Task, 'line'>): boolean {
    return task.line >= 0;
}

/** True when the task has any date/time scheduling field. */
export function hasScheduling(
    task: Pick<Task, 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'due'>
): boolean {
    return !!(task.startDate || task.startTime || task.endDate || task.endTime || task.due);
}

/** True when the task has any calendar-date field (ignores time-only values). */
export function hasDates(
    task: Pick<Task, 'startDate' | 'endDate' | 'due'>
): boolean {
    return !!(task.startDate || task.endDate || task.due);
}

/**
 * Derived: a frontmatter task with no scheduling is a "container" — it groups
 * inline tasks from the same file without carrying dates itself. Replaces the
 * former Task.isContainer flag.
 */
export function isFrontmatterContainer(
    task: Pick<Task, 'parserId' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'due'>
): boolean {
    return isFrontmatterTask(task) && !hasScheduling(task);
}

/**
 * Wikilink reference extracted from frontmatter task body.
 * Stored separately from Task and consumed by WikiLinkResolver.
 */
export interface WikilinkRef {
    target: string;
    bodyLine: number;
}

/**
 * Options for duplicating tasks.
 * dayOffset: number of days to shift dates (default: 0 = in-place copy)
 * count: number of copies to create (default: 1)
 */
export interface DuplicateOptions {
    dayOffset?: number;
    count?: number;
}

/**
 * 表示用タスク型。暗黙値解決 + split 情報を統合。
 * Task（生データ）→ toDisplayTask() → DisplayTask の 2 層構造。
 * 編集パスは raw フィールド (startDate 等) のみを参照する。
 */
export interface DisplayTask extends Task {
    /** 暗黙値解決済みの effective フィールド */
    effectiveStartDate: string;
    effectiveStartTime?: string;
    effectiveEndDate?: string;
    effectiveEndTime?: string;
    /** 各フィールドが暗黙値かどうか */
    startDateImplicit: boolean;
    startTimeImplicit: boolean;
    endDateImplicit: boolean;
    endTimeImplicit: boolean;
    /** Split 情報（境界分割） */
    originalTaskId: string;
    isSplit: boolean;
    splitContinuesBefore?: boolean;
    splitContinuesAfter?: boolean;
}

export interface FlowCommand {
    name: string;
    args: string[];
    modifiers: FlowModifier[];
}

export interface FlowModifier {
    name: string;
    args: string[];
}

export interface ViewState {
    startDate: string;
    daysToShow: number;
    showSidebar: boolean;
    filterState?: FilterState;
    zoomLevel?: number;
    pinnedListCollapsed?: Record<string, boolean>;
    pinnedLists?: PinnedListDefinition[];
    customName?: string;
}

export interface PinnedListDefinition {
    id: string;
    name: string;
    filterState: FilterState;
    sortState?: SortState;
    applyViewFilter?: boolean;
}

export interface ViewTemplateSummary {
    filePath: string;
    name: string;
    viewType: string;
}

export interface ViewTemplate extends ViewTemplateSummary {
    days?: number;
    zoom?: number;
    showSidebar?: boolean;
    filterState?: FilterState;
    pinnedLists?: PinnedListDefinition[];
    grid?: PinnedListDefinition[][];
}

export interface FrontmatterTaskKeys {
    start: string;
    end: string;
    due: string;
    status: string;
    content: string;
    timerTargetId: string;
    color: string;
    linestyle: string;
    mask: string;
    ignore: string;
}

export const DEFAULT_FRONTMATTER_TASK_KEYS: FrontmatterTaskKeys = {
    start: 'tv-start',
    end: 'tv-end',
    due: 'tv-due',
    status: 'tv-status',
    content: 'tv-content',
    timerTargetId: 'tv-timer-target-id',
    color: 'tv-color',
    linestyle: 'tv-linestyle',
    mask: 'tv-mask',
    ignore: 'tv-ignore',
};

export function normalizeFrontmatterTaskKeys(value: unknown): FrontmatterTaskKeys {
    const source = (value && typeof value === 'object')
        ? value as Partial<Record<keyof FrontmatterTaskKeys, unknown>>
        : {};

    const normalize = (key: keyof FrontmatterTaskKeys): string => {
        const raw = source[key];
        if (typeof raw !== 'string') {
            return DEFAULT_FRONTMATTER_TASK_KEYS[key];
        }

        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : DEFAULT_FRONTMATTER_TASK_KEYS[key];
    };

    return {
        start: normalize('start'),
        end: normalize('end'),
        due: normalize('due'),
        status: normalize('status'),
        content: normalize('content'),
        timerTargetId: normalize('timerTargetId'),
        color: normalize('color'),
        linestyle: normalize('linestyle'),
        mask: normalize('mask'),
        ignore: normalize('ignore'),
    };
}

export function validateFrontmatterTaskKeys(keys: FrontmatterTaskKeys): string | null {
    const names: Array<keyof FrontmatterTaskKeys> = [
        'start',
        'end',
        'due',
        'status',
        'content',
        'timerTargetId',
        'color',
        'linestyle',
        'mask',
        'ignore',
    ];

    const normalizedValues = new Map<keyof FrontmatterTaskKeys, string>();
    for (const name of names) {
        const value = keys[name].trim();
        if (!value) {
            return 'Frontmatter keys cannot be empty.';
        }
        normalizedValues.set(name, value);
    }

    const seen = new Set<string>();
    for (const name of names) {
        const value = normalizedValues.get(name)!;
        if (seen.has(value)) {
            return `Frontmatter keys must be unique. Duplicate: "${value}".`;
        }
        seen.add(value);
    }

    return null;
}

export type DefaultLeafPosition = 'left' | 'right' | 'tab' | 'window';

export interface TaskViewerSettings {
    startHour: number;
    applyGlobalStyles: boolean;
    enableStatusMenu: boolean;
    statusDefinitions: StatusDefinition[];
    frontmatterTaskKeys: FrontmatterTaskKeys;
    zoomLevel: number;
    dailyNoteHeader: string;
    dailyNoteHeaderLevel: number;
    pomodoroWorkMinutes: number;
    pomodoroBreakMinutes: number;
    countdownMinutes: number;
    pastDaysToShow: number;
    startFromOldestOverdue: boolean;
    habitExcludeKeys: string[];
    frontmatterTaskHeader: string;
    frontmatterTaskHeaderLevel: number;
    longPressThreshold: number;
    taskSelectAction: 'click' | 'dblclick';
    reuseExistingTab: boolean;
    editorMenuForTasks: boolean;
    editorMenuForCheckboxes: boolean;
    fileMenuForFrontmatterTasks: boolean;
    calendarWeekStartDay: 0 | 1;
    calendarShowWeekNumbers: boolean;
    weeklyNoteFormat: string;
    weeklyNoteFolder: string;
    monthlyNoteFormat: string;
    monthlyNoteFolder: string;
    yearlyNoteFormat: string;
    yearlyNoteFolder: string;
    intervalTemplateFolder: string;
    viewTemplateFolder: string;
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
    suggestColor: boolean;
    suggestLinestyle: boolean;
    hideViewHeader: boolean;
    mobileTopOffset: number;
    fixMobileGradientWidth: boolean;

    // External parser support (read-only).
    enableTasksPlugin: boolean;
    enableDayPlanner: boolean;
    tasksPluginMapping: TasksPluginMapping;
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
    frontmatterTaskKeys: { ...DEFAULT_FRONTMATTER_TASK_KEYS },
    zoomLevel: 1.0,
    dailyNoteHeader: 'Tasks',
    dailyNoteHeaderLevel: 2,
    pomodoroWorkMinutes: 25,
    pomodoroBreakMinutes: 5,
    countdownMinutes: 25,
    pastDaysToShow: 0,
    startFromOldestOverdue: true,
    habitExcludeKeys: ['tags', 'cssclasses', 'aliases'],
    frontmatterTaskHeader: 'Tasks',
    frontmatterTaskHeaderLevel: 2,
    longPressThreshold: 400,
    taskSelectAction: 'click',
    reuseExistingTab: true,
    editorMenuForTasks: true,
    editorMenuForCheckboxes: true,
    fileMenuForFrontmatterTasks: true,
    calendarWeekStartDay: 0,
    calendarShowWeekNumbers: false,
    weeklyNoteFormat: 'gggg-[W]ww',
    weeklyNoteFolder: '',
    monthlyNoteFormat: 'YYYY-MM',
    monthlyNoteFolder: '',
    yearlyNoteFormat: 'YYYY',
    yearlyNoteFolder: '',
    intervalTemplateFolder: '',
    viewTemplateFolder: '',
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
    suggestColor: true,
    suggestLinestyle: true,
    hideViewHeader: true,
    mobileTopOffset: 32,
    fixMobileGradientWidth: true,
    enableTasksPlugin: false,
    enableDayPlanner: false,
    tasksPluginMapping: {
        start: 'startDate',
        scheduled: 'startDate',
        due: 'due',
    },
};
