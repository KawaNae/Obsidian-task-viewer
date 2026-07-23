import { type Task, type ChildEntry, isTvFile } from '../../types';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { ChildRenderItem } from './types';
import { ChildRenderItemMapper } from './ChildRenderItemMapper';
import { extractWikilinkTarget } from '../../services/data/ChildEntryBuilder';
import { getOriginalTaskId } from '../../services/display/DisplayTaskConverter';

/**
 * Builds child render items by walking `TaskReadService.getChildEntries(parent)`.
 *
 * The data layer (`buildChildEntries`) produces an ordered, partitioned
 * `ChildEntry[]` where each absolute body line is owned by exactly one entry
 * across siblings. This walker simply translates each entry into render items
 * and recurses into 'task' / resolved 'wikilink' children — no re-classification,
 * no consumed-line tracking, no orphan recovery.
 */
export class ChildItemBuilder {
    private static readonly MAX_RENDER_DEPTH = 10;

    private mapper: ChildRenderItemMapper = new ChildRenderItemMapper();

    constructor(private readService: TaskReadService) {}

    getReadService(): TaskReadService {
        return this.readService;
    }

    buildChildItems(task: Task, indent: string = ''): ChildRenderItem[] {
        // 表示層の合成 ID（split セグメント等）はここで index 在住の原タスクへ
        // 解決する。handler.parentTask が write 境界を越えるのはこの先なので、
        // この入口が「合成 ID を write 層に漏らさない」不変条件の単一の境界。
        const parent = this.readService.getTask(getOriginalTaskId(task)) ?? task;
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
            const child = this.readService.getTask(entry.taskId);
            if (!child || visited.has(child.id)) return;
            out.push(this.mapper.createTaskItem(child, indent, parent.file));
            out.push(...this.walk(child, indent + '    ', visited, depth + 1));
            return;
        }

        if (entry.kind === 'wikilink') {
            const resolved = this.resolveWikilink(parent, entry.target);
            if (resolved && !visited.has(resolved.id)) {
                out.push(this.mapper.createWikiLinkItem(resolved, indent));
                out.push(...this.walk(resolved, indent + '    ', visited, depth + 1));
                return;
            }
            // Unresolved wikilink → fall through to raw render
            out.push(this.mapper.createPlainItem(entry.line, entry.bodyLine, parent, indent));
            return;
        }

        // 'line'
        out.push(this.mapper.createPlainItem(entry.line, entry.bodyLine, parent, indent));
    }

    /**
     * Wikilink → child Task resolution.
     *
     * tv-file children carry `line === -1` (no body line) by design and are
     * therefore intentionally absent from the parent's body-line-bearing
     * 'task' ChildEntries. Resolve the wikilink against the parent's wired
     * `childIds` directly — WikiLinkResolver populates these at parse time —
     * matching by file path.
     */
    private resolveWikilink(parent: Task, linkName: string): Task | undefined {
        const target = extractWikilinkTarget(linkName);
        for (const cid of parent.childIds) {
            const c = this.readService.getTask(cid);
            if (!c || !isTvFile(c)) continue;
            const baseName = c.file.replace(/\.md$/, '').split('/').pop() || '';
            const fullPath = c.file.replace(/\.md$/, '');
            if (target === baseName || target === fullPath || target === c.file) {
                return c;
            }
        }
        return undefined;
    }
}
