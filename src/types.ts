/**
 * Task status type - represents the semantic state of a task
 * Complete states: done, cancelled, failed
 * Incomplete states: todo, blocked, postponed
 */
export type TaskStatusType = 'todo' | 'done' | 'cancelled' | 'failed' | 'blocked' | 'postponed';

/** 
 * Check if a status represents a complete (finished) task 
 */
export function isCompleteStatus(status: TaskStatusType): boolean {
    return status === 'done' || status === 'cancelled' || status === 'failed';
}

export interface Task {
    id: string;             // Unique identifier (file path + line number)
    file: string;           // Absolute file path
    line: number;           // Line number (0-indexed)
    content: string;        // Task description (without checkbox and time)
    status: TaskStatusType;
    statusChar: string;     // The actual character inside [ ]

    // Date/Time info
    // Date/Time info
    startDate?: string;      // Renamed from date, YYYY-MM-DD (Optional for D/E types)
    startTime?: string;     // HH:mm
    endDate?: string;       // Added, YYYY-MM-DD
    endTime?: string;       // HH:mm
    deadline?: string;      // Added, YYYY-MM-DD or ISO
    isFuture: boolean;      // Added, true if startDate is empty or "future"


    // Original text for reconstruction
    originalText: string;
    recurrence?: string;    // @repeat(...) content

    // Child lines (sub-tasks, notes)
    children: string[];

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
};
