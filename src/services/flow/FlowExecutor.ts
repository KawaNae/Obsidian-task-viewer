import { type App, Notice } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { t } from '../../i18n';
import { DateUtils } from '../../utils/DateUtils';
import { logError, logInfo, logWarn } from '../../log/log';
import type { TaskIndex } from '../core/TaskIndex';
import { TaskParser } from '../parsing/TaskParser';
import type { TaskRepository } from '../persistence/TaskRepository';
import { EvalError } from '../lang/ExprEvaluator';
import type { FlowEffect } from './FlowEffects';
import { type CreatingEffect, type FlowDeleteAssessment, assessFlowDelete, planFlowForDeletion } from './FlowDeletion';
import type { FlowInstanceInsert } from '../persistence/FlowInstanceLines';
import type { CompletionFire, MoveDestination, TaskOp } from '../persistence/TaskOps';
import { plannedOn, subjectOf } from '../persistence/TaskRefs';
import type { Refusal } from '../persistence/FileLines';
import { refusalClause } from '../core/RefusalClause';
import { Placement } from '../persistence/utils/Placement';
import { Outline } from '../parsing/utils/Outline';
import type { MoveTarget } from './FlowAst';
import { flowSource } from './FlowSegments';
import { type FlowPlanDeps, GenerationError, planFlow } from './FlowPlanner';
import { canTriggerFlow } from './FlowTrigger';
import { createMomentEvalHost } from './MomentEvalHost';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import type { GenBlock } from '../parsing/gen/GenBlockCollector';
import { runtimeText } from './runtimeText';

/**
 * Where a move to `to` goes in `lines`, or why it cannot be made there: it
 * names another note (retired, F8), or the heading it names is not there, or
 * is there more than once (`Placement.heading`, as the write will look it up).
 */
function destinationIn(to: MoveTarget, lines: readonly string[]): MoveDestination | GenerationError {
    if (to.kind === 'retired') {
        return new GenerationError('eval.move-retired',
            'move() moves the task within its note only, and this one names another note');
    }
    if (to.kind === 'end') return to;
    const found = Placement.heading(Outline.read(lines), to.name);
    if (found.kind === 'none') {
        return new GenerationError('eval.move-no-heading', `No heading '${to.name}' in this note`, { name: to.name });
    }
    if (found.kind === 'many') {
        return new GenerationError('eval.move-heading-ambiguous',
            `${found.count} headings are named '${to.name}' in this note`, { name: to.name, count: found.count });
    }
    return to;
}

/** How long one failure stays quiet after it has been shown. */
const FAILURE_NOTICE_WINDOW_MS = 5000;

/** The file as it is named in the vault, which is how a user knows it. */
function fileName(path: string): string {
    return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

/**
 * What completing one row fires, planned from the lines the completing write
 * holds (`FlowExecutor.planFire`).
 *
 * - `none`: nothing fires — the row is no task that can fire, or its note is
 *   ignored.
 * - `failed`: the plan failed (an expression, a block, a move's
 *   destination). Nothing is written for the fire, the command stays, and
 *   the caller says so once the completion has landed (`reportNotRun`).
 * - `fires`: `ops` are what the fire does to the row in the completing
 *   write.
 */
export type FirePlan =
    | { kind: 'none' }
    | { kind: 'failed'; task: Task; error: EvalError | GenerationError }
    | { kind: 'fires'; task: Task; ops: TaskOp[] };

/**
 * Why a completion was written without its flow (`FlowExecutor.reportNotRun`):
 * the fire's plan failed, or the fire's write was refused, for the reason the
 * write gave.
 */
export type NotRun = Extract<FirePlan, { kind: 'failed' }> | { kind: 'refused'; refusal: Refusal };

/**
 * A `fire` op, what its plan answered the last time a write ran it, and
 * whether that plan writes lines (`CompletionFire.writes`).
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
    /** Failures already shown, by task and message, with when they were shown. */
    private readonly recentFailures = new Map<string, number>();

    constructor(
        private repository: TaskRepository,
        private taskIndex: TaskIndex,
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
        const parsed = FileParsePipeline.parse(path, [...lines], this.getSettings());
        if (parsed.ignored) return { kind: 'none' };
        const task = parsed.tasks.find(candidate => candidate.line === line);
        if (!task || !canTriggerFlow(task, this.getSettings().statusDefinitions)) return { kind: 'none' };
        return this.planTask(task, name => parsed.genBlocks.get(name), lines);
    }

    /**
     * The fire of a row read as `task` in `lines`, its blocks looked up by
     * `blockNamed`: the plan, and what it does to the row, as ops.
     *
     * A move whose destination is not one place in `lines` fails the plan
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
            const to = destinationIn(effect.to, lines);
            if (to instanceof GenerationError) {
                logWarn(`[FlowExecutor] Flow did not fire for ${task.id}: ${to.message}`);
                return { kind: 'failed', task, error: to };
            }
            // One op: the row is carried, so the moved row is the row that
            // fired, and taking it from where it stood is part of the carrying.
            ops.push({ kind: 'move', text: TaskParser.format(effect.movedTask), to });
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
            writes: () => {
                const planned = last as FirePlan | null;
                return planned?.kind === 'fires' && planned.ops.length > 0;
            },
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
     * (`TaskIndex.onRow`), so it is planned from the copy the last of them
     * left. Awaited, so the caller's own rescan runs after the write has
     * landed.
     *
     * @returns whether the task is gone. False when the fire could not be
     * planned, which stops the delete.
     */
    async fireAndDelete(task: Task): Promise<boolean> {
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
     * {@link TaskRepository.applyToTask}): an instance is never left standing
     * beside an original that did not go.
     *
     * @returns whether the task is gone. A fire that could not be planned
     * answers no and writes nothing. A line that could not be resolved answers
     * no and writes nothing either — nothing is written that the user would
     * then have to clear away by hand.
     */
    private async executeDeletionFire(task: Task): Promise<boolean> {
        const read = this.readingBlocks();
        const outlook = planFlowForDeletion(task, read.deps);

        if (outlook.kind === 'failed') {
            logWarn(`[FlowExecutor] Delete cancelled, flow did not fire for ${task.id}: ${outlook.error.message}`);
            this.reportDeleteDidNotFire(task, outlook.error);
            return false;
        }

        const inserts: TaskOp[] = outlook.kind === 'creates'
            ? outlook.effects.map(effect => {
                logInfo(`[Flow:effect] ${effect.kind} taskId=${task.id} (with the delete)`);
                return { kind: 'insert-instance', insert: this.instanceInsertFor(task, effect) };
            })
            : [];

        // The instance goes in first, at the head of the sibling group, and
        // the removal follows at the row's line carried across that insert.
        const { written: removed } = await this.repository.applyToTask(
            plannedOn(task, { commands: true, subtree: true, blocks: read.blocks }), [...inserts, { kind: 'remove' }]);
        if (!removed) {
            // Told to the user by the write layer, which refused it.
            logWarn(`[FlowExecutor] Flow fired but the original could not be deleted: ${task.id}`);
        }
        return removed;
    }

    /**
     * The same next instance {@link opsFor} would write, handed over as
     * lines-to-be rather than written on the spot.
     *
     * The two paths read one effect the same way — a recurrence is formatted
     * here and a generated instance arrives finished — and they render it with
     * the same function, so a deletion fire and an ordinary one cannot come to
     * write different lines for the same command.
     */
    private instanceInsertFor(task: Task, effect: CreatingEffect): FlowInstanceInsert {
        if (effect.kind === 'create-next') {
            return {
                kind: 'recurrence',
                content: TaskParser.format(effect.newTask),
                flowLines: (effect.newTask.flow?.childSegments ?? []).map(s => s.raw),
            };
        }
        // Reported rather than dropped, on this path as on the other: the
        // written line differs from the one the block describes, and nothing
        // else will say so.
        for (const w of effect.warnings) {
            logWarn(`[Flow:generated] ${task.id}: ${w.message}`);
        }
        return {
            kind: 'generated',
            parentLine: effect.parentLine,
            flowLines: effect.flowLines,
            children: effect.children,
        };
    }

    /**
     * What one effect does in the row's own file, as the write applies it. A
     * move's op takes the destination looked up in the lines (`planTask`).
     */
    private opsFor(task: Task, effect: Exclude<FlowEffect, { kind: 'move' }>): TaskOp[] {
        switch (effect.kind) {
            case 'create-next':
            case 'create-generated':
                return [{ kind: 'insert-instance', insert: this.instanceInsertFor(task, effect) }];
            case 'strip-flow':
                // The row without its command. A completion's fire reads the
                // row from the lines its write holds, so this is the row as it
                // is written; a deletion's is checked against the row it was
                // planned from (`plannedOn`).
                return [{ kind: 'strip-flow', text: TaskParser.format({ ...task, flow: undefined }) }];
        }
    }

    /**
     * Tell the user a completion was written and its flow was not run, and
     * why: its plan failed, or the fire's write was refused. The one notice of
     * it, for a card's write and the editor's alike.
     *
     * Not firing and not consuming is the design — a command whose expression
     * failed has to stay on the line — but from the outside it is a checkbox
     * that answers with nothing at all. The log line was the only trace, and
     * nobody has the console open while ticking a task.
     *
     * The same failure of a plan is shown once per window (`shownLately`).
     */
    reportNotRun(why: NotRun): void {
        if (why.kind === 'refused') {
            const { reason, subject, file } = why.refusal;
            logWarn(`[FlowExecutor] fire refused, completion written: file=${file} reason=${reason.kind} subject=${subject}`);
            new Notice(t('notice.flowNotRun', { reason: refusalClause(reason), subject }));
            return;
        }
        if (this.shownLately('notice.flowNotRun', why.task, why.error)) return;
        new Notice(t('notice.flowNotRun', { reason: runtimeText(why.error), subject: subjectOf(why.task) }));
    }

    /**
     * Tell the user a delete stopped because its fire could not be planned,
     * in a sentence of its own: the task is still on the page and the user is
     * watching for it to go, so "the flow was not run" would leave them to
     * work out that the delete did not happen either. Once per window, as
     * {@link reportNotRun}.
     */
    private reportDeleteDidNotFire(task: Task, err: EvalError | GenerationError): void {
        if (this.shownLately('notice.flowDeleteDidNotFire', task, err)) return;
        new Notice(t('notice.flowDeleteDidNotFire', { reason: runtimeText(err), file: fileName(task.file) }));
    }

    /**
     * Whether the notice `notice` of this failure of the task's plan was shown
     * within the window; if not, it counts as shown now. A task is toggled on
     * and off while its author works out what is wrong, and a notice per
     * toggle would bury the file behind its own complaint. A different
     * failure is a different message, so fixing one and hitting the next is
     * still visible.
     */
    private shownLately(notice: string, task: Task, err: EvalError | GenerationError): boolean {
        const now = Date.now();
        // Drop what has aged out on the way past, so a long session does not
        // keep a key for every failure it has ever seen.
        for (const [key, at] of this.recentFailures) {
            if (now - at >= FAILURE_NOTICE_WINDOW_MS) this.recentFailures.delete(key);
        }
        // Which failure this is, said in neither language: the code and the
        // values it was given. Keying on the sentence would make the same
        // failure a different one as soon as the vault changes language.
        const key = `${notice}::${task.id}::${err.code}::${JSON.stringify(err.params ?? {})}`;
        if (this.recentFailures.has(key)) return true;
        this.recentFailures.set(key, now);
        return false;
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
        const pad = (n: number) => String(n).padStart(2, '0');
        return {
            today: DateUtils.getLocalDateString(now),
            now: {
                date: DateUtils.getLocalDateString(now),
                time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
            },
            weekStartDay: this.getSettings().weekStartDay,
            host: this.host,
            getBlock: (filePath, name) => this.taskIndex.getGenBlock(filePath, name),
        };
    }
}
