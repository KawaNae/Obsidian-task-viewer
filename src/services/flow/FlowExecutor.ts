import type { App } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { logError, logInfo, logWarn } from '../../log/log';
import type { IndexReads } from '../core/TaskIndex';
import { formatRow } from '../parsing/TaskLineFormat';
import type { TaskRepository } from '../persistence/TaskRepository';
import { EvalError } from '../lang/ExprEvaluator';
import type { FlowEffect } from './FlowEffects';
import { type FlowDeleteAssessment, assessFlowDelete, planFlowForDeletion } from './FlowDeletion';
import type { TaskOp } from '../persistence/TaskOps';
import type { CompletionFire } from '../persistence/FiringTrials';
import { plannedOn, type ReadCopy } from '../persistence/TaskRefs';
import { type InSection, Placement, type SectionSide } from '../persistence/utils/Placement';
import { Outline } from '../parsing/utils/Outline';
import { flowSource } from '../lang/flow/FlowSegments';
import { type FlowPlanDeps, GenerationError, planFlow } from './FlowPlanner';
import { canTriggerFlow } from './FlowTrigger';
import { createMomentEvalHost } from './MomentEvalHost';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import { namesOutsideIndex } from '../core/RowNames';
import type { GenBlock } from '../parsing/gen/GenBlockCollector';
import { FlowNotices } from './FlowNotices';

/**
 * Where a move to the heading `name` goes in `lines`, at `side` of the
 * section, or why it cannot be made there: the heading is not there, or is
 * there more than once (`Placement.heading`, as the write will look it up:
 * `Placement.into`).
 */
function destinationIn(name: string, side: SectionSide, lines: readonly string[]): InSection | GenerationError {
    const found = Placement.heading(Outline.read(lines), name);
    if (found.kind === 'none') {
        return new GenerationError('eval.move-no-heading', `No heading '${name}' in this note`, { name });
    }
    if (found.kind === 'many') {
        return new GenerationError('eval.move-heading-ambiguous',
            `${found.count} headings are named '${name}' in this note`, { name, count: found.count });
    }
    return { heading: name, side };
}

/**
 * What completing one row fires, planned from the lines the completing write
 * holds (`FlowExecutor.planFire`).
 *
 * - `none`: nothing fires — the row is no task that can fire, or its note is
 *   ignored.
 * - `failed`: the plan failed (an expression, a block, a move to a heading
 *   that is not one place in the note). Nothing is written for the fire,
 *   the command stays, and the caller says so once the completion has
 *   landed (`FlowNotices`).
 * - `fires`: `ops` are what the fire does to the row in the completing
 *   write.
 */
export type FirePlan =
    | { kind: 'none' }
    | { kind: 'failed'; task: Task; error: EvalError | GenerationError }
    | { kind: 'fires'; task: Task; ops: TaskOp[] };

/**
 * A `fire` op, and what its plan answered the last time a write ran it: what
 * the user is owed of it once the write landed (`FlowNotices.notRunsOf`).
 */
export interface FireOp extends CompletionFire {
    /** The plan of the write's last run, or null while no write has run it. */
    planned(): FirePlan | null;
}

/**
 * Flow-command runtime: plans what completing a row fires (pure), from the
 * lines the completing write holds, and what deleting a row with a command
 * writes first. A completion fires from the operation that completed the row
 * — an editor's transaction, the plugin's own write — and from nothing else:
 * no reading of a file, a scan's or a sync's, has a way to fire.
 */
export class FlowExecutor {
    private readonly host = createMomentEvalHost();
    /** Where a delete that stopped is told (`FlowNotices.deletionStopped`). */
    private readonly notices = new FlowNotices();

    constructor(
        private repository: TaskRepository,
        private taskIndex: IndexReads,
        private app: App,
        private getSettings: () => TaskViewerSettings
    ) { }

    /**
     * What completing the row at `line` of `lines` fires: the one place a
     * completion's fire is planned, for the editor's transaction and for the
     * plugin's own write alike. The caller has already answered that the
     * operation completed the row (`completes`); this reads the lines it
     * holds, the ones it is about to write, so there is no older copy of the
     * row for the plan to be made from.
     *
     * Nothing is read unless a `==>` stands on the row or below it: a
     * command is the row's own or its subtree's, and both are at or past the
     * row. A condition for speed only; it never changes the answer.
     */
    planFire(path: string, lines: readonly string[], line: number): FirePlan {
        let commanded = false;
        for (let i = line; i < lines.length && !commanded; i++) commanded = lines[i].includes('==>');
        if (!commanded) return { kind: 'none' };
        const parsed = FileParsePipeline.parse(path, [...lines], this.getSettings(), namesOutsideIndex(path));
        if (parsed.ignored) return { kind: 'none' };
        const task = parsed.tasks.find(candidate => candidate.line === line);
        if (!task || !canTriggerFlow(task, this.getSettings().statusDefinitions)) return { kind: 'none' };
        return this.planTask(task, name => parsed.genBlocks.get(name), lines);
    }

    /**
     * The fire of a row read as `task` in `lines`, its blocks looked up by
     * `blockNamed`: the plan, and what it does to the row, as ops.
     *
     * A move to a heading that is not one place in `lines` fails the plan
     * whole, as an expression that fails does: nothing of the fire is
     * written, the command stays, and the user is told why. Dropping only
     * the move would consume the command, and the user who fixes the heading
     * and checks the row again would find nothing left to fire.
     */
    planTask(task: Task, blockNamed: (name: string) => GenBlock | undefined, lines: readonly string[]): FirePlan {
        const program = task.flow?.program;
        if (!program) return { kind: 'none' };
        logInfo(`[Flow:completion] taskId=${task.id} flow="${task.flow ? flowSource(task.flow) : ''}"`);
        let effects: FlowEffect[];
        try {
            effects = planFlow(task, program, { ...this.buildDeps(), getBlock: (_file, name) => blockNamed(name) });
        } catch (err) {
            if (err instanceof EvalError || err instanceof GenerationError) {
                // Runtime expression failure (e.g. unset property), or a
                // block that cannot produce the next instance: do not fire
                // and do not consume — the command stays for the user to
                // fix, and the message explains why.
                logWarn(`[FlowExecutor] Flow did not fire for ${task.id}: ${err.message}`);
                return { kind: 'failed', task, error: err };
            }
            throw err;
        }
        const ops: TaskOp[] = [];
        for (const effect of effects) {
            logInfo(`[Flow:effect] ${effect.kind} taskId=${task.id}`);
            if (effect.kind !== 'move') {
                ops.push(...this.opsFor(task, effect));
                continue;
            }
            const to = destinationIn(effect.heading, this.getSettings().sectionSide, lines);
            if (to instanceof GenerationError) {
                logWarn(`[FlowExecutor] Flow did not fire for ${task.id}: ${to.message}`);
                return { kind: 'failed', task, error: to };
            }
            // One op: the row is carried, so the moved row is the row that
            // fired, and taking it from where it stood is part of the carrying.
            ops.push({ kind: 'move', text: formatRow(effect.movedTask), to });
        }
        return { kind: 'fires', task, ops };
    }

    /**
     * A `fire` op for a write to `path` that completes a row, with what its
     * plan answered. `vault.process` may run a write's callback more than once;
     * what counts is the last run, the one that was written.
     */
    fireOp(path: string): FireOp {
        let last: FirePlan | null = null;
        return {
            op: {
                kind: 'fire',
                plan: (lines, line) => {
                    const plan = this.planFire(path, lines, line);
                    last = plan;
                    return plan.kind === 'fires' ? plan.ops : [];
                },
            },
            planned: () => last,
        };
    }

    /**
     * What deleting this task would cost, decided before anything is written.
     *
     * The planner is pure, so the dialog can be shown the very line the fire
     * would go on to write. Nothing is queued and nothing is touched.
     */
    assessDeletion(task: Task): FlowDeleteAssessment {
        return assessFlowDelete(task, this.buildDeps(), id => this.taskIndex.getTask(id));
    }

    /**
     * Write the next instance, then remove this one, as one write. The
     * index runs it behind every write already asked of the row
     * (`Operations.onRow`), so it is planned from the copy the last of them
     * left. Awaited, so the caller's own rescan runs after the write has
     * landed.
     *
     * @returns whether the task is gone. False when the fire could not be
     * planned, which stops the delete.
     */
    async fireAndDelete(task: ReadCopy): Promise<boolean> {
        logInfo(`[Flow:delete] taskId=${task.id} flow="${task.flow ? flowSource(task.flow) : ''}"`);
        try {
            return await this.executeDeletionFire(task);
        } catch (err) {
            // Answered, not thrown: the menu that asked waits on the answer.
            logError(`[FlowExecutor] Error deleting task ${task.id}: ${(err as Error)?.message ?? err}`);
            return false;
        }
    }

    /**
     * The delete the user asked for, with the series carried past it.
     *
     * A failed plan stops the delete. The command is still on the line and
     * the line is what was about to go, so removing it now would lose exactly
     * what the user asked to keep. Having nothing to generate is a different
     * answer: an expired command has nothing left to lose, and the delete
     * goes ahead.
     *
     * What the fire writes and what the delete takes away are one write (see
     * {@link TaskRepository.write}): an instance is never left standing
     * beside an original that did not go.
     *
     * @returns whether the task is gone. A fire that could not be planned
     * answers no and writes nothing. A line that could not be resolved answers
     * no and writes nothing either — nothing is written that the user would
     * then have to clear away by hand.
     */
    private async executeDeletionFire(task: ReadCopy): Promise<boolean> {
        const read = this.readingBlocks();
        const outlook = planFlowForDeletion(task, read.deps);

        if (outlook.kind === 'failed') {
            logWarn(`[FlowExecutor] Delete cancelled, flow did not fire for ${task.id}: ${outlook.error.message}`);
            this.notices.deletionStopped(task, outlook.error);
            return false;
        }

        const inserts: TaskOp[] = outlook.kind === 'creates'
            ? outlook.effects.flatMap(effect => {
                logInfo(`[Flow:effect] ${effect.kind} taskId=${task.id} (with the delete)`);
                return this.opsFor(task, effect);
            })
            : [];

        // The instance goes in first, at the head of the sibling group, and
        // the removal follows at the row's line carried across that insert.
        const { written: removed } = await this.repository.write(
            task.file, plannedOn(task, { commands: true, subtree: true, blocks: read.blocks }), [...inserts, { kind: 'remove' }]);
        if (!removed) {
            // Told to the user by the write layer, which refused it.
            logWarn(`[FlowExecutor] Flow fired but the original could not be deleted: ${task.id}`);
        }
        return removed;
    }

    /**
     * What one effect does in the row's own file, as the write applies it,
     * for a completion's fire and a deletion's alike. A move's op takes the
     * destination looked up in the lines (`planTask`).
     */
    private opsFor(task: Task, effect: Exclude<FlowEffect, { kind: 'move' }>): TaskOp[] {
        switch (effect.kind) {
            case 'create-instance':
                // Reported rather than dropped: the written line differs from
                // the one the block describes, and nothing else will say so.
                for (const w of effect.warnings) {
                    logWarn(`[Flow:generated] ${task.id}: ${w.message}`);
                }
                return [{ kind: 'insert-instance', instance: effect.instance }];
            case 'strip-flow':
                // The row without its command. A completion's fire reads the
                // row from the lines its write holds, so this is the row as it
                // is written; a deletion's is checked against the row it was
                // planned from (`plannedOn`).
                return [{ kind: 'strip-flow', text: formatRow({ ...task, flow: undefined }) }];
        }
    }

    /**
     * Plan dependencies that remember the generation blocks the plan read, so
     * the write can find them still reading that way (see `plannedOn`).
     */
    private readingBlocks(): { deps: FlowPlanDeps; blocks: Array<{ name: string; body: readonly string[] }> } {
        const deps = this.buildDeps();
        const blocks: Array<{ name: string; body: readonly string[] }> = [];
        return {
            blocks,
            deps: {
                ...deps,
                getBlock: (filePath, name) => {
                    const block = deps.getBlock(filePath, name);
                    if (block) blocks.push({ name: block.name, body: [...block.body] });
                    return block;
                },
            },
        };
    }

    private buildDeps(): FlowPlanDeps {
        const now = new Date();
        return {
            today: DateUtils.getLocalDateString(now),
            now: {
                date: DateUtils.getLocalDateString(now),
                time: DateUtils.formatHHMM(now.getHours(), now.getMinutes()),
            },
            weekStartDay: this.getSettings().weekStartDay,
            host: this.host,
            getBlock: (filePath, name) => this.taskIndex.getGenBlock(filePath, name),
        };
    }
}
