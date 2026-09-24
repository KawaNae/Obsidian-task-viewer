import { type App, Notice, TFile } from 'obsidian';
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
import type { TaskOp } from '../persistence/TaskOps';
import { plannedOn } from '../persistence/TaskRefs';
import type { Refusal } from '../../utils/FileLines';
import { flowSource } from './FlowSegments';
import { type FlowPlanDeps, GenerationError, planFlow } from './FlowPlanner';
import { canTriggerFlow } from './FlowTrigger';
import { createMomentEvalHost } from './MomentEvalHost';
import { runtimeText } from './runtimeText';

/**
 * Flow-command runtime: queues completion events, re-resolves the task
 * against the latest scan, plans effects (pure), and interprets them
 * against TaskRepository.
 *
 * The queue is strictly sequential and awaits a rescan after each task —
 * this is load-bearing: firing consumes the command (the line is
 * rewritten), which changes the completion-detection signature. Running
 * two fires against a stale index would double-generate.
 */
/** How long one failure stays quiet after it has been shown. */
const FAILURE_NOTICE_WINDOW_MS = 5000;

/** The file as it is named in the vault, which is how a user knows it. */
function fileName(path: string): string {
    return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

/**
 * One entry of work, and which of the two ways of consuming a command it is.
 *
 * `completion` is a check the user ticked. `delete` is a task the user is
 * removing, having asked for its next instance to be written first. Both
 * rewrite the same line, which is why they share one queue rather than each
 * having their own.
 */
interface FlowQueueEntry {
    task: Task;
    mode: 'completion' | 'delete';
    /**
     * Whether the task is gone, for a delete entry.
     *
     * A fire that could not be planned keeps the task, so the answer is not
     * always yes, and the caller acts on it — the menu closes the panel it
     * was deleting from.
     */
    removed?: boolean;
    /** Resolved when the entry leaves the queue, for callers that wait. */
    settle?: (removed: boolean) => void;
}

export class FlowExecutor {
    private taskQueue: FlowQueueEntry[] = [];
    private isProcessing = false;
    private readonly host = createMomentEvalHost();
    /** Failures already shown, by task and message, with when they were shown. */
    private readonly recentFailures = new Map<string, number>();

    constructor(
        private repository: TaskRepository,
        private taskIndex: TaskIndex,
        private app: App,
        private getSettings: () => TaskViewerSettings
    ) { }

    async handleTaskCompletion(task: Task): Promise<void> {
        if (!canTriggerFlow(task, this.getSettings().statusDefinitions)) return;
        logInfo(`[Flow:completion] taskId=${task.id} flow="${task.flow ? flowSource(task.flow) : ''}"`);
        this.taskQueue.push({ task, mode: 'completion' });
        // Fire and forget; the queue serializes execution.
        this.processQueue();
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
     * Write the next instance, then remove this one.
     *
     * Goes through the same queue as a completion because it rewrites the
     * same file: a fire racing the completion queue against a stale index
     * would double-generate, which is the reason the queue exists at all.
     * Awaited, so the caller's own rescan runs after the writes have landed.
     *
     * @returns whether the task is gone. False when the fire could not be
     * planned, which stops the delete.
     */
    async fireAndDelete(task: Task): Promise<boolean> {
        logInfo(`[Flow:delete] taskId=${task.id} flow="${task.flow ? flowSource(task.flow) : ''}"`);
        return new Promise<boolean>(resolve => {
            this.taskQueue.push({ task, mode: 'delete', settle: resolve });
            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;
        let didExecute = false;

        try {
            while (this.taskQueue.length > 0) {
                const entry = this.taskQueue[0]; // Peek
                try {
                    didExecute = (await this.processEntry(entry)) || didExecute;
                } catch (err) {
                    logError(`[FlowExecutor] Error processing task ${entry.task.id}: ${(err as Error)?.message ?? err}`);
                } finally {
                    // Leaving the queue and waking the caller happen here and
                    // nowhere else, so a throw on any road out still frees
                    // both — a delete that never settled would hang the menu
                    // that asked for it.
                    this.taskQueue.shift();
                    entry.settle?.(entry.removed === true);
                }
            }
        } finally {
            this.isProcessing = false;
            if (didExecute) {
                this.taskIndex.notifyImmediate();
            }
        }
    }

    /** @returns true when effects were applied (false = did not fire). */
    private async processEntry(entry: FlowQueueEntry): Promise<boolean> {
        // 1. Wait for any pending file scans (file state re-acquisition)
        await this.taskIndex.waitForScan(entry.task.file);

        // 2. The task as the index holds it now, by name. Not by its text or
        //    its line: a row worded like it is not it, and the name is what
        //    every write below asks after (see TaskScanner.locate). A row
        //    edited since the completion was seen is still this row, and the
        //    check below decides whether it still fires.
        const currentTask = this.taskIndex.getTask(entry.task.id);
        if (!currentTask) {
            // Nothing to resolve is nothing to delete: the line is already
            // gone, which is the state the caller was asking for.
            entry.removed = entry.mode === 'delete';
            return false;
        }

        // 3. Re-check triggerability (it may have been unchecked). A delete
        //    is not a completion and carries no status condition — the user
        //    asked for it directly.
        if (entry.mode === 'completion'
            && !canTriggerFlow(currentTask, this.getSettings().statusDefinitions)) {
            return false;
        }

        let didExecute: boolean;
        if (entry.mode === 'delete') {
            didExecute = await this.executeDeletionFire(currentTask);
            // The delete path writes exactly when it removes the task, so
            // the two answers are one.
            entry.removed = didExecute;
        } else {
            didExecute = await this.executeFlow(currentTask);
        }

        // 4. Await the rescan triggered by our own writes so the next
        //    queue entry (and completion detection) sees fresh state.
        const file = this.app.vault.getAbstractFileByPath(currentTask.file);
        if (file instanceof TFile) {
            await this.taskIndex.requestScan(file);
        }
        return didExecute;
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
     * {@link TaskRepository.applyToTask}). They used to be two, and the second
     * one resolved the original by its text after the first had written a line
     * worded exactly like it — which is how a delete came to take the instance
     * it had just created, leaving the file as it started and the task still
     * on the page. One write also settles the outcome the two of them could
     * not: an instance can no longer be left standing beside an original that
     * would not go.
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
            this.reportDidNotFire(task, outlook.error, 'notice.flowDeleteDidNotFire');
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
     * The same next instance {@link applyEffect} would write, handed over as
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

    /** @returns true when effects were applied (false = did not fire). */
    private async executeFlow(task: Task): Promise<boolean> {
        const program = task.flow?.program;
        if (!program) return false;

        let effects: FlowEffect[];
        const read = this.readingBlocks();
        try {
            effects = planFlow(task, program, read.deps);
        } catch (err) {
            if (err instanceof EvalError || err instanceof GenerationError) {
                // Runtime expression failure (e.g. unset property), or a
                // block that cannot produce the next instance: do not fire
                // and do not consume — the command stays for the user to
                // fix, and the message explains why.
                logWarn(`[FlowExecutor] Flow did not fire for ${task.id}: ${err.message}`);
                this.reportDidNotFire(task, err);
                return false;
            }
            throw err;
        }

        // Everything the fire does in the row's own file is one write: all of
        // it lands or none does, and a command is never consumed without its
        // next instance, nor the other way round.
        const ops = effects.flatMap(effect => {
            logInfo(`[Flow:effect] ${effect.kind} taskId=${task.id}`);
            return this.opsFor(task, effect);
        });

        // A move to another file is the one fire that writes two files, and
        // two files cannot be one write. The destination goes first: until it
        // has landed nothing in the source is touched, so a move whose row
        // cannot be placed writes nothing anywhere. Once it has, the source's
        // write can still be refused, and then the task is in both files —
        // handing a move from one file to the other is F8's.
        const away = effects.find(
            (effect): effect is Extract<FlowEffect, { kind: 'archive-to' }> =>
                effect.kind === 'archive-to' && effect.destPath !== task.file);
        if (away) {
            const planned = plannedOn(task, { commands: true, subtree: true, blocks: read.blocks });
            const archived = await this.repository.appendTaskWithChildren(
                away.destPath, TaskParser.format(away.archivedTask), planned);
            if (archived === null) {
                // Told to the user by the write layer, which refused it.
                logWarn(`[FlowExecutor] Flow did not fire, nothing written: ${task.id}`);
                return false;
            }
            // The source has to read as it did when its subtree was archived:
            // a child edited in between would otherwise go with the removal,
            // its edit kept nowhere.
            const outcome = await this.repository.applyToTask(
                { ...planned, basis: { ...planned.basis, subtree: archived } }, ops, { tellRefusal: false });
            if (outcome.refused) this.reportMoveLeftCopy(task, away.destPath, outcome.refused);
            return true;
        }

        // Named with what the plan was made from: the write refuses a row that
        // no longer reads that way, rather than writing the plan over it. A
        // move within the file carries the row's subtree, so the subtree is
        // part of what it planned from.
        const carries = ops.some(op => op.kind === 'move-to-end' || op.kind === 'remove');
        const outcome = await this.repository.applyToTask(
            plannedOn(task, { commands: true, subtree: carries, blocks: read.blocks }), ops);
        if (!outcome.written) {
            // Told to the user by the write layer, which refused it.
            logWarn(`[FlowExecutor] Flow did not fire, nothing written: ${task.id}`);
        }
        return outcome.written;
    }

    /**
     * Tell the user that a move reached its destination and left the original
     * where it was: the task is in two places now, and nothing on screen says
     * so. One notice, saying both — the refusal of the source's write would
     * otherwise be a second one, telling half of it.
     */
    private reportMoveLeftCopy(task: Task, destPath: string, refused: Refusal): void {
        logWarn(`[FlowExecutor] Moved but the original could not be removed: ${task.id} (${refused.reason.kind})`);
        const reason = refused.reason.kind === 'ambiguous'
            ? t('notice.moveOriginAmbiguous', { count: refused.reason.count })
            : refused.reason.kind === 'gone'
                ? t('notice.moveOriginGone')
                : refused.reason.kind === 'unplaceable'
                    ? t('notice.moveOriginUnplaceable')
                    : refused.reason.kind === 'disturbs'
                        ? t('notice.moveOriginDisturbs')
                        : t('notice.moveOriginChanged');
        new Notice(t('notice.moveOriginKept', { dest: fileName(destPath), reason, subject: refused.subject }));
    }

    /** What one effect does in the row's own file, as the write applies it. */
    private opsFor(task: Task, effect: FlowEffect): TaskOp[] {
        switch (effect.kind) {
            case 'create-next':
            case 'create-generated':
                return [{ kind: 'insert-instance', insert: this.instanceInsertFor(task, effect) }];
            case 'strip-flow':
                // The row as the index read it, without its command. The write
                // refuses a row, or command lines, that read otherwise now
                // (`plannedOn`), so this is not a stale copy written over an
                // edit made since — someone else's or a write of ours.
                return [{ kind: 'strip-flow', text: TaskParser.format({ ...task, flow: undefined }) }];
            case 'archive-to':
                // To another file it is written before this write (see
                // executeFlow). Within the file it is one op: the row is
                // carried to the end, so the moved row is the row that fired,
                // and taking it from where it stood is part of the carrying.
                // Its text is made from the index's copy on the same terms as
                // the strip.
                return effect.destPath === task.file
                    ? [{ kind: 'move-to-end', text: TaskParser.format(effect.archivedTask) }]
                    : [];
            case 'delete-original':
                // Within the file, done by `move-to-end` above.
                return effect.destPath === task.file ? [] : [{ kind: 'remove' }];
        }
    }

    /**
     * Tell the user that the check they ticked did nothing.
     *
     * Not firing and not consuming is the design — a command whose expression
     * failed has to stay on the line — but from the outside it is a checkbox
     * that answers with nothing at all. The log line was the only trace, and
     * nobody has the console open while ticking a task.
     *
     * The same failure is shown once per window. A task is toggled on and off
     * while its author works out what is wrong, and a notice per toggle would
     * bury the file behind its own complaint. A different failure is a
     * different message, so fixing one and hitting the next is still visible.
     *
     * A delete that stopped for the same reason says so in its own sentence.
     * The task is still on the page and the user is watching for it to go, so
     * "the flow did not fire" would leave them to work out that the delete
     * did not happen either.
     */
    private reportDidNotFire(
        task: Task,
        err: EvalError | GenerationError,
        messageKey: 'notice.flowDidNotFire' | 'notice.flowDeleteDidNotFire' = 'notice.flowDidNotFire',
    ): void {
        const now = Date.now();
        // Drop what has aged out on the way past, so a long session does not
        // keep a key for every failure it has ever seen.
        for (const [key, at] of this.recentFailures) {
            if (now - at >= FAILURE_NOTICE_WINDOW_MS) this.recentFailures.delete(key);
        }
        // Which failure this is, said in neither language: the code and the
        // values it was given. Keying on the sentence would make the same
        // failure a different one as soon as the vault changes language.
        const key = `${messageKey}::${task.id}::${err.code}::${JSON.stringify(err.params ?? {})}`;
        if (this.recentFailures.has(key)) return;
        this.recentFailures.set(key, now);
        new Notice(t(messageKey, { reason: runtimeText(err), file: fileName(task.file) }));
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
