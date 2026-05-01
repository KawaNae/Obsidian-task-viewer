import type { Task, ChildEntry, ChildLine } from '../../types';

/**
 * Derives a Task's ordered ChildEntry[] from its parser-emitted fields:
 *   - childIds (independent child tasks)
 *   - childLines (raw lines under the parent)
 *   - childLineBodyOffsets (parallel array, absolute file line per childLine)
 *
 * Guarantees:
 *   - Each entry carries an absolute `bodyLine`, so render/write layers
 *     never recompute line numbers.
 *   - Entries are sorted by `bodyLine` (body order).
 *   - A line owned by a sibling task's subtree is omitted from `line`/`wikilink`
 *     entries — it surfaces as the descendant's own children. Enforces the
 *     "1 line = 1 owner across siblings" invariant relied on by the renderer.
 *
 * Pure: takes a `getTask` lookup so it composes with TaskReadService /
 * TaskIndex without coupling to either.
 */
export function buildChildEntries(
    parent: Task,
    getTask: (id: string) => Task | undefined
): ChildEntry[] {
    const entries: ChildEntry[] = [];

    const offsets = parent.childLineBodyOffsets;
    const childLines = parent.childLines;
    for (let i = 0; i < childLines.length; i++) {
        const cl = childLines[i];
        const bodyLine = offsets[i];
        if (typeof bodyLine !== 'number' || bodyLine < 0) continue;
        if (cl.wikilinkTarget) {
            entries.push({ kind: 'wikilink', target: cl.wikilinkTarget, bodyLine, line: cl });
        } else {
            entries.push({ kind: 'line', line: cl, bodyLine });
        }
    }

    for (const cid of parent.childIds) {
        const c = getTask(cid);
        if (!c || c.line < 0) continue;
        entries.push({ kind: 'task', taskId: cid, bodyLine: c.line });
    }

    const siblingSubtrees = parent.childIds
        .map(cid => {
            const c = getTask(cid);
            return c ? collectSubtreeLines(c, getTask) : null;
        })
        .filter((s): s is Set<number> => s !== null);

    const filtered = entries.filter(e => {
        if (e.kind === 'task') return true;
        for (const sub of siblingSubtrees) {
            if (sub.has(e.bodyLine)) return false;
        }
        return true;
    });

    filtered.sort((a, b) => a.bodyLine - b.bodyLine);

    return filtered;
}

/**
 * All absolute file lines occupied by a task and its descendant subtree.
 * Used to detect cross-sibling line overlap.
 */
function collectSubtreeLines(
    task: Task,
    getTask: (id: string) => Task | undefined,
    visited: Set<string> = new Set(),
    depth: number = 0
): Set<number> {
    const out = new Set<number>();
    if (depth > 10 || visited.has(task.id)) return out;
    visited.add(task.id);

    if (task.line >= 0) out.add(task.line);
    for (const off of task.childLineBodyOffsets) {
        if (typeof off === 'number' && off >= 0) out.add(off);
    }
    for (const cid of task.childIds) {
        const c = getTask(cid);
        if (!c) continue;
        for (const l of collectSubtreeLines(c, getTask, visited, depth + 1)) {
            out.add(l);
        }
    }
    return out;
}

/** Wikilink target normalization (strips `|alias`). */
export function extractWikilinkTarget(linkName: string): string {
    return linkName.split('|')[0].trim();
}
