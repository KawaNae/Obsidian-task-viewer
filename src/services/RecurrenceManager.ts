import { App, TFile } from 'obsidian';
import { Task } from '../types';
import { TaskRepository } from './TaskRepository';
import { TaskIndex } from './TaskIndex';
import { CommandStrategy } from '../commands/CommandStrategy';
import { MoveCommand } from '../commands/MoveCommand';
import { RepeatCommand, NextCommand } from '../commands/GenerationCommands';

export class RecurrenceManager {
    private repository: TaskRepository;
    private strategies: Map<string, CommandStrategy> = new Map();
    private taskQueue: Task[] = [];
    private isProcessing = false;
    private taskIndex: TaskIndex;

    private app: App;

    constructor(repository: TaskRepository, taskIndex: TaskIndex, app: App) {
        this.repository = repository;
        this.taskIndex = taskIndex;
        this.app = app;
        this.registerStrategies();
    }

    private registerStrategies() {
        const strategies: CommandStrategy[] = [
            new MoveCommand(),
            new RepeatCommand(),
            new NextCommand()
        ];

        for (const s of strategies) {
            this.strategies.set(s.name, s);
        }
    }

    async handleTaskCompletion(task: Task): Promise<void> {
        // Support Flow Syntax only
        const hasCommands = !!(task.commands && task.commands.length > 0);

        if (!hasCommands) return;

        // Trigger for Done, Cancelled, or Important (!)
        const isTriggerable = task.status === 'done' || task.status === 'cancelled' || task.statusChar === '!';
        if (!isTriggerable) return;

        this.taskQueue.push(task);

        // Trigger processing (fire and forget)
        this.processQueue();
    }

    private async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            while (this.taskQueue.length > 0) {
                const originalTask = this.taskQueue[0]; // Peek

                // 1. Wait for any pending file scans (file state re-acquisition)
                if (this.taskIndex.waitForScan) {
                    await this.taskIndex.waitForScan(originalTask.file);
                }

                // 2. Resolve Task (ensure we have the latest line number)
                let currentTask: Task | undefined = originalTask;
                if (this.taskIndex.resolveTask) {
                    currentTask = this.taskIndex.resolveTask(originalTask);
                }

                if (!currentTask) {
                    console.warn(`[RecurrenceManager] Task ${originalTask.id} no longer found or resolvable. Skipping.`);
                    this.taskQueue.shift(); // Remove
                    continue;
                }

                // 3. Execute Strategies
                // Check if still effectively "done" (triggerable)
                const isTriggerable = currentTask.status === 'done' || currentTask.status === 'cancelled' || currentTask.statusChar === '!';
                if (!isTriggerable) {
                    // Maybe it was unchecked?
                    this.taskQueue.shift();
                    continue;
                }

                try {
                    await this.executeTaskCommands(currentTask);
                } catch (err) {
                    console.error(`[RecurrenceManager] Error processing task ${currentTask.id}:`, err);
                }

                // 4. Remove from queue AFTER processing
                this.taskQueue.shift();

                // 5. Wait for the file update triggered by execution to be acknowledged by TaskIndex?
                // The executeTaskCommands calls repository, which writes file.
                // This triggers 'modify' event -> TaskIndex.queueScan.
                // We should theoretically wait for THAT scan to finish before next loop.
                // Let's verify scan promise again.
                if (this.taskIndex.requestScan) {
                    // Explicitly request a scan to ensure index is up-to-date
                    // We need to resolve the file from path string
                    const file = this.app.vault.getAbstractFileByPath(currentTask.file);

                    if (file instanceof TFile) {
                        await this.taskIndex.requestScan(file);
                        // requestScan returns the promise of the scan, so awaiting it ensures sequentiality
                    }
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    private async executeTaskCommands(task: Task): Promise<void> {
        if (!task.commands) return;

        let shouldDeleteOriginal = false;

        const context = {
            repository: this.repository,
            task: task
        };

        for (const cmd of task.commands) {
            const strategy = this.strategies.get(cmd.name);
            if (strategy) {
                const result = await strategy.execute(context, cmd);
                if (result.shouldDeleteOriginal) {
                    shouldDeleteOriginal = true;
                }
            } else {
                console.warn(`[RecurrenceManager] Unknown command: ${cmd.name}`);
            }
        }

        if (shouldDeleteOriginal) {
            await this.repository.deleteTaskFromFile(task);
        }
    }
}
