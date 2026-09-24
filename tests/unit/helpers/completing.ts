import type { Mock } from 'vitest';
import type { FirePlan, FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { canTriggerFlow } from '../../../src/services/flow/FlowTrigger';
import type { GenBlock } from '../../../src/services/parsing/gen/GenBlockCollector';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import { DEFAULT_SETTINGS, type Task } from '../../../src/types';

/**
 * `executor`, able to `complete` a task as the write that completes its row
 * does, over a stand-in repository: the row read as `task` fires only if it
 * can (`canTriggerFlow`, as `planFire` asks), its fire planned with the blocks
 * its note holds (`FlowExecutor.planTask`), the ops it plans handed to
 * `repository.applyToTask` as the one write that applies them, and a plan
 * that failed told as the write tells it once it landed.
 *
 * For a test of what a fire plans. What the write makes of the ops is the
 * write layer's, pinned where the write is.
 */
export function completing<E extends FlowExecutor>(
    executor: E,
    repository: { applyToTask: Mock },
    blocks: Record<string, GenBlock> = {},
): E & { complete(task: Task): Promise<FirePlan> } {
    const complete = async (task: Task): Promise<FirePlan> => {
        if (!canTriggerFlow(task, DEFAULT_SETTINGS.statusDefinitions)) return { kind: 'none' };
        const plan = executor.planTask(task, name => blocks[name]);
        if (plan.kind === 'failed') executor.reportDidNotFire(plan.task, plan.error);
        if (plan.kind === 'fires') {
            const ops = plan.away ? plan.away.ops : plan.ops;
            if (ops.length > 0) await repository.applyToTask(plannedOn(task), ops);
        }
        return plan;
    };
    return Object.assign(executor, { complete });
}
