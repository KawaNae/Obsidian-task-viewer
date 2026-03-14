import type { Task, DisplayTask } from '../types';

export interface CliTaskOutput {
    id: string;
    file: string;
    line: number;
    content: string;
    status: string;
    startDate: string | null;
    startTime: string | null;
    endDate: string | null;
    endTime: string | null;
    due: string | null;
    tags: string[];
    parserId: string;
    parentId: string | null;
    childIds: string[];
    color: string | null;
    linestyle: string | null;
}

export function formatTask(task: Task | DisplayTask): CliTaskOutput {
    return {
        id: task.id,
        file: task.file,
        line: task.line,
        content: task.content,
        status: task.statusChar,
        startDate: task.startDate ?? null,
        startTime: task.startTime ?? null,
        endDate: task.endDate ?? null,
        endTime: task.endTime ?? null,
        due: task.due ?? null,
        tags: task.tags,
        parserId: task.parserId,
        parentId: task.parentId ?? null,
        childIds: task.childIds,
        color: task.color ?? null,
        linestyle: task.linestyle ?? null,
    };
}

export function formatTaskList(tasks: (Task | DisplayTask)[]): { count: number; tasks: CliTaskOutput[] } {
    return {
        count: tasks.length,
        tasks: tasks.map(formatTask),
    };
}

export function cliOk(data: Record<string, unknown>): string {
    return JSON.stringify(data);
}

export function cliError(message: string): string {
    return JSON.stringify({ error: message });
}
