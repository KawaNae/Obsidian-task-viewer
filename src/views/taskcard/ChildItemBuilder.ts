import { Task } from '../../types';
import { TaskIndex } from '../../services/core/TaskIndex';
import { NotationUtils } from './NotationUtils';
import { ChildRenderItem } from './types';
import { getFileBaseName } from '../../utils/TaskContent';
import { TaskIdGenerator } from '../../utils/TaskIdGenerator';

/**
 * Builds child render items for inline/frontmatter tasks.
 *
 * - Preserves file order for childLines
 * - Expands task descendants recursively
 * - Resolves wikilink children when possible
 */
export class ChildItemBuilder {
    private static readonly MAX_RENDER_DEPTH = 10;

    constructor(private taskIndex: TaskIndex) {}

    /**
     * Inline task childLines -> ChildRenderItem[]
     * @param indent Prefix added to every generated markdown line.
     */
    buildInlineChildItems(task: Task, indent: string): ChildRenderItem[] {
        const childIdByLine = new Map<number, Task>();
        for (const childId of task.childIds) {
            const child = this.taskIndex.getTask(childId);
            if (child && child.line >= 0) childIdByLine.set(child.line, child);
        }

        const wikiTaskByIdx = new Map<number, Task>();
        for (let i = 0; i < task.childLines.length; i++) {
            const wikiMatch = task.childLines[i].match(/^(\s*)-\s+\[\[([^\]]+)\]\]\s*$/);
            if (!wikiMatch) continue;
            const linkName = wikiMatch[2].trim();
            const wikiTask = this.findWikiLinkChild(task, childIdByLine, linkName);
            if (wikiTask) wikiTaskByIdx.set(i, wikiTask);
        }

        const items: ChildRenderItem[] = [];
        const visitedIds = new Set<string>();

        for (let idx = 0; idx < task.childLines.length; idx++) {
            const childLine = task.childLines[idx];
            const wikiTask = wikiTaskByIdx.get(idx);

            if (wikiTask) {
                const lineIndent = childLine.match(/^(\s*)/)?.[1] ?? '';
                items.push({
                    markdown: `${indent}${lineIndent}- [${wikiTask.statusChar || ' '}] ${this.formatWikiLink(wikiTask.file)}`,
                    notation: NotationUtils.buildNotationLabel(wikiTask),
                    isCheckbox: true,
                    handler: { type: 'task', taskId: wikiTask.id }
                });
                this.appendDescendants(
                    wikiTask,
                    indent + lineIndent + '    ',
                    task.id,
                    items,
                    visitedIds,
                    0
                );
            } else {
                items.push(this.processChildLine(childLine, idx, task, indent));
            }
        }

        return items;
    }

    /**
     * Frontmatter task descendants -> ChildRenderItem[]
     */
    buildFrontmatterChildItems(parentTask: Task): ChildRenderItem[] {
        const items: ChildRenderItem[] = [];
        const visitedIds = new Set<string>();
        this.appendDescendants(parentTask, '', parentTask.id, items, visitedIds, 0);
        return items;
    }

    /**
     * Recursively appends descendants.
     *
     * Phase 1: iterate childLines in file order.
     * Phase 2: append remaining childIds not surfaced in phase 1.
     */
    private appendDescendants(
        task: Task,
        indent: string,
        rootId: string,
        items: ChildRenderItem[],
        visitedIds: Set<string>,
        depth: number = 0
    ): void {
        if (depth >= ChildItemBuilder.MAX_RENDER_DEPTH) return;

        const childIdByLine = new Map<number, Task>();
        for (const childId of task.childIds) {
            const child = this.taskIndex.getTask(childId);
            if (child && child.line >= 0) childIdByLine.set(child.line, child);
        }

        const renderedChildIds = new Set<string>();

        // Prevent duplicate rendering when a subtree was already expanded via another path.
        const consumedLineKeys = new Set<string>();

        this.appendFromChildLines(
            task,
            indent,
            rootId,
            items,
            visitedIds,
            depth,
            childIdByLine,
            renderedChildIds,
            consumedLineKeys
        );

        this.appendRemainingChildIds(
            task,
            indent,
            rootId,
            items,
            visitedIds,
            depth,
            renderedChildIds
        );
    }

    private appendFromChildLines(
        task: Task,
        indent: string,
        rootId: string,
        items: ChildRenderItem[],
        visitedIds: Set<string>,
        depth: number,
        childIdByLine: Map<number, Task>,
        renderedChildIds: Set<string>,
        consumedLineKeys: Set<string>
    ): void {
        for (let i = 0; i < task.childLines.length; i++) {
            const absLine = this.resolveChildAbsoluteLine(task, i);
            const lineKey = this.toLineKey(task.file, absLine);
            if (consumedLineKeys.has(lineKey)) continue;
            const lineIndent = task.childLines[i].match(/^(\s*)/)?.[1] ?? '';
            const effectiveIndent = indent + lineIndent;

            const childIdTask = childIdByLine.get(absLine);
            if (childIdTask) {
                if (visitedIds.has(childIdTask.id) || childIdTask.id === rootId) {
                    renderedChildIds.add(childIdTask.id);
                    continue;
                }

                visitedIds.add(childIdTask.id);
                renderedChildIds.add(childIdTask.id);
                items.push(this.createTaskItem(childIdTask, effectiveIndent, task.file));
                this.appendDescendants(
                    childIdTask,
                    effectiveIndent + '    ',
                    rootId,
                    items,
                    visitedIds,
                    depth + 1
                );
                this.markTaskSubtreeLines(childIdTask, consumedLineKeys);
                continue;
            }

            const orphanTaskId = TaskIdGenerator.generate('at-notation', task.file, `ln:${absLine + 1}`);
            const orphanTask = this.taskIndex.getTask(orphanTaskId);
            if (orphanTask) {
                if (orphanTask.parentId && orphanTask.parentId !== task.id) {
                    continue;
                }
                if (visitedIds.has(orphanTask.id) || orphanTask.id === rootId) {
                    continue;
                }

                items.push(this.createTaskItem(orphanTask, effectiveIndent, task.file));
                visitedIds.add(orphanTask.id);
                renderedChildIds.add(orphanTask.id);
                this.markTaskSubtreeLines(orphanTask, consumedLineKeys);
                continue;
            }

            const wikiMatch = task.childLines[i].match(/^\s*-\s+\[\[([^\]]+)\]\]\s*$/);
            const wikiChildTask = wikiMatch
                ? this.findWikiLinkChild(task, childIdByLine, wikiMatch[1].trim())
                : null;

            if (wikiChildTask && !visitedIds.has(wikiChildTask.id) && wikiChildTask.id !== rootId) {
                visitedIds.add(wikiChildTask.id);
                renderedChildIds.add(wikiChildTask.id);

                const lineIndent = task.childLines[i].match(/^(\s*)/)?.[1] ?? '';
                items.push({
                    markdown: `${indent}${lineIndent}- [${wikiChildTask.statusChar || ' '}] ${this.formatWikiLink(wikiChildTask.file)}`,
                    notation: NotationUtils.buildNotationLabel(wikiChildTask),
                    isCheckbox: true,
                    handler: { type: 'task', taskId: wikiChildTask.id }
                });

                this.appendDescendants(
                    wikiChildTask,
                    indent + lineIndent + '    ',
                    rootId,
                    items,
                    visitedIds,
                    depth + 1
                );
                this.markTaskSubtreeLines(wikiChildTask, consumedLineKeys);
                continue;
            }

            if (!wikiChildTask) {
                items.push(this.processChildLine(task.childLines[i], i, task, indent));
            }
        }
    }

    private appendRemainingChildIds(
        task: Task,
        indent: string,
        rootId: string,
        items: ChildRenderItem[],
        visitedIds: Set<string>,
        depth: number,
        renderedChildIds: Set<string>
    ): void {
        for (const childId of task.childIds) {
            if (renderedChildIds.has(childId) || visitedIds.has(childId) || childId === rootId) continue;

            visitedIds.add(childId);
            const child = this.taskIndex.getTask(childId);
            if (!child) continue;

            items.push(this.createTaskItem(child, indent, task.file));
            this.appendDescendants(
                child,
                indent + '    ',
                rootId,
                items,
                visitedIds,
                depth + 1
            );
        }
    }

    /**
     * Converts Task to ChildRenderItem.
     * For frontmatter tasks in another file, render as wikilink text.
     */
    private createTaskItem(task: Task, indent: string, contextFile: string): ChildRenderItem {
        const char = task.statusChar || ' ';
        if (task.parserId === 'frontmatter' && task.file !== contextFile) {
            return {
                markdown: `${indent}- [${char}] ${this.formatWikiLink(task.file)}`,
                notation: NotationUtils.buildNotationLabel(task),
                isCheckbox: true,
                handler: { type: 'task', taskId: task.id }
            };
        }

        return {
            markdown: `${indent}- [${char}] ${task.content || '\u200B'}`,
            notation: NotationUtils.buildNotationLabel(task),
            isCheckbox: true,
            handler: { type: 'task', taskId: task.id }
        };
    }

    /**
     * Converts plain child line to ChildRenderItem.
     */
    private processChildLine(line: string, idx: number, task: Task, indent: string): ChildRenderItem {
        const isCb = /^\s*-\s*\[.\]/.test(line);
        let notation: string | null = null;

        if (isCb) {
            const m = line.match(/@[\w\-:>T]+/);
            notation = m ? m[0] : null;
        }

        let cleaned = line
            .replace(/\s*@[\w\-:>T]+(?:\s*==>.*)?/g, '')
            .trimEnd();

        if (/^\s*-\s*\[.\]$/.test(cleaned)) {
            cleaned += ' \u200B';
        }

        return {
            markdown: indent + cleaned,
            notation,
            isCheckbox: isCb,
            handler: isCb
                ? { type: 'childLine', parentTask: task, childLineIndex: idx }
                : null
        };
    }

    /**
     * Resolves wikilink child task.
     * Search order:
     * 1) parent task childIds
     * 2) childIdByLine task childIds
     */
    private findWikiLinkChild(parentTask: Task, childIdByLine: Map<number, Task>, linkName: string): Task | null {
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
            const child = this.taskIndex.getTask(childId);
            if (!child || child.parserId !== 'frontmatter') continue;

            const baseName = child.file.replace(/\.md$/, '').split('/').pop() || '';
            const fullPath = child.file.replace(/\.md$/, '');
            if (target === baseName || target === fullPath || target === child.file) {
                return child;
            }
        }

        return null;
    }

    private formatWikiLink(filePath: string): string {
        const target = filePath.replace(/\.md$/, '');
        const alias = getFileBaseName(filePath) || target.split('/').pop() || target;
        return `[[${target}|${alias}]]`;
    }

    private extractWikiLinkTarget(linkName: string): string {
        return linkName.split('|')[0].trim();
    }

    /**
     * Resolves child absolute line number.
     * - frontmatter: childLineBodyOffsets uses absolute line numbers
     * - inline: fallback to task.line + 1 + index
     */
    private resolveChildAbsoluteLine(task: Task, childLineIndex: number): number {
        const bodyOffset = task.childLineBodyOffsets?.[childLineIndex];
        if (typeof bodyOffset === 'number' && bodyOffset >= 0) {
            return bodyOffset;
        }

        return task.line + 1 + childLineIndex;
    }

    private toLineKey(file: string, line: number): string {
        return `${file}:${line}`;
    }

    private markTaskSubtreeLines(task: Task, consumedLineKeys: Set<string>, depth: number = 0): void {
        if (depth >= ChildItemBuilder.MAX_RENDER_DEPTH) return;

        if (task.line >= 0) {
            consumedLineKeys.add(this.toLineKey(task.file, task.line));
        }

        for (let i = 0; i < task.childLines.length; i++) {
            const absLine = this.resolveChildAbsoluteLine(task, i);
            consumedLineKeys.add(this.toLineKey(task.file, absLine));
        }

        for (const childId of task.childIds) {
            const child = this.taskIndex.getTask(childId);
            if (!child) continue;
            this.markTaskSubtreeLines(child, consumedLineKeys, depth + 1);
        }
    }
}
