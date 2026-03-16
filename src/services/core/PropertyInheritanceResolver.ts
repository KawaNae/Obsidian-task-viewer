import type { Task } from '../../types';

export class PropertyInheritanceResolver {
    /**
     * 同一ファイル内の親→子 properties 継承（child-wins マージ）。
     * parentId/childIds が設定済みの Task 配列に対して BFS で解決。
     */
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
                queue.push(child);
            }
        }
    }
}
