import type { Task } from '../../types';
import { TagExtractor } from './utils/TagExtractor';

/**
 * Task-scope property resolver.
 *
 * BFS over the parentId graph (within a single file), merging parent
 * properties/tags into children with child-wins precedence. The Task layer
 * in the File/Section/Task inheritance pipeline.
 *
 * Style fields (color/linestyle/mask) are resolved at extraction time by
 * TreeTaskExtractor's parentStyle propagation — that is the in-block
 * optimization of the same Task-scope inheritance, kept inline for
 * efficiency. See DEVELOPER.md "Inheritance pipeline".
 */
export class TaskPropertyResolver {
    static resolve(tasks: Task[]): void {
        const taskMap = new Map<string, Task>();
        for (const t of tasks) taskMap.set(t.id, t);

        const roots: Task[] = [];
        for (const t of tasks) {
            if (!t.parentId || !taskMap.has(t.parentId)) {
                roots.push(t);
            }
        }

        const queue: Task[] = [...roots];
        while (queue.length > 0) {
            const parent = queue.shift()!;
            for (const childId of parent.childIds) {
                const child = taskMap.get(childId);
                if (!child) continue;
                if (Object.keys(parent.properties).length > 0) {
                    child.properties = { ...parent.properties, ...child.properties };
                }
                if (parent.tags.length > 0) {
                    child.tags = TagExtractor.merge(parent.tags, child.tags);
                }
                queue.push(child);
            }
        }
    }
}
