import { vi } from 'vitest';
import type { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import type { Task } from '../../../src/types';

/**
 * The index's `getTask`, for a `FlowExecutor` built over a stand-in index.
 *
 * The scanner hands the executor a task the index holds, and the executor
 * looks that task up again by its ID before it writes anything. So the
 * stand-in holds every task the test hands over — through
 * `handleTaskCompletion` or `fireAndDelete` — under its ID.
 *
 * `now` is what the index holds for that task by the time the executor asks:
 * the task itself by default, an edited copy for a row that changed in
 * between, or undefined for a row that is gone.
 */
export function heldTasks(now: (task: Task) => Task | undefined = task => task) {
    const held = new Map<string, Task>();
    return {
        getTask: vi.fn((id: string) => {
            const task = held.get(id);
            return task ? now(task) : undefined;
        }),
        /** Make `executor` hold what it is handed. Answers the executor. */
        hold<E extends FlowExecutor>(executor: E): E {
            const complete = executor.handleTaskCompletion.bind(executor);
            const fire = executor.fireAndDelete.bind(executor);
            executor.handleTaskCompletion = (task: Task) => { held.set(task.id, task); return complete(task); };
            executor.fireAndDelete = (task: Task) => { held.set(task.id, task); return fire(task); };
            return executor;
        },
    };
}
