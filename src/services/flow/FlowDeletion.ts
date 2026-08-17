import type { Task } from '../../types';
import { EvalError } from '../lang/ExprEvaluator';
import { TaskParser } from '../parsing/TaskParser';
import type { FlowEffect } from './FlowEffects';
import { type FlowPlanDeps, GenerationError, planFlow } from './FlowPlanner';

/**
 * What firing would save, for a task that is about to be deleted.
 *
 * - `creates`: firing writes a next instance. `effects` are the ones that
 *   write it, and `previewLine` is the line they would put on the page.
 * - `nothing`: there is no command, or the command has nothing left to
 *   generate (until has passed, the telomere is spent, or the command only
 *   moves). Deleting loses nothing that firing could have kept.
 * - `failed`: the command is there and could not be planned. The command
 *   would go with the line, and firing cannot save it.
 */
export type FlowDeleteOutlook =
    | { kind: 'creates'; effects: FlowEffect[]; previewLine: string }
    | { kind: 'nothing' }
    | { kind: 'failed'; error: EvalError | GenerationError };

export interface FlowDeleteAssessment {
    outlook: FlowDeleteOutlook;
    /**
     * Descendants carrying a command of their own, which the delete takes
     * with it.
     *
     * Counted, not rescued. A fired instance is written into its own sibling
     * group, which for a descendant sits inside the subtree being deleted —
     * so anything fired on their behalf would be deleted in the same breath.
     * Saying how many go is the whole of what can be offered here.
     */
    descendantFlows: number;
}

/**
 * Plan the fire that precedes a delete.
 *
 * The planner is pure, so this answers "would firing save anything, and what
 * exactly would it write" before a single byte is written. The dialog asks it
 * to decide what to offer; the executor asks it again to do the work, and both
 * get the same answer for the same task.
 *
 * The effects that write the next instance are kept and the ones that end the
 * original are dropped: fire-consumes normally strips the command off the line,
 * but here the line goes away entirely, which consumes it more thoroughly than
 * stripping ever could. `archive-to` is dropped with them. A user who chose
 * delete did not choose to keep a copy somewhere else, and the command's own
 * reading of `move` is not a reason to leave one behind.
 */
export function planFlowForDeletion(task: Task, deps: FlowPlanDeps): FlowDeleteOutlook {
    const program = task.flow?.program;
    if (!program) return { kind: 'nothing' };

    let effects: FlowEffect[];
    try {
        effects = planFlow(task, program, deps);
    } catch (err) {
        if (err instanceof EvalError || err instanceof GenerationError) {
            return { kind: 'failed', error: err };
        }
        throw err;
    }

    const creating = effects.filter(e => e.kind === 'create-next' || e.kind === 'create-generated');
    if (creating.length === 0) return { kind: 'nothing' };

    return { kind: 'creates', effects: creating, previewLine: previewOf(creating[0]) };
}

/** Count `task` and its descendants together, then report the descendants. */
export function assessFlowDelete(
    task: Task,
    deps: FlowPlanDeps,
    getTask: (id: string) => Task | undefined,
): FlowDeleteAssessment {
    return {
        outlook: planFlowForDeletion(task, deps),
        descendantFlows: countDescendantFlows(task, getTask),
    };
}

/**
 * Descendants that carry an executable command.
 *
 * Whether each of them would generate anything is not asked. Planning every
 * descendant costs a full evaluation per task to refine a number the user
 * reads as "and these go too", and a command that generates nothing is still
 * a command they wrote and are about to lose.
 */
export function countDescendantFlows(task: Task, getTask: (id: string) => Task | undefined): number {
    let count = 0;
    const seen = new Set<string>([task.id]);
    const stack = [...task.childIds];

    while (stack.length > 0) {
        const id = stack.pop()!;
        // Guard the walk rather than trust the tree: a cycle here would hang
        // the menu, and the menu is opened by a right-click on a card.
        if (seen.has(id)) continue;
        seen.add(id);

        const child = getTask(id);
        if (!child) continue;
        if (child.flow?.program) count++;
        stack.push(...child.childIds);
    }

    return count;
}

/**
 * The line the fire would write.
 *
 * A generated instance arrives as finished text with its clause already
 * composed; a plain one arrives as a Task and is spelled the way the writer
 * will spell it. Neither carries indentation, which is decided against the
 * file at write time and would only be noise in a dialog.
 */
function previewOf(effect: FlowEffect): string {
    if (effect.kind === 'create-generated') return effect.parentLine.trim();
    if (effect.kind === 'create-next') return TaskParser.format(effect.newTask).trim();
    return '';
}
