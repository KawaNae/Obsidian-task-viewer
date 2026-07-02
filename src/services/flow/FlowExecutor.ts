import { App, TFile } from 'obsidian';
import { Task, TaskViewerSettings } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { logError, logInfo, logWarn } from '../../log/log';
import { TaskIndex } from '../core/TaskIndex';
import { TaskParser } from '../parsing/TaskParser';
import { TaskRepository } from '../persistence/TaskRepository';
import { EvalError } from '../lang/ExprEvaluator';
import { FlowEffect } from './FlowEffects';
import { flowSource } from './FlowSegments';
import { FlowPlanDeps, planFlow } from './FlowPlanner';
import { canTriggerFlow } from './FlowTrigger';
import { createMomentEvalHost } from './MomentEvalHost';

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
export class FlowExecutor {
    private taskQueue: Task[] = [];
    private isProcessing = false;
    private readonly host = createMomentEvalHost();

    constructor(
        private repository: TaskRepository,
        private taskIndex: TaskIndex,
        private app: App,
        private getSettings: () => TaskViewerSettings
    ) { }

    async handleTaskCompletion(task: Task): Promise<void> {
        if (!canTriggerFlow(task, this.getSettings().statusDefinitions)) return;
        logInfo(`[Flow:completion] taskId=${task.id} flow="${task.flow ? flowSource(task.flow) : ''}"`);
        this.taskQueue.push(task);
        // Fire and forget; the queue serializes execution.
        this.processQueue();
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;
        let didExecute = false;

        try {
            while (this.taskQueue.length > 0) {
                const originalTask = this.taskQueue[0]; // Peek

                // 1. Wait for any pending file scans (file state re-acquisition)
                await this.taskIndex.waitForScan(originalTask.file);

                // 2. Resolve the task to its latest line/state
                const currentTask = this.taskIndex.resolveTask(originalTask);
                if (!currentTask) {
                    this.taskQueue.shift();
                    continue;
                }

                // 3. Re-check triggerability (it may have been unchecked)
                if (!canTriggerFlow(currentTask, this.getSettings().statusDefinitions)) {
                    this.taskQueue.shift();
                    continue;
                }

                try {
                    didExecute = (await this.executeFlow(currentTask)) || didExecute;
                } catch (err) {
                    logError(`[FlowExecutor] Error processing task ${currentTask.id}: ${(err as Error)?.message ?? err}`);
                }

                this.taskQueue.shift();

                // 4. Await the rescan triggered by our own writes so the next
                //    queue entry (and completion detection) sees fresh state.
                const file = this.app.vault.getAbstractFileByPath(currentTask.file);
                if (file instanceof TFile) {
                    await this.taskIndex.requestScan(file);
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
    private async executeFlow(task: Task): Promise<boolean> {
        const program = task.flow?.program;
        if (!program) return false;

        let effects: FlowEffect[];
        try {
            effects = planFlow(task, program, this.buildDeps());
        } catch (err) {
            if (err instanceof EvalError) {
                // Runtime expression failure (e.g. unset property): do not
                // fire and do not consume — the command stays for the user
                // to fix, and the diagnostic explains why.
                logWarn(`[FlowExecutor] Flow did not fire for ${task.id}: ${err.message}`);
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

    private async applyEffect(task: Task, effect: FlowEffect): Promise<void> {
        switch (effect.kind) {
            case 'create-next': {
                const line = TaskParser.format(effect.newTask).trim();
                await this.repository.insertRecurrenceForTask(task, line, effect.copyChildren);
                return;
            }
            case 'archive-to': {
                const line = TaskParser.format(effect.archivedTask);
                await this.repository.appendTaskWithChildren(effect.destPath, line, task);
                return;
            }
            case 'strip-flow':
                await this.repository.updateTaskInFile(task, { ...task, flow: undefined });
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
        };
    }
}
