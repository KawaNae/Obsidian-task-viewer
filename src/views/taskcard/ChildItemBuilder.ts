import type { Task, ChildEntry } from '../../types';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { IndexReads } from '../../services/core/TaskIndex';
import type { ChildRenderItem } from './types';
import { ChildRenderItemMapper } from './ChildRenderItemMapper';
import { getOriginalTaskId } from '../../services/display/DisplayTaskConverter';

/**
 * Builds child render items by walking `TaskReadService.getChildEntries(parent)`.
 *
 * The data layer (`buildChildEntries`) produces an ordered, partitioned
 * `ChildEntry[]` where each absolute body line is owned by exactly one entry
 * across siblings. This walker simply translates each entry into render items
 * and recurses into 'task' children — no re-classification,
 * no consumed-line tracking, no orphan recovery.
 */
export class ChildItemBuilder {
    private static readonly MAX_RENDER_DEPTH = 10;

    private mapper: ChildRenderItemMapper = new ChildRenderItemMapper();

    /**
     * @param readService the children of a row in the note's order (`getChildEntries`)
     * @param index the rows themselves, by name
     */
    constructor(
        private readonly readService: Pick<TaskReadService, 'getChildEntries'>,
        private readonly index: Pick<IndexReads, 'getTask'>,
    ) {}

    buildChildItems(task: Task, indent: string = ''): ChildRenderItem[] {
        // 表示層の合成 ID（split セグメント等）はここで index 在住の原タスクへ
        // 解決し、下流（render item / menu / hub）には原タスクの ID と最新状態
        // を渡す。区間 ID は表示の中だけの鍵で、書き込みの口は剥がさない。
        const parent = this.index.getTask(getOriginalTaskId(task)) ?? task;
        return this.walk(parent, indent, new Set(), 0);
    }

    private walk(parent: Task, indent: string, visited: Set<string>, depth: number): ChildRenderItem[] {
        if (depth >= ChildItemBuilder.MAX_RENDER_DEPTH) return [];
        if (visited.has(parent.id)) return [];
        const next = new Set(visited);
        next.add(parent.id);

        const items: ChildRenderItem[] = [];
        const entries = this.readService.getChildEntries(parent);

        for (const entry of entries) {
            this.appendEntry(entry, parent, indent, next, depth, items);
        }
        return items;
    }

    private appendEntry(
        entry: ChildEntry,
        parent: Task,
        indent: string,
        visited: Set<string>,
        depth: number,
        out: ChildRenderItem[]
    ): void {
        if (entry.kind === 'task') {
            const child = this.index.getTask(entry.taskId);
            if (!child || visited.has(child.id)) return;
            out.push(this.mapper.createTaskItem(child, indent));
            out.push(...this.walk(child, indent + '    ', visited, depth + 1));
            return;
        }

        // 'line'
        out.push(this.mapper.createPlainItem(entry.line, indent));
    }
}
