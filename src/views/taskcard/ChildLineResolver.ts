import { Task, isFrontmatterTask } from '../../types';
import { TaskReadService } from '../../services/data/TaskReadService';
import { TaskIdGenerator } from '../../services/display/TaskIdGenerator';

/**
 * Resolves child lines to Task references.
 *
 * Pure resolution logic: line→task mapping, orphan detection,
 * wikilink child search, subtree line marking.
 */
export class ChildLineResolver {
    private static readonly MAX_RENDER_DEPTH = 10;

    constructor(private readService: TaskReadService) {}

    getReadService(): TaskReadService {
        return this.readService;
    }

    /**
     * Build a map from absolute line number to child Task.
     */
    buildChildIdByLine(task: Task): Map<number, Task> {
        const map = new Map<number, Task>();
        for (const childId of task.childIds) {
            const child = this.readService.getTask(childId);
            if (child && child.line >= 0) map.set(child.line, child);
        }
        return map;
    }

    /**
     * Resolves child absolute line number.
     * - frontmatter: childLineBodyOffsets uses absolute line numbers
     * - inline: fallback to task.line + 1 + index
     */
    resolveChildAbsoluteLine(task: Task, childLineIndex: number): number {
        const bodyOffset = task.childLineBodyOffsets?.[childLineIndex];
        if (typeof bodyOffset === 'number' && bodyOffset >= 0) {
            return bodyOffset;
        }

        return task.line + 1 + childLineIndex;
    }

    /**
     * Look up an orphan task by its expected ID at the given absolute line.
     */
    findOrphanTask(file: string, absLine: number): Task | undefined {
        const orphanTaskId = TaskIdGenerator.generate('at-notation', file, `ln:${absLine + 1}`);
        return this.readService.getTask(orphanTaskId);
    }

    /**
     * Resolves wikilink child task.
     * Search order:
     * 1) parent task childIds
     * 2) childIdByLine task childIds
     */
    findWikiLinkChild(parentTask: Task, childIdByLine: Map<number, Task>, linkName: string): Task | null {
        const found = this.searchWikiChild(parentTask, linkName);
        if (found) return found;

        for (const task of childIdByLine.values()) {
            const nestedFound = this.searchWikiChild(task, linkName);
            if (nestedFound) return nestedFound;
        }

        return null;
    }

    private searchWikiChild(task: Task, linkName: string): Task | null {
        const target = this.extractWikiLinkTarget(linkName);
        for (const childId of task.childIds) {
            const child = this.readService.getTask(childId);
            if (!child || !isFrontmatterTask(child)) continue;

            const baseName = child.file.replace(/\.md$/, '').split('/').pop() || '';
            const fullPath = child.file.replace(/\.md$/, '');
            if (target === baseName || target === fullPath || target === child.file) {
                return child;
            }
        }

        return null;
    }

    extractWikiLinkTarget(linkName: string): string {
        return linkName.split('|')[0].trim();
    }

    toLineKey(file: string, line: number): string {
        return `${file}:${line}`;
    }

    /**
     * Mark all lines occupied by a task and its subtree as consumed.
     */
    markTaskSubtreeLines(task: Task, consumedLineKeys: Set<string>, depth: number = 0): void {
        if (depth >= ChildLineResolver.MAX_RENDER_DEPTH) return;

        if (task.line >= 0) {
            consumedLineKeys.add(this.toLineKey(task.file, task.line));
        }

        for (let i = 0; i < task.childLines.length; i++) {
            const absLine = this.resolveChildAbsoluteLine(task, i);
            consumedLineKeys.add(this.toLineKey(task.file, absLine));
        }

        for (const childId of task.childIds) {
            const child = this.readService.getTask(childId);
            if (!child) continue;
            this.markTaskSubtreeLines(child, consumedLineKeys, depth + 1);
        }
    }
}
