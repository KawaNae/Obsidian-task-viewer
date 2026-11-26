import type { ScopeKeys, Task } from '../../types';
import { formatRow } from '../parsing/TaskLineFormat';
import { PropertyUpdatePlanner } from '../persistence/PropertyUpdatePlanner';
import type { UpdateOp } from '../persistence/UpdateRow';

/**
 * What writing `updates` to the row `task` reads as writes: the row's line
 * as the task reads with them (`formatRow`), and the ops on its own
 * property lines, from what `updates` says against the task's own values
 * (`PropertyUpdatePlanner`). `keys` are the keys the built-ins are written
 * under (`TaskViewerSettings.scopeKeys`).
 *
 * `task` is the row as its lines read now: the line is written from its
 * values, `originalText` included (the list marker), so what the fields do
 * not show — the date blocks that do not read, `==>`, `^id` — is written
 * back as it was.
 */
export function planUpdate(task: Task, updates: Partial<Task>, keys: ScopeKeys): UpdateOp {
    return {
        kind: 'update',
        text: formatRow({ ...task, ...updates }),
        properties: { ops: PropertyUpdatePlanner.plan(task, updates, keys), keys },
    };
}
