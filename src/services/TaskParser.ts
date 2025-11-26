import { Task } from '../types';

export class TaskParser {
    // Regex to match: - [x] Task Content @YYYY-MM-DDTHH:mm>HH:mm
    // Supports:
    // @YYYY-MM-DD
    // @YYYY-MM-DDTHH:mm
    // @YYYY-MM-DDTHH:mm>HH:mm
    // @YYYY-MM-DDTHH:mm>YYYY-MM-DDTHH:mm (Cross-day)
    private static readonly TASK_REGEX = /^(\s*)-\s*\[(.)\]\s*(.*?)\s*@(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?(?:>(?:(\d{2}:\d{2})|(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})))?.*$/;

    static parse(line: string, filePath: string, lineNumber: number): Task | null {
        const match = line.match(this.TASK_REGEX);
        if (!match) {
            return null;
        }

        const [
            ,
            indent,
            statusChar,
            content,
            date,
            startTime,
            endTimeSimple,
            endTimeFull
        ] = match;

        let status: 'todo' | 'done' | 'cancelled' = 'todo';
        if (statusChar === 'x' || statusChar === 'X') status = 'done';
        if (statusChar === '-') status = 'cancelled';

        return {
            id: `${filePath}:${lineNumber}`,
            file: filePath,
            line: lineNumber,
            content: content.trim(),
            status,
            date,
            startTime,
            endTime: endTimeFull || endTimeSimple,
            originalText: line,
            children: []
        };
    }

    static format(task: Task): string {
        const statusChar = task.status === 'done' ? 'x' : (task.status === 'cancelled' ? '-' : ' ');
        let timeStr = `@${task.date}`;

        if (task.startTime) {
            timeStr += `T${task.startTime}`;
            if (task.endTime) {
                timeStr += `>${task.endTime}`;
            }
        }

        return `- [${statusChar}] ${task.content} ${timeStr}`;
    }
}
