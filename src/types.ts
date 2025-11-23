export interface Task {
    id: string;             // Unique identifier (file path + line number)
    file: string;           // Absolute file path
    line: number;           // Line number (0-indexed)
    content: string;        // Task description (without checkbox and time)
    status: 'todo' | 'done' | 'cancelled';

    // Date/Time info
    date: string;           // YYYY-MM-DD
    startTime?: string;     // HH:mm
    endTime?: string;       // HH:mm

    // Original text for reconstruction
    originalText: string;

    // Child lines (sub-tasks, notes)
    children: string[];
}

export interface ViewState {
    startDate: string;      // YYYY-MM-DD
    daysToShow: number;     // 1, 3, 7, etc.
}
