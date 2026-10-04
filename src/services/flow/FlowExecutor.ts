import type { Task, TaskViewerSettings } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { visualDayOf } from '../../utils/DayWindow';
import { logInfo, logWarn } from '../../log/log';
import { formatRow } from '../parsing/TaskLineFormat';
import { EvalError } from '../lang/ExprEvaluator';
import type { FlowEffect } from './FlowEffects';
import { type FlowDeleteAssessment, assessFlowDelete, planFlowForDeletion } from './FlowDeletion';
import type { TaskOp } from '../persistence/TaskOps';
import type { CompletionFire } from '../persistence/FiringTrials';
import { type InSection, Placement, type SectionSide } from '../persistence/utils/Placement';
import { Outline } from '../parsing/utils/Outline';
import { flowSource } from '../lang/flow/FlowSegments';
import { type FlowPlanDeps, GenerationError, planFlow } from './FlowPlanner';
import { canTriggerFlow } from './FlowTrigger';
import { createMomentEvalHost } from './MomentEvalHost';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import { namesOutsideIndex } from '../core/RowNames';
import type { GenBlock } from '../parsing/gen/GenBlockCollector';

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
 * What the flow reads of the notes besides the lines a write holds: a note's
 * generation block by its name, and a row by its id. The index answers both
 * (`IndexReads`); the flow names only what it reads.
 */
export interface FlowReads {
    getGenBlock(file: string, name: string): GenBlock | undefined;
    getTask(id: string): Task | undefined;
}

/**
 * What deleting a row with its fire writes (`FlowExecutor.planDeletion`).
 *
 * - `failed`: the fire could not be planned, which stops the delete: the
 *   command is on the line that was about to go, and removing it would lose
 *   exactly what the user asked to keep.
 * - `deletes`: `ops`, the next instance (none when the command has nothing
 *   left to generate) and then the row's removal, as one write; `blocks`,
 *   the generation blocks the plan read, for the write to find still reading
 *   so (`plannedOn`).
 */
export type DeletionPlan =
    | { kind: 'failed'; error: EvalError | GenerationError }
    | { kind: 'deletes'; ops: TaskOp[]; blocks: ReadonlyArray<{ name: string; body: readonly string[] }> };

/**
 * A `fire` op, and what its plan answered the last time a write ran it: what
 * the user is owed of it once the write landed (`FlowNotices.notRunsOf`).
 */
export interface FireOp extends CompletionFire {
    /** The plan of the write's last run, or null while no write has run it. */
    planned(): FirePlan | null;
}

/**
 * Flow-command runtime: plans what completing a row fires, from the lines the
 * completing write holds, and what deleting a row with a command writes. It
 * only plans: the operations write the plans (`Operations`) and tell the user
 * what did not run (`FlowNotices`). A completion fires from the operation
 * that completed the row — an editor's transaction, the plugin's own write —
 * and from nothing else: no reading of a file, a scan's or a sync's, has a
 * way to fire.
 */
export class FlowExecutor {
    private readonly host = createMomentEvalHost();

    constructor(
        private readonly reads: FlowReads,
        private readonly getSettings: () => TaskViewerSettings,
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
        return assessFlowDelete(task, this.buildDeps(), id => this.reads.getTask(id));
    }

    /**
     * What deleting `task` with its fire writes: the next instance, then the
     * row taken away, as one write (`Operations.deleteTask` writes it, behind
     * every write already asked of the row, so this is planned from the copy
     * the last of them left). An instance is never left standing beside an
     * original that did not go.
     *
     * A failed plan stops the delete (`DeletionPlan`). Having nothing to
     * generate is a different answer: an expired command has nothing left to
     * lose, and the delete goes ahead, the removal alone.
     */
    planDeletion(task: Task): DeletionPlan {
        logInfo(`[Flow:delete] taskId=${task.id} flow="${task.flow ? flowSource(task.flow) : ''}"`);
        const read = this.readingBlocks();
        const outlook = planFlowForDeletion(task, read.deps);
        if (outlook.kind === 'failed') {
            logWarn(`[FlowExecutor] Delete cancelled, flow did not fire for ${task.id}: ${outlook.error.message}`);
            return { kind: 'failed', error: outlook.error };
        }
        const inserts: TaskOp[] = outlook.kind === 'creates'
            ? outlook.effects.flatMap(effect => {
                logInfo(`[Flow:effect] ${effect.kind} taskId=${task.id} (with the delete)`);
                return this.opsFor(task, effect);
            })
            : [];
        // The instance goes in first, at the head of the sibling group, and
        // the removal follows at the row's line carried across that insert.
        return { kind: 'deletes', ops: [...inserts, { kind: 'remove' }], blocks: read.blocks };
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
        const settings = this.getSettings();
        return {
            // A relative day is a visual day: completing at 02:00 with
            // startHour 5 is still the day before's work.
            today: visualDayOf(now.getTime(), settings.startHour),
            now: {
                date: DateUtils.getLocalDateString(now),
                time: DateUtils.formatHHMM(now.getHours(), now.getMinutes()),
            },
            weekStartDay: settings.weekStartDay,
            host: this.host,
            getBlock: (filePath, name) => this.reads.getGenBlock(filePath, name),
        };
    }
}
