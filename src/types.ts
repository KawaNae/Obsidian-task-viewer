/**
 * Check if a statusChar represents a complete (finished) task
 * Uses the settings to determine which characters are considered complete
 */
export function isCompleteStatusChar(statusChar: string, completeChars: string[]): boolean {
    return completeChars.includes(statusChar);
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
};
