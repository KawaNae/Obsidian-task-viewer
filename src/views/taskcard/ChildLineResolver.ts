import { Task, isFrontmatterTask } from '../../types';

/**
 * Child line absolute-line resolver.
 *
 * The render path no longer calls this resolver — `ChildEntry.bodyLine`
 * carries the absolute file line directly. This is retained as a static
 * utility for legacy / fallback callers and tests.
 */
export class ChildLineResolver {
    /**
     * Resolves child absolute line number.
     *
     * `childLineBodyOffsets` always stores absolute file line numbers
     * for both frontmatter and inline tasks (TVFileBuilder / TreeTaskExtractor
     * both populate absolute lines).
     *
     * Returns -1 when frontmatter task lacks an offset entry, since
     * a frontmatter task has no body line of its own (`task.line === -1`)
     * to derive a fallback from.
     */
    static resolveChildAbsoluteLine(task: Task, childLineIndex: number): number {
        const bodyOffset = task.childLineBodyOffsets?.[childLineIndex];
        if (typeof bodyOffset === 'number' && bodyOffset >= 0) {
            return bodyOffset;
        }

        if (isFrontmatterTask(task)) return -1;
        return task.line + 1 + childLineIndex;
    }
}
