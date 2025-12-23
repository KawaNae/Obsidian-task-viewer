import { Task } from '../types';

export class TaskParser {
    // Regex to match basic task structure: - [x] ...
    private static readonly BASIC_TASK_REGEX = /^(\s*)-\s*\[(.)\]\s*(.*)$/;

    // Regex for Date: @YYYY-MM-DD...
    private static readonly DATE_REGEX = /@(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?(?:>(?:(\d{2}:\d{2})|(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})))?/;

    // Regex for Recurrence: @repeat(...)
    private static readonly REPEAT_REGEX = /@repeat\((.*?)\)/;

    static parse(line: string, filePath: string, lineNumber: number): Task | null {
        const match = line.match(this.BASIC_TASK_REGEX);
        if (!match) {
            return null;
        }

        const [, indent, statusChar, rawContent] = match;

        // Extraction
        let content = rawContent;
        let date = '';
        let startTime: string | undefined;
        let endTime: string | undefined;
        let recurrence: string | undefined;

        // 1. Extract Recurrence
        const repeatMatch = content.match(this.REPEAT_REGEX);
        if (repeatMatch) {
            recurrence = repeatMatch[1];
            content = content.replace(this.REPEAT_REGEX, '').trim();
        }

        // 2. Extract Date
        const dateMatch = content.match(this.DATE_REGEX);
        if (dateMatch) {
            date = dateMatch[1];
            startTime = dateMatch[2];
            const endTimeSimple = dateMatch[3];
            const endTimeFull = dateMatch[4];
            endTime = endTimeFull || endTimeSimple;

            content = content.replace(this.DATE_REGEX, '').trim();
        }

        // Filter: Must have Date OR Recurrence to be considered a "Task" for this plugin
        // (Unless we want to show ALL tasks? Existing logic implied only dated tasks)
        // Spec says: Case B (No date but repeat) is allowed.
        if (!date && !recurrence) {
            return null;
        }

        let status: 'todo' | 'done' | 'cancelled' = 'todo';
        if (statusChar === 'x' || statusChar === 'X') status = 'done';
        if (statusChar === '-') status = 'cancelled';

        return {
            id: `${filePath}:${lineNumber}`,
            file: filePath,
            line: lineNumber,
            content: content,
            status,
            statusChar,
            date, // Can be empty string if only recurrence exists
            startTime,
            endTime,
            recurrence,
            originalText: line,
            children: []
        };
    }

    static format(task: Task): string {
        const statusChar = task.statusChar || (task.status === 'done' ? 'x' : (task.status === 'cancelled' ? '-' : ' '));
        let metaStr = '';

        if (task.recurrence) {
            metaStr += ` @repeat(${task.recurrence})`;
        }

        if (task.date) {
            let timeStr = `@${task.date}`;
            if (task.startTime) {
                timeStr += `T${task.startTime}`;
                if (task.endTime) {
                    timeStr += `>${task.endTime}`;
                }
            }
            metaStr += ` ${timeStr}`;
        }

        return `- [${statusChar}] ${task.content}${metaStr}`;
    }
}
