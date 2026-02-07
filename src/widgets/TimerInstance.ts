/**
 * Timer Instance Type Definition
 * 
 * Shared type for timer instances used by TimerWidget and TimerRecorder.
 */

export interface TimerInstance {
    id: string;
    taskId: string;
    taskName: string;
    taskOriginalText: string;  // Store original task line for reliable lookup after line shifts
    taskFile: string;          // Store file path for lookup
    startTime: Date;
    timeRemaining: number;
    totalTime: number;
    mode: 'work' | 'break' | 'idle';
    isRunning: boolean;
    isExpanded: boolean;
    intervalId: number | null;
    customLabel: string;
    timerType: 'pomodoro' | 'countup';
    elapsedTime: number; // for countup mode (seconds)
    // Real-time based calculation fields
    startTimeMs: number;       // Timestamp when timer was last started/resumed (ms)
    pausedElapsedTime: number; // Accumulated elapsed time before pause (seconds)
    autoRepeat: boolean;       // Whether to auto-restart work after break
    recordMode: 'child' | 'self';  // 'child': add as child task, 'self': update this task's start/end
    parserId: string;              // 'at-notation' | 'frontmatter' — determines write strategy
}
