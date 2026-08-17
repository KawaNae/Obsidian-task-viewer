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
import { type FlowDeleteAssessment, assessFlowDelete, planFlowForDeletion } from './FlowDeletion';
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

        // 2. Resolve the task to its latest line/state
        const currentTask = this.taskIndex.resolveTask(entry.task);
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
     * @returns true when anything was written.
     */
    private async executeDeletionFire(task: Task): Promise<boolean> {
        const outlook = planFlowForDeletion(task, this.buildDeps());

        if (outlook.kind === 'failed') {
            logWarn(`[FlowExecutor] Delete cancelled, flow did not fire for ${task.id}: ${outlook.error.message}`);
            this.reportDidNotFire(task, outlook.error, 'notice.flowDeleteDidNotFire');
            return false;
        }

        if (outlook.kind === 'creates') {
            for (const effect of outlook.effects) {
                logInfo(`[Flow:effect] ${effect.kind} taskId=${task.id} (before delete)`);
                await this.applyEffect(task, effect);
            }
        }

        // Last, by the same rule the effects follow: line resolution matches
        // on originalText, so the line that is being read must stay put until
        // everything that reads it is done.
        await this.repository.deleteTaskFromFile(task);
        return true;
    }

    /** @returns true when effects were applied (false = did not fire). */
    private async executeFlow(task: Task): Promise<boolean> {
        const program = task.flow?.program;
        if (!program) return false;

        let effects: FlowEffect[];
        try {
            effects = planFlow(task, program, this.buildDeps());
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

        // ORDER INVARIANT (see FlowEffects): apply in planner order; effects
        // that rewrite/remove the original line come last because line
        // resolution matches on originalText.
        for (const effect of effects) {
            logInfo(`[Flow:effect] ${effect.kind} taskId=${task.id}`);
            await this.applyEffect(task, effect);
        }
        return effects.length > 0;
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

    private async applyEffect(task: Task, effect: FlowEffect): Promise<void> {
        switch (effect.kind) {
            case 'create-next': {
                const line = TaskParser.format(effect.newTask).trim();
                // Multi-line flows: the new instance's `- ==>` child lines
                // (line-level canonical, from FlowPlanner) are emitted right
                // after the task line.
                const flowLines = (effect.newTask.flow?.childSegments ?? []).map(s => s.raw);
                await this.repository.insertRecurrenceForTask(task, line, flowLines);
                return;
            }
            case 'create-generated':
                // Finished lines: the planner composed the parent, checked
                // it and normalized its status, so there is nothing to
                // format here. What it corrected on the way is reported
                // rather than dropped — the written line differs from the
                // one the block describes, and nothing else will say so.
                for (const w of effect.warnings) {
                    logWarn(`[Flow:generated] ${task.id}: ${w.message}`);
                }
                await this.repository.insertGeneratedInstance(
                    task, effect.parentLine, effect.flowLines, effect.children);
                return;
            case 'archive-to': {
                const line = TaskParser.format(effect.archivedTask);
                await this.repository.appendTaskWithChildren(effect.destPath, line, task);
                return;
            }
            case 'strip-flow':
                // Dedicated writer: rewrites the task line AND deletes the
                // task's direct flow child lines in one atomic process.
                await this.repository.stripFlow(task);
                return;
            case 'delete-original':
                await this.repository.deleteTaskFromFile(task);
                return;
        }
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
