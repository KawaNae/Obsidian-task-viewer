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
    
    // Calculate duration in hours
    const startDateTime = new Date(`${task.startDate}T${task.startTime}`);
    const endDateTime = new Date(`${task.endDate}T${task.endTime}`);
    const durationHours = (endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);
    
    // Only split if duration < 24 hours
    if (durationHours >= 24) {
        return false;
    }
    
    // Check if task crosses visual day boundary
    // Visual day boundary is at startHour:00
    const startHourNum = parseInt(task.startTime.split(':')[0]);
    const endHourNum = parseInt(task.endTime.split(':')[0]);
    
    // If calendar dates are different, definitely crosses boundary
    if (task.startDate !== task.endDate) {
        return true;
    }
    
    // Same calendar date: check if times straddle the startHour boundary
    // e.g., startHour=5, startTime=02:00, endTime=08:00
    // 02:00 < 5 (previous visual day), 08:00 >= 5 (current visual day) → split needed
    if (startHourNum < startHour && endHourNum >= startHour) {
        return true;
    }
    
    return false;
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
        endDate: boundaryDate,
        endTime: boundaryTime,
        _splitInfo: {
            originalTaskId: task.id,
            segment: 'before',
            boundaryDate,
            boundaryTime
        }
    };
    
    // After segment: boundary -> original end
    const afterSegment: RenderableTask = {
        ...task,
        id: `${task.id}:after`,
        startDate: boundaryDate,
        startTime: boundaryTime,
        _splitInfo: {
            originalTaskId: task.id,
            segment: 'after',
            boundaryDate,
            boundaryTime
        }
    };
    
    return [beforeSegment, afterSegment];
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
    isFuture: boolean;      // Added, true if startDate is empty or "future"

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

/**
 * Split task boundary information
 * Used when a task crosses the visual day boundary (startHour)
 */
export interface TaskSplitInfo {
    originalTaskId: string;        // ID of the original task before splitting
    segment: 'before' | 'after';   // Which segment this represents
    boundaryDate: string;          // YYYY-MM-DD of the boundary
    boundaryTime: string;          // HH:mm of the boundary (typically startHour)
}

/**
 * Renderable task type - may be split version of original Task
 * Used in rendering layers (TimelineSectionRenderer, etc.)
 */
export interface RenderableTask extends Task {
    _splitInfo?: TaskSplitInfo;    // Present if this is a split segment
    _isReadOnly?: boolean;          // If true, disable handle operations
}

export interface ViewState {
    startDate: string;      // YYYY-MM-DD
    daysToShow: number;     // 1, 3, 7, etc.
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
};
