export type NormalizedTaskStatus = 'todo' | 'done' | 'cancelled' | 'exception' | 'unknown';

export interface NormalizedTask {
    id: string;
    contentHash: string;
    parser: string;
    sourcePath: string;
    locator: string;
    status: NormalizedTaskStatus;
    content: string;
    start: string | null;
    end: string | null;
    deadline: string | null;
    tags: string[];
    raw?: string;
}

export interface AiIndexMeta {
    version: number;
    pluginVersion: string;
    generatedAt: string;
    taskCount: number;
    fileCount: number;
    indexHash: string;
    pathHashes: Record<string, string>;
    lastError: string | null;
}

