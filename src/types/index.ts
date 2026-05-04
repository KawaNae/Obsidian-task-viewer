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

/**
 * Ordered partition of a task's body children. Parser/index ensures each
 * absolute file line is owned by exactly one ChildEntry across all tasks.
 *
 * - `task`: line is occupied by an independent child task (resolved via TaskIndex)
 * - `wikilink`: line references another file's tv-file task (unresolved)
 * - `line`: raw checkbox / property / text line under this task (unrelated to
 *   the legacy `'plain'` parserId migration alias in TimerPersistence)
 *
 * Render layer walks `task.children` directly without re-classifying.
 * Write layer uses `bodyLine` as the absolute file line for surgical edits.
 */
export type ChildEntry =
    | { kind: 'task'; taskId: string; bodyLine: number }
    | { kind: 'wikilink'; target: string; bodyLine: number; line: ChildLine }
    | { kind: 'line'; line: ChildLine; bodyLine: number };

/**
 * Identifier of the parser that produced a task.
 *
 * Production parsers emit one of these four values. Legacy persisted values
 * (`'at-notation'`, `'frontmatter'`, `'plain'`) are migrated at load time
 * by `TimerPersistence.normalizeParserId`; they never appear on a live Task.
 */
export type ParserId = 'tv-inline' | 'tv-file' | 'tasks-plugin' | 'day-planner';

export interface Task {
    // Identity and source location.
    id: string;
    file: string;
    /**
     * 0-indexed line number in the source file.
     * `-1` is a generic sentinel meaning "no body line" (e.g., frontmatter root tasks).
     * Use `hasBodyLine(task)` to test validity. `-1` is NOT a frontmatter discriminator
     * — use `isTvFile(task)` for type identification.
     */
    line: number;

    // Core task text/status.
    content: string;
    statusChar: string;

    // Tree relationship.
    parentId?: string;
    indent: number;
    /**
     * @internal Parser-emitted ids of independent child tasks. Substrate for
     * `buildChildEntries`; render/write consume via `DisplayTask.childEntries`.
     */
    childIds: string[];
    /**
     * @internal Parser-emitted raw body lines. Substrate for
     * `buildChildEntries`; render/write consume via `DisplayTask.childEntries`.
     */
    childLines: ChildLine[];
    /**
     * @internal Absolute file line per `childLines` entry. Substrate for
     * `buildChildEntries`; render/write consume via `DisplayTask.childEntries`.
     */
    childLineBodyOffsets: number[];

    // Date/time fields.
    startDate?: string;
    startTime?: string;
    /**
     * Raw end date as written in @notation / frontmatter. **Dual semantic**:
     * - When `endTime` is present → `endDate` is **inclusive** (the calendar
     *   date on which `endTime` occurs).
     * - When `endTime` is absent (pure all-day) → `endDate` is **exclusive**
     *   (one day past the last day the task covers).
     *
     * This duality is preserved at the raw layer for parser/writer round-trip
     * with the external @notation. Display code should not read `endDate`
     * directly; use `DisplayTask.effectiveEndDate` (always inclusive visual
     * end) instead. Drag write-back must funnel updates through
     * `materializeRawDates()` which collapses the duality based on
     * `baseTask.endTime`.
     */
    endDate?: string;
    endTime?: string;
    due?: string;

    /**
     * True when startDate was inherited from the daily note filename at parse time
     * (tv-inline only; tv-file never sets this). Set by `resolveDailyNoteDates()`
     * via `TreeTaskExtractor`.
     *
     * Read by 3 layers:
     * - `DisplayTaskConverter.toDisplayTask` — derives `startDateImplicit` /
     *   `startDateExplicit` so display marks the value as non-explicit.
     * - `TVInlineParser.format` — emits time-only notation (`@HH:mm`) instead of
     *   the full `@YYYY-MM-DDTHH:mm` form, preserving round-trip with the original
     *   markdown.
     * - `TaskIndex.updateTask` / `MoveCommand` / `GenerationCommands` — clear to
     *   `false` when an explicit startDate is set, moved, or recurrence-spawned.
     */
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
     * Parser identifier that produced this task. See {@link ParserId}.
     * Used for parser-specific writeback behavior.
     */
    parserId: ParserId;

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

/** TaskViewer file-form (frontmatter) task. */
export function isTvFile(task: Pick<Task, 'parserId'>): boolean {
    return task.parserId === 'tv-file';
}

/** TaskViewer inline-form task (writable; primary write target). */
export function isTvInline(task: Pick<Task, 'parserId'>): boolean {
    return task.parserId === 'tv-inline';
}

/** Day Planner inline-form task (read-only). */
export function isDpInline(task: Pick<Task, 'parserId'>): boolean {
    return task.parserId === 'day-planner';
}

/** Tasks Plugin inline-form task (read-only). */
export function isTpInline(task: Pick<Task, 'parserId'>): boolean {
    return task.parserId === 'tasks-plugin';
}

/**
 * task.line が body 行アクセスに使える有効値かを判定する。
 * `false` の場合: tv-file task (line === -1) など、ファイル本体に
 * 紐付く行を持たないタスク。
 *
 * 注意: 種別判定（file-form かどうか）には使わないこと。
 * `-1` は「body 行なし」の汎用 sentinel であり、形式 discriminator
 * ではない。種別判定は `isTvFile()` を使用する。
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
 * Derived: a tv-file task with no scheduling. Groups inline tasks from the
 * same file without carrying dates itself. Replaces the former Task.isContainer
 * flag.
 */
export function isTvFileUnscheduled(
    task: Pick<Task, 'parserId' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'due'>
): boolean {
    return isTvFile(task) && !hasScheduling(task);
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
 * 表示用タスク型。暗黙値解決 + split 情報 + 子要素 partition を統合。
 * Task（生データ）→ toDisplayTask() → DisplayTask の 2 層構造。
 * 編集パスは raw フィールド (startDate 等) のみを参照する。
 */
export interface DisplayTask extends Task {
    /**
     * 暗黙値解決済みの effective フィールド (inclusive visual coordinates).
     *
     * `effectiveEndDate` は **常に inclusive な visual 終端日**として扱う。
     * raw `Task.endDate` の `endTime` 有無による inclusive/exclusive の二重規格
     * (Task.endDate 参照) は `toDisplayTask` が implicit endTime 注入 +
     * `toVisualDate` シフトで吸収するため、display/render/drag layer は
     * 統一的に inclusive として読み書きできる。
     */
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
    /**
     * Materialized child entries (body 順、1 行 1 オーナー)。
     * Task.childIds / childLines / childLineBodyOffsets から
     * `buildChildEntries` で derive。render / write の唯一の入口。
     */
    childEntries: ChildEntry[];
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

export interface TvFileKeys {
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

export const DEFAULT_TV_FILE_KEYS: TvFileKeys = {
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

export function normalizeTvFileKeys(value: unknown): TvFileKeys {
    const source = (value && typeof value === 'object')
        ? value as Partial<Record<keyof TvFileKeys, unknown>>
        : {};

    const normalize = (key: keyof TvFileKeys): string => {
        const raw = source[key];
        if (typeof raw !== 'string') {
            return DEFAULT_TV_FILE_KEYS[key];
        }

        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : DEFAULT_TV_FILE_KEYS[key];
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

export function validateTvFileKeys(keys: TvFileKeys): string | null {
    const names: Array<keyof TvFileKeys> = [
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

    const normalizedValues = new Map<keyof TvFileKeys, string>();
    for (const name of names) {
        const value = keys[name].trim();
        if (!value) {
            return 'tv-file keys cannot be empty.';
        }
        normalizedValues.set(name, value);
    }

    const seen = new Set<string>();
    for (const name of names) {
        const value = normalizedValues.get(name)!;
        if (seen.has(value)) {
            return `tv-file keys must be unique. Duplicate: "${value}".`;
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
    tvFileKeys: TvFileKeys;
    zoomLevel: number;
    dailyNoteHeader: string;
    dailyNoteHeaderLevel: number;
    pomodoroWorkMinutes: number;
    pomodoroBreakMinutes: number;
    countdownMinutes: number;
    pastDaysToShow: number;
    startFromOldestOverdue: boolean;
    habitExcludeKeys: string[];
    tvFileChildHeader: string;
    tvFileChildHeaderLevel: number;
    longPressThreshold: number;
    reuseExistingTab: boolean;
    editorMenuForTasks: boolean;
    editorMenuForCheckboxes: boolean;
    fileMenuForTvFile: boolean;
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
    /** 子要素がこの数以上のとき、タスクカードはトグル付きの折りたたみ表示になる (1〜5) */
    childCollapseThreshold: number;
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
    tvFileKeys: { ...DEFAULT_TV_FILE_KEYS },
    zoomLevel: 1.0,
    dailyNoteHeader: 'Tasks',
    dailyNoteHeaderLevel: 2,
    pomodoroWorkMinutes: 25,
    pomodoroBreakMinutes: 5,
    countdownMinutes: 25,
    pastDaysToShow: 0,
    startFromOldestOverdue: true,
    habitExcludeKeys: ['tags', 'cssclasses', 'aliases'],
    tvFileChildHeader: 'Tasks',
    tvFileChildHeaderLevel: 2,
    longPressThreshold: 400,
    reuseExistingTab: true,
    editorMenuForTasks: true,
    editorMenuForCheckboxes: true,
    fileMenuForTvFile: true,
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
    childCollapseThreshold: 3,
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
