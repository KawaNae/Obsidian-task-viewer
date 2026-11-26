import type { Task, ChildEntry } from '../../types';
import type { ChildRenderItem } from './types';
import type { CardRows } from './CardRows';
import { ChildRenderItemMapper } from './ChildRenderItemMapper';
import { getOriginalTaskId } from '../../services/display/DisplayTaskConverter';

/** What the builder reads of a card's rows: the rows by name, and their children. */
export type ChildRows = Pick<CardRows, 'getTask' | 'getChildEntries'>;

/**
 * Builds child render items by walking `getChildEntries(parent)` of the
 * card's rows (`CardRows`).
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

    buildChildItems(task: Task, rows: ChildRows, indent: string = ''): ChildRenderItem[] {
        // 表示層の合成 ID（split セグメント等）はここで原タスクへ解決し、
        // 下流（render item / menu / hub）には原タスクの ID と、カードが読む
        // 行の最新状態を渡す。区間 ID は表示の中だけの鍵で、書き込みの口は剥がさない。
        const parent = rows.getTask(getOriginalTaskId(task)) ?? task;
        return this.walk(parent, rows, indent, new Set(), 0);
    }

    private walk(parent: Task, rows: ChildRows, indent: string, visited: Set<string>, depth: number): ChildRenderItem[] {
        if (depth >= ChildItemBuilder.MAX_RENDER_DEPTH) return [];
        if (visited.has(parent.id)) return [];
        const next = new Set(visited);
        next.add(parent.id);

        const items: ChildRenderItem[] = [];
        for (const entry of rows.getChildEntries(parent)) {
            this.appendEntry(entry, rows, indent, next, depth, items);
        }
        return items;
    }

    private appendEntry(
        entry: ChildEntry,
        rows: ChildRows,
        indent: string,
        visited: Set<string>,
        depth: number,
        out: ChildRenderItem[]
    ): void {
        if (entry.kind === 'task') {
            const child = rows.getTask(entry.taskId);
            if (!child || visited.has(child.id)) return;
            out.push(this.mapper.createTaskItem(child, indent));
            out.push(...this.walk(child, rows, indent + '    ', visited, depth + 1));
            return;
        }

        // 'line'
        out.push(this.mapper.createPlainItem(entry.line, indent));
    }
}
