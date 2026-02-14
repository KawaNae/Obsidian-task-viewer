import type { Task } from '../../types';
import type { NormalizedTask, NormalizedTaskStatus } from './NormalizedTask';

export interface TaskNormalizerOptions {
    completeStatusChars: string[];
    includeParsers: Set<string>;
    includeDone: boolean;
    updatedAt: string;
}

export class TaskNormalizer {
    normalizeTasks(tasks: Task[], options: TaskNormalizerOptions): Map<string, NormalizedTask[]> {
        const byPath = new Map<string, Map<string, NormalizedTask>>();

        for (const task of tasks) {
            const normalized = this.normalizeTask(task, options);
            if (!normalized) {
                continue;
            }

            let pathBucket = byPath.get(normalized.sourcePath);
            if (!pathBucket) {
                pathBucket = new Map<string, NormalizedTask>();
                byPath.set(normalized.sourcePath, pathBucket);
            }
            if (pathBucket.has(normalized.id)) {
                console.warn(`[TaskNormalizer] Duplicate task ID in ${normalized.sourcePath}: ${normalized.id}`);
            }
            pathBucket.set(normalized.id, normalized);
        }

        const result = new Map<string, NormalizedTask[]>();
        for (const [path, entries] of byPath) {
            const tasksForPath = Array.from(entries.values()).sort((a, b) => {
                const lineA = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
                const lineB = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
                if (lineA !== lineB) {
                    return lineA - lineB;
                }
                return a.id.localeCompare(b.id);
            });
            result.set(path, tasksForPath);
        }

        return result;
    }

    normalizeTask(task: Task, options: TaskNormalizerOptions): NormalizedTask | null {
        const parser = this.normalizeParser(task.parserId);
        if (!options.includeParsers.has(parser)) {
            return null;
        }

        const sourceLine = task.line >= 0 ? task.line + 1 : null;
        const sourceCol = task.line >= 0 ? (task.indent + 1) : null;

        const start = this.composeDateTime(task.startDate, task.startTime);
        const end = this.composeDateTime(task.endDate, task.endTime);
        const deadline = this.normalizeDeadline(task.deadline);

        const status = this.resolveStatus(task.statusChar, options.completeStatusChars);
        if (!options.includeDone && status !== 'todo' && status !== 'unknown') {
            return null;
        }

        const tags = this.extractTags(task.content);
        const allDay = !task.startTime && !task.endTime;
        const durationMinutes = this.computeDurationMinutes(start, end);
        const raw = task.originalText && task.originalText.trim().length > 0
            ? task.originalText.trim()
            : this.buildFrontmatterRaw(task);
        const anchor = this.resolveAnchor(task, parser, sourceLine);
        const id = `tv1:${parser}:${task.file}:${anchor}`;

        const contentHash = this.hashToHex([
            parser,
            task.file,
            sourceLine === null ? '' : String(sourceLine),
            status,
            task.content,
            start ?? '',
            end ?? '',
            deadline ?? '',
            allDay ? '1' : '0',
            durationMinutes === null ? '' : String(durationMinutes),
            tags.slice().sort().join(','),
            '',
            raw,
        ].join('|'));

        return {
            id,
            contentHash,
            parser,
            sourcePath: task.file,
            sourceLine,
            sourceCol,
            status,
            content: task.content,
            start,
            end,
            deadline,
            allDay,
            durationMinutes,
            project: null,
            tags,
            priority: null,
            readOnly: parser !== 'inline' && parser !== 'frontmatter',
            raw,
            updatedAt: options.updatedAt,
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

    private resolveAnchor(task: Task, parser: string, sourceLine: number | null): string {
        const blockId = task.blockId?.trim();
        if (blockId) {
            return `blk:${blockId}`;
        }
        if (parser === 'inline') {
            return sourceLine !== null
                ? `ln:${sourceLine}`
                : 'ln:unknown';
        }
        return 'fm-root';
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

    private computeDurationMinutes(start: string | null, end: string | null): number | null {
        if (!start || !end) {
            return null;
        }
        if (start.startsWith('T') || end.startsWith('T')) {
            return null;
        }

        const startDate = this.parseLocalDate(start);
        const endDate = this.parseLocalDate(end);
        if (!startDate || !endDate) {
            return null;
        }

        const diffMs = endDate.getTime() - startDate.getTime();
        if (!Number.isFinite(diffMs) || diffMs < 0) {
            return null;
        }
        return Math.round(diffMs / 60000);
    }

    private parseLocalDate(value: string): Date | null {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return new Date(`${value}T00:00:00`);
        }
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
            return new Date(`${value}:00`);
        }
        return null;
    }

    private extractTags(content: string): string[] {
        const tags = new Set<string>();
        const matches = content.match(/\B#[^\s#]+/g) ?? [];
        for (const raw of matches) {
            const tag = raw.substring(1).trim();
            if (tag.length > 0) {
                tags.add(tag);
            }
        }
        return Array.from(tags).sort();
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

    private hashToHex(raw: string): string {
        let hash = 5381;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) + hash) + raw.charCodeAt(i);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }
}
