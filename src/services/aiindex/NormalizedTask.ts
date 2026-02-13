export type NormalizedTaskStatus = 'todo' | 'done' | 'cancelled' | 'exception' | 'unknown';

export interface NormalizedTask {
    id: string;
    contentHash: string;
    parser: string;
    sourcePath: string;
    sourceLine: number | null;
    sourceCol: number | null;
    status: NormalizedTaskStatus;
    content: string;
    start: string | null;
    end: string | null;
    deadline: string | null;
    allDay: boolean;
    durationMinutes: number | null;
    project: string | null;
    tags: string[];
    priority: string | null;
    readOnly: boolean;
    raw: string;
    updatedAt: string;
}

export interface AiIndexMeta {
    version: number;
    generatedAt: string;
    taskCount: number;
    fileCount: number;
    indexHash: string;
    pathHashes: Record<string, string>;
    lastError: string | null;
}

