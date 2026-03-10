import { DEFAULT_AI_INDEX_SETTINGS } from './services/aiindex/AiIndexSettings';
import type { AiIndexSettings } from './services/aiindex/AiIndexSettings';
import type { FilterState } from './services/filter/FilterTypes';
import type { SortState } from './services/sort/SortTypes';

/**
 * Returns true when statusChar is considered completed by settings.
 */
export function isCompleteStatusChar(statusChar: string, completeChars: string[]): boolean {
    return completeChars.includes(statusChar);
}

export type HabitType = 'boolean' | 'number' | 'string';

export interface HabitDefinition {
    // Frontmatter key name used to store habit value.
    name: string;
    type: HabitType;
    // Optional display unit for number habits.
    unit?: string;
}

export interface Task {
    // Identity and source location.
    id: string;
    file: string;
    line: number;

    // Core task text/status.
    content: string;
    statusChar: string;

    // Tree relationship.
    parentId?: string;
    indent: number;
    childIds: string[];
    childLines: string[];
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

    // Parse-time warning shown to users.
    validationWarning?: string;

    // Frontmatter-task wikilink metadata (used by WikiLinkResolver).
    wikiLinkTargets?: string[];
    wikiLinkBodyLines?: number[];

    /**
     * Parser identifier that produced this task (e.g. at-notation/frontmatter).
     * Used for parser-specific writeback behavior.
     */
    parserId: string;

    // File-level styling from frontmatter (resolved at scan time).
    color?: string;
    linestyle?: string;
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
    /** Split 情報（日跨ぎ分割） */
    originalTaskId: string;
    isSplit: boolean;
    splitSegment?: 'head' | 'tail';
    _isReadOnly?: boolean;
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
    filterFiles: string[] | null;
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
    tags: string;
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
    tags: 'tv-tags',
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
        tags: normalize('tags'),
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
        'tags',
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
    statusMenuChars: string[];
    aiIndex: AiIndexSettings;
    frontmatterTaskKeys: FrontmatterTaskKeys;
    zoomLevel: number;
    dailyNoteHeader: string;
    dailyNoteHeaderLevel: number;
    pomodoroWorkMinutes: number;
    pomodoroBreakMinutes: number;
    countdownMinutes: number;
    completeStatusChars: string[];
    pastDaysToShow: number;
    habits: HabitDefinition[];
    frontmatterTaskHeader: string;
    frontmatterTaskHeaderLevel: number;
    longPressThreshold: number;
    taskSelectAction: 'click' | 'dblclick';
    reuseExistingTab: boolean;
    editorMenuForTasks: boolean;
    editorMenuForCheckboxes: boolean;
    calendarWeekStartDay: 0 | 1;
    calendarShowCompleted: boolean;
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
}

export const DEFAULT_SETTINGS: TaskViewerSettings = {
    startHour: 5,
    applyGlobalStyles: false,
    enableStatusMenu: true,
    statusMenuChars: ['-', '!', '?', '>', '/'],
    aiIndex: { ...DEFAULT_AI_INDEX_SETTINGS },
    frontmatterTaskKeys: { ...DEFAULT_FRONTMATTER_TASK_KEYS },
    zoomLevel: 1.0,
    dailyNoteHeader: 'Tasks',
    dailyNoteHeaderLevel: 2,
    pomodoroWorkMinutes: 25,
    pomodoroBreakMinutes: 5,
    countdownMinutes: 25,
    completeStatusChars: ['x', 'X', '-', '!'],
    pastDaysToShow: 0,
    habits: [],
    frontmatterTaskHeader: 'Tasks',
    frontmatterTaskHeaderLevel: 2,
    longPressThreshold: 400,
    taskSelectAction: 'click',
    reuseExistingTab: true,
    editorMenuForTasks: true,
    editorMenuForCheckboxes: true,
    calendarWeekStartDay: 0,
    calendarShowCompleted: true,
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
};
