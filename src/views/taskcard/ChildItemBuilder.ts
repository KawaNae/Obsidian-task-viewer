import { Task } from '../../types';
import { TaskReadService } from '../../services/data/TaskReadService';
import { ChildRenderItem } from './types';
import { ChildLineResolver } from './ChildLineResolver';
import { ChildRenderItemMapper } from './ChildRenderItemMapper';

/**
 * Builds child render items for inline/frontmatter tasks.
 *
 * Orchestrates ChildLineResolver (line→task mapping) and
 * ChildRenderItemMapper (task/line→ChildRenderItem conversion).
 */
export class ChildItemBuilder {
    private static readonly MAX_RENDER_DEPTH = 10;

    private resolver: ChildLineResolver;
    private mapper: ChildRenderItemMapper;

    constructor(private readService: TaskReadService) {
        this.resolver = new ChildLineResolver(readService);
        this.mapper = new ChildRenderItemMapper();
    }

    getReadService(): TaskReadService {
        return this.readService;
    }

    /**
     * Inline task childLines -> ChildRenderItem[]
     * @param indent Prefix added to every generated markdown line.
     */
    buildInlineChildItems(task: Task, indent: string): ChildRenderItem[] {
        const childIdByLine = this.resolver.buildChildIdByLine(task);

        const wikiTaskByIdx = new Map<number, Task>();
        for (let i = 0; i < task.childLines.length; i++) {
            const cl = task.childLines[i];
            if (cl.wikilinkTarget === null) continue;
            const wikiTask = this.resolver.findWikiLinkChild(task, childIdByLine, cl.wikilinkTarget);
            if (wikiTask) wikiTaskByIdx.set(i, wikiTask);
        }

        const items: ChildRenderItem[] = [];
        const visitedIds = new Set<string>();

        for (let idx = 0; idx < task.childLines.length; idx++) {
            const cl = task.childLines[idx];
            const effectiveIndent = indent + cl.indent;

            // 1. childIdByLine でタスク解決（@notation 子タスク）
            const absLine = this.resolver.resolveChildAbsoluteLine(task, idx);
            const childIdTask = childIdByLine.get(absLine);
            if (childIdTask && !visitedIds.has(childIdTask.id)) {
                visitedIds.add(childIdTask.id);
                items.push(this.mapper.createTaskItem(childIdTask, effectiveIndent, task.file));
                this.appendDescendants(childIdTask, effectiveIndent + '    ', task.id, items, visitedIds, 0);
                continue;
            }

            // 2. orphan タスク検索（childIds に未登録だが行番号でマッチするタスク）
            const orphanTask = this.resolver.findOrphanTask(task.file, absLine);
            if (orphanTask && !visitedIds.has(orphanTask.id)) {
                visitedIds.add(orphanTask.id);
                items.push(this.mapper.createTaskItem(orphanTask, effectiveIndent, task.file));
                this.appendDescendants(orphanTask, effectiveIndent + '    ', task.id, items, visitedIds, 0);
                continue;
            }

            // 3. wikilink 解決
            const wikiTask = wikiTaskByIdx.get(idx);
            if (wikiTask) {
                items.push(this.mapper.createWikiLinkItem(wikiTask, effectiveIndent));
                this.appendDescendants(wikiTask, effectiveIndent + '    ', task.id, items, visitedIds, 0);
                continue;
            }

            // 4. plainCheckbox / 通常行
            items.push(this.mapper.processChildLine(cl, idx, task, indent));
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

        const childIdByLine = this.resolver.buildChildIdByLine(task);
        const renderedChildIds = new Set<string>();
        const consumedLineKeys = new Set<string>();

        this.appendFromChildLines(
            task, indent, rootId, items, visitedIds, depth,
            childIdByLine, renderedChildIds, consumedLineKeys
        );

        this.appendRemainingChildIds(
            task, indent, rootId, items, visitedIds, depth, renderedChildIds
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
            const cl = task.childLines[i];
            const absLine = this.resolver.resolveChildAbsoluteLine(task, i);
            const lineKey = this.resolver.toLineKey(task.file, absLine);
            if (consumedLineKeys.has(lineKey)) continue;
            const effectiveIndent = indent + cl.indent;

            const childIdTask = childIdByLine.get(absLine);
            if (childIdTask) {
                if (visitedIds.has(childIdTask.id) || childIdTask.id === rootId) {
                    renderedChildIds.add(childIdTask.id);
                    continue;
                }

                visitedIds.add(childIdTask.id);
                renderedChildIds.add(childIdTask.id);
                items.push(this.mapper.createTaskItem(childIdTask, effectiveIndent, task.file));
                this.appendDescendants(
                    childIdTask, effectiveIndent + '    ', rootId, items, visitedIds, depth + 1
                );
                this.resolver.markTaskSubtreeLines(childIdTask, consumedLineKeys);
                continue;
            }

            const orphanTask = this.resolver.findOrphanTask(task.file, absLine);
            if (orphanTask) {
                if (orphanTask.parentId && orphanTask.parentId !== task.id) {
                    continue;
                }
                if (visitedIds.has(orphanTask.id) || orphanTask.id === rootId) {
                    continue;
                }

                items.push(this.mapper.createTaskItem(orphanTask, effectiveIndent, task.file));
                visitedIds.add(orphanTask.id);
                renderedChildIds.add(orphanTask.id);
                this.resolver.markTaskSubtreeLines(orphanTask, consumedLineKeys);
                continue;
            }

            const wikiChildTask = cl.wikilinkTarget !== null
                ? this.resolver.findWikiLinkChild(task, childIdByLine, cl.wikilinkTarget)
                : null;

            if (wikiChildTask && !visitedIds.has(wikiChildTask.id) && wikiChildTask.id !== rootId) {
                visitedIds.add(wikiChildTask.id);
                renderedChildIds.add(wikiChildTask.id);

                items.push(this.mapper.createWikiLinkItem(wikiChildTask, effectiveIndent));

                this.appendDescendants(
                    wikiChildTask, indent + cl.indent + '    ', rootId, items, visitedIds, depth + 1
                );
                this.resolver.markTaskSubtreeLines(wikiChildTask, consumedLineKeys);
                continue;
            }

            if (!wikiChildTask) {
                items.push(this.mapper.processChildLine(cl, i, task, indent));
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
            const child = this.readService.getTask(childId);
            if (!child) continue;

            items.push(this.mapper.createTaskItem(child, indent, task.file));
            this.appendDescendants(
                child, indent + '    ', rootId, items, visitedIds, depth + 1
            );
        }
    }
}
