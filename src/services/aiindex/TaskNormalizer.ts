import type { Task } from '../../types';
import type { NormalizedTask, NormalizedTaskStatus } from './NormalizedTask';
import { TaskIdGenerator } from '../../utils/TaskIdGenerator';
import { getFileBaseName } from '../../utils/TaskContent';
import { TagExtractor } from '../../utils/TagExtractor';

export interface TaskNormalizerOptions {
    completeStatusChars: string[];
    includeParsers: Set<string>;
    includeDone: boolean;
    includeRaw: boolean;
    keepDoneDays: number;
    snapshotAt: string;
}

interface NormalizedTaskEntry {
    task: NormalizedTask;
    sortLine: number | null;
}

export class TaskNormalizer {
    normalizeTasks(tasks: Task[], options: TaskNormalizerOptions): Map<string, NormalizedTask[]> {
        const byPath = new Map<string, Map<string, NormalizedTaskEntry>>();

        for (const task of tasks) {
            const normalizedEntry = this.normalizeTask(task, options);
            if (!normalizedEntry) {
                continue;
            }

            const normalizedTask = normalizedEntry.task;
            let pathBucket = byPath.get(normalizedTask.sourcePath);
            if (!pathBucket) {
                pathBucket = new Map<string, NormalizedTaskEntry>();
                byPath.set(normalizedTask.sourcePath, pathBucket);
            }
            if (pathBucket.has(normalizedTask.id)) {
                console.warn(`[TaskNormalizer] Duplicate task ID in ${normalizedTask.sourcePath}: ${normalizedTask.id}`);
            }
            pathBucket.set(normalizedTask.id, normalizedEntry);
        }

        const result = new Map<string, NormalizedTask[]>();
        for (const [path, entries] of byPath) {
            const tasksForPath = Array.from(entries.values()).sort((a, b) => {
                const lineA = a.sortLine ?? Number.MAX_SAFE_INTEGER;
                const lineB = b.sortLine ?? Number.MAX_SAFE_INTEGER;
                if (lineA !== lineB) {
                    return lineA - lineB;
                }
                return a.task.id.localeCompare(b.task.id);
            }).map((entry) => entry.task);
            result.set(path, tasksForPath);
        }

        return result;
    }

    normalizeTask(task: Task, options: TaskNormalizerOptions): NormalizedTaskEntry | null {
        const parsedTaskId = TaskIdGenerator.parse(task.id);
        if (!parsedTaskId) {
            console.warn(`[TaskNormalizer] Skipping task with unsupported id format: ${task.id}`);
            return null;
        }

        const parser = this.normalizeParser(parsedTaskId.parserId);
        if (!options.includeParsers.has(parser)) {
            return null;
        }

        const sortLine = task.line >= 0 ? task.line + 1 : null;
        const sourcePath = parsedTaskId.filePath;
        const locator = parsedTaskId.anchor;
        const effectiveContent = this.resolveEffectiveContent(task.content, parser, sourcePath);

        const start = this.composeDateTime(task.startDate, task.startTime);
        const end = this.composeDateTime(task.endDate, task.endTime);
        const deadline = this.normalizeDeadline(task.deadline);

        const status = this.resolveStatus(task.statusChar, options.completeStatusChars);
        if (!options.includeDone && status !== 'todo' && status !== 'unknown') {
            return null;
        }
        if (options.keepDoneDays > 0 && status !== 'todo' && status !== 'unknown') {
            if (!this.isWithinRetention(task, options.keepDoneDays, options.snapshotAt)) {
                return null;
            }
        }

        const tags = task.tags.length > 0 ? task.tags : TagExtractor.fromContent(effectiveContent);
        const raw = task.originalText && task.originalText.trim().length > 0
            ? task.originalText.trim()
            : this.buildFrontmatterRaw(task);
        const id = TaskIdGenerator.generate(parser, sourcePath, parsedTaskId.anchor);

        const contentHash = this.hashToHex([
            parser,
            sourcePath,
            locator,
            status,
            effectiveContent,
            start ?? '',
            end ?? '',
            deadline ?? '',
            tags.slice().sort().join(','),
            '',
            raw,
        ].join('|'));

        const result: NormalizedTask = {
            id,
            contentHash,
            parser,
            sourcePath,
            locator,
            status,
            content: effectiveContent,
            start,
            end,
            deadline,
            tags,
        };
        if (options.includeRaw) {
            result.raw = raw;
        }
        return {
            task: result,
            sortLine,
        };
    }

    normalizeParser(parserId: string): string {
        if (parserId === 'at-notation') {
            return 'inline';
        }
        if (parserId === 'frontmatter') {
            return 'frontmatter';
        }
        return parserId;
    }

    hashTasksForPath(tasks: NormalizedTask[]): string {
        const raw = tasks
            .map((task) => `${task.id}:${task.contentHash}`)
            .join('|');
        return this.hashToHex(raw);
    }

    hashText(raw: string): string {
        return this.hashToHex(raw);
    }

    private resolveStatus(statusChar: string, completeStatusChars: string[]): NormalizedTaskStatus {
        if (!statusChar || statusChar === ' ') {
            return 'todo';
        }
        if (!completeStatusChars.includes(statusChar)) {
            return 'unknown';
        }
        if (statusChar === '-') {
            return 'cancelled';
        }
        if (statusChar === '!') {
            return 'exception';
        }
        return 'done';
    }

    private composeDateTime(date?: string, time?: string): string | null {
        if (!date && !time) {
            return null;
        }
        if (date && time) {
            return `${date}T${time}`;
        }
        if (date) {
            return date;
        }
        return null;
    }

    private normalizeDeadline(deadline?: string): string | null {
        if (!deadline) {
            return null;
        }
        return deadline.trim() || null;
    }

    private resolveEffectiveContent(content: string, parser: string, sourcePath: string): string {
        if (content.trim().length > 0) {
            return content;
        }
        if (parser !== 'inline' && parser !== 'frontmatter') {
            return content;
        }
        const baseName = getFileBaseName(sourcePath);
        return baseName.length > 0 ? baseName : content;
    }

    private buildFrontmatterRaw(task: Task): string {
        return [
            `content=${task.content ?? ''}`,
            `status=${task.statusChar ?? ''}`,
            `startDate=${task.startDate ?? ''}`,
            `startTime=${task.startTime ?? ''}`,
            `endDate=${task.endDate ?? ''}`,
            `endTime=${task.endTime ?? ''}`,
            `deadline=${task.deadline ?? ''}`,
        ].join(';');
    }

    private isWithinRetention(task: Task, keepDays: number, snapshotAt: string): boolean {
        const proxyDate = task.endDate ?? task.startDate ?? task.deadline;
        if (!proxyDate) {
            return true;
        }
        const dateOnly = proxyDate.slice(0, 10);
        const cutoff = this.computeCutoffDate(keepDays, snapshotAt);
        return dateOnly >= cutoff;
    }

    private computeCutoffDate(keepDays: number, snapshotAt: string): string {
        const now = new Date(snapshotAt);
        now.setDate(now.getDate() - keepDays);
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    private hashToHex(raw: string): string {
        let hash = 5381;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) + hash) + raw.charCodeAt(i);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }
}
