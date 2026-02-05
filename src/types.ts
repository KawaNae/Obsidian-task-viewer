import { DateUtils } from './utils/DateUtils';

/**
 * Check if a statusChar represents a complete (finished) task
 * Uses the settings to determine which characters are considered complete
 */
export function isCompleteStatusChar(statusChar: string, completeChars: string[]): boolean {
    return completeChars.includes(statusChar);
}

/**
 * Check if a task should be split for timeline rendering
 * A task should be split if:
 * 1. It has both start and end date/time
 * 2. It crosses a visual day boundary (startHour)
 * 3. Duration is less than 24 hours
 */
export function shouldSplitTask(task: Task, startHour: number): boolean {
    if (!task.startDate || !task.endDate || !task.startTime || !task.endTime) {
        return false;
    }

    // Calculate duration in hours to ensure we don't split really long tasks (logic from before)
    // Note: DateUtils.getTaskDurationMs is more accurate but let's keep it simple here or reuse if we imported it
    // We can use a simpler check for visual days.

    // 1. Get Visual Start Day
    const visualStartDay = DateUtils.getVisualStartDate(task.startDate, task.startTime, startHour);

    // 2. Get Visual End Day
    // Logic: If endTime is strictly > StartHour, it belongs to that calendar day.
    // If endTime <= StartHour (and m=0), it belongs to previous calendar day (visually).
    // Actually, let's look at `DateUtils.getVisualStartDate` equivalent for End Time.
    // Spec: "Visual day ends at StartHour:00 of the next day".
    // So 05:00 belongs to the END of the previous visual day ?
    // Or start of next?
    // In our timeline, 05:00 is the top of the day.
    // So 04:59 is bottom of previous.
    // If a task ends at 05:00, it ends at the top of the NEXT day visually? 
    // No, if it ends at 05:00, it touches the boundary.
    // Ideally, a task 23:00-05:00 should NOT split.
    // A task 23:00-05:01 SHOULD split (1 minute in next day).

    let visualEndDay = task.endDate;
    const [endH, endM] = task.endTime.split(':').map(Number);

    // If time is strictly before startHour, OR exactly startHour:00
    // Then it belongs to the previous visual day block.
    // e.g. 03:00 < 05:00 -> Previous
    // 05:00 == 05:00 -> Previous (End Boundary)
    // 05:01 > 05:00 -> Current (Next Visual Day)

    if (endH < startHour || (endH === startHour && endM === 0)) {
        visualEndDay = DateUtils.addDays(task.endDate, -1);
    } else {
        // >= StartHour:01 (approx)
        visualEndDay = task.endDate;
    }

    // 3. Comparison
    if (visualStartDay !== visualEndDay) {
        // It crosses a boundary
        return true;
    }

    // 4. Double check length < 24h?
    // If visual days are different, it might be a huge task (2 days long).
    // The original code had: if (durationHours >= 24) return false;
    // We should preserve that check to avoid splitting 48h tasks into 2 pieces (logic elsewhere handles long tasks?)
    // But RenderableTask splitting usually handles 1 split.

    const startDateTime = new Date(`${task.startDate}T${task.startTime}`);
    // Handle next-day calculation for duration check simplistically
    let endDateForCalc = task.endDate;
    if (task.endTime < task.startTime && task.endDate === task.startDate) {
        // Implicit next day? No, task always has endDate nowadays if properly parsed
        // But let's trust dates.
    }
    // Let's just trust Date object calc
    let endDateTime = new Date(`${task.endDate}T${task.endTime}`);
    // If end < start (sanity check, inconsistent data), swap? No.
    if (endDateTime < startDateTime) return false; // Invalid 

    const durationHours = (endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);
    if (durationHours >= 24) return false;

    return false; // Visual days are same
}

/**
 * Renderable task type - purely for view representation.
 * Represents a visual segment of a task.
 */
export interface RenderableTask extends Task {
    // Unique identifier for the DOM element (e.g. "taskid:before")
    id: string;

    // Link back to the original data model
    originalTaskId: string;

    // Split metadata
    isSplit: boolean;
    splitSegment?: 'before' | 'after';

    // Read-only flag for interaction handling
    _isReadOnly?: boolean;
}

/**
 * Split a task into before and after segments at the day boundary
 * Returns two RenderableTask objects representing each segment
 */
export function splitTaskAtBoundary(task: Task, startHour: number): [RenderableTask, RenderableTask] {
    if (!task.startDate || !task.endDate || !task.startTime || !task.endTime) {
        throw new Error('Task must have start and end date/time to split');
    }

    // Calculate the boundary date/time
    let boundaryDate: string;
    const boundaryTime = `${startHour.toString().padStart(2, '0')}:00`;

    if (task.startDate === task.endDate) {
        // Same calendar date, but crosses visual day boundary at startHour
        // e.g., @2026-02-01T02:00>08:00 with startHour=5
        // Boundary is at 2026-02-01 05:00
        boundaryDate = task.startDate;
    } else {
        // Different calendar dates
        // Boundary is at the next day at startHour
        const startDateObj = new Date(task.startDate);
        const boundaryDateObj = new Date(startDateObj);
        boundaryDateObj.setDate(boundaryDateObj.getDate() + 1);
        boundaryDate = boundaryDateObj.toISOString().split('T')[0];
    }

    // Before segment: original start -> boundary
    const beforeSegment: RenderableTask = {
        ...task,
        id: `${task.id}:before`,
        originalTaskId: task.id,
        isSplit: true,
        splitSegment: 'before',
        endDate: boundaryDate,
        endTime: boundaryTime,
        // _splitInfo is deprecated in favor of explicit fields in RenderableTask, 
        // but keeping it for backward compat if needed during transition or just removing it if safe.
        // Let's rely on the new fields.
    };

    // After segment: boundary -> original end
    const afterSegment: RenderableTask = {
        ...task,
        id: `${task.id}:after`,
        originalTaskId: task.id,
        isSplit: true,
        splitSegment: 'after',
        startDate: boundaryDate,
        startTime: boundaryTime,
    };

    return [beforeSegment, afterSegment];
}

export type HabitType = 'boolean' | 'number' | 'string';

export interface HabitDefinition {
    name: string;    // frontmatter キー名をそのまま使用
    type: HabitType;
    unit?: string;   // 表示用単位ラベル (number のみ)
}

export interface Task {
    id: string;             // Unique identifier (file path + line number)
    file: string;           // Absolute file path
    line: number;           // Line number (0-indexed)
    content: string;        // Task description (without checkbox and time)
    statusChar: string;     // The actual character inside [ ]

    // Tree Structure
    parentId?: string;      // Parent task ID (undefined if root-level)
    indent: number;         // Leading whitespace count (spaces)
    childIds: string[];     // IDs of direct child tasks (parsed as separate Tasks)
    childLines: string[];   // Raw child lines for display (normalized indentation)

    // Date/Time info
    startDate?: string;      // Renamed from date, YYYY-MM-DD (Optional for D/E types)
    startTime?: string;     // HH:mm
    endDate?: string;       // Added, YYYY-MM-DD
    endTime?: string;       // HH:mm
    deadline?: string;      // Added, YYYY-MM-DD or ISO


    // Inheritance flag - true if dates were inherited from parent (should be omitted on write)
    startDateInherited?: boolean;

    // Explicit field flags - indicate which fields were explicitly written in markdown
    // Used for UI display to distinguish implicit (gray) from explicit (normal) values
    explicitStartDate?: boolean;  // true if YYYY-MM-DD was written in start position
    explicitStartTime?: boolean;  // true if HH:mm was written in start position
    explicitEndDate?: boolean;    // true if YYYY-MM-DD was written in end position
    explicitEndTime?: boolean;    // true if HH:mm was written in end position

    // Original text for reconstruction
    originalText: string;
    recurrence?: string;    // @repeat(...) content

    // Flow Commands
    commands?: FlowCommand[];

    // Validation warning - set during parse if task has formatting issues
    validationWarning?: string;

    /**
     * Parser identifier - indicates which parser created this task.
     * Examples: 'taskviewer', 'frontmatter', 'dataview', 'dayplanner'
     * @internal
     */
    parserId?: string;
}

export interface FlowCommand {
    name: string;           // e.g. 'next', 'repeat', 'move'
    args: string[];         // e.g. ['daily'], ['archive.md']
    modifiers: FlowModifier[];
}

export interface FlowModifier {
    name: string;           // e.g. 'as'
    args: string[];         // e.g. ['New Name']
}

export interface ViewState {
    startDate: string;      // YYYY-MM-DD
    daysToShow: number;     // 1, 3, 7, etc.
    showDeadlineList: boolean; // Toggle for right sidebar
    filterFiles: string[] | null; // Persisted file filter (null = all visible)
}

export interface TaskViewerSettings {
    startHour: number;      // 0-23
    applyGlobalStyles: boolean; // Whether to apply checkbox styles globally
    frontmatterColorKey: string; // Key to look for in frontmatter for color
    zoomLevel: number;      // 0.25 - 4.0 (default 1.0)
    dailyNoteHeader: string; // Header to add tasks under (default: "Tasks")
    dailyNoteHeaderLevel: number; // Header level (default: 2)
    pomodoroWorkMinutes: number;  // Pomodoro work duration (default: 25)
    pomodoroBreakMinutes: number; // Pomodoro break duration (default: 5)
    completeStatusChars: string[]; // Characters that represent completed tasks (default: ['x', '-', '!'])
    excludedPaths: string[]; // Paths to exclude from task scanning
    defaultDeadlineOffset: number; // Default number of days from today for new deadline tasks (default: 0)
    upcomingDays: number; // Days from tomorrow to consider as "Upcoming" in deadline list (default: 7)
    pastDaysToShow: number; // Number of past days to always show in timeline (default: 0)
    habits: HabitDefinition[]; // User-defined habit list (empty = feature invisible)
}

export const DEFAULT_SETTINGS: TaskViewerSettings = {
    startHour: 5,
    applyGlobalStyles: false,
    frontmatterColorKey: 'color',
    zoomLevel: 1.0,
    dailyNoteHeader: 'Tasks',
    dailyNoteHeaderLevel: 2,
    pomodoroWorkMinutes: 25,
    pomodoroBreakMinutes: 5,
    completeStatusChars: ['x', 'X', '-', '!'],
    excludedPaths: [],
    defaultDeadlineOffset: 0,
    upcomingDays: 7,
    pastDaysToShow: 0,
    habits: [],
};
