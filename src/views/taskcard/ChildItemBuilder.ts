import { Task, ChildEntry, isTvFile } from '../../types';
import { TaskReadService } from '../../services/data/TaskReadService';
import { ChildRenderItem } from './types';
import { ChildRenderItemMapper } from './ChildRenderItemMapper';
import { extractWikilinkTarget } from '../../services/data/ChildEntryBuilder';

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
        return this.walk(task, indent, new Set(), 0);
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

        // 'plain'
        out.push(this.mapper.createPlainItem(entry.line, entry.bodyLine, parent, indent));
    }

    /**
     * Wikilink → child Task resolution.
     *
     * Walks the parent's `task`-kind ChildEntries (frontmatter children
     * wired up by WikiLinkResolver at parse time) and matches by file path.
     */
    private resolveWikilink(parent: Task, linkName: string): Task | undefined {
        const target = extractWikilinkTarget(linkName);
        for (const entry of this.readService.getChildEntries(parent)) {
            if (entry.kind !== 'task') continue;
            const c = this.readService.getTask(entry.taskId);
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
