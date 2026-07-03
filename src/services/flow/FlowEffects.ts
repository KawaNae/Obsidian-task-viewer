import { Task } from '../../types';

/**
 * Effect descriptors produced by the pure planner and applied by the
 * FlowExecutor's interpreter against TaskRepository.
 *
 * ORDER INVARIANT: the planner emits effects in the order
 *   create-next → archive-to → strip-flow / delete-original
 * and the interpreter applies them sequentially without reordering.
 * Effects that rewrite or remove the original line must run last, because
 * line resolution (findTaskLineNumber) matches on originalText.
 */
export type FlowEffect =
    | { kind: 'create-next'; newTask: Task; copyChildren: boolean }
    | { kind: 'archive-to'; destPath: string; archivedTask: Task }
    | { kind: 'strip-flow' }
    | { kind: 'delete-original' };
