import { App, TFile } from 'obsidian';
import { Task } from '../types';
import { TaskParser } from './TaskParser';
import { TaskViewerSettings } from '../types';
import { TaskRepository } from './TaskRepository';
import { RecurrenceManager } from './RecurrenceManager';

export class TaskIndex {
    private app: App;
    private tasks: Map<string, Task> = new Map(); // ID -> Task
    private listeners: ((taskId?: string, changes?: string[]) => void)[] = [];

    // Services
    private repository: TaskRepository;
    private recurrenceManager: RecurrenceManager;
    private isInitializing = true;

    async initialize() {
        this.isInitializing = true;
        // Wait for layout to be ready before initial scan
        this.app.workspace.onLayoutReady(async () => {
            await this.scanVault();
            this.isInitializing = false;
        });

        this.app.vault.on('modify', async (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                await this.queueScan(file);
                this.notifyListeners();
            }
        });

        this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.removeTasksForFile(file.path);
                this.notifyListeners();
            }
        });

        this.app.metadataCache.on('changed', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // Metadata changed (e.g. frontmatter), notify listeners to re-render
                this.notifyListeners();
            }
        });
    }

    constructor(app: App) {
        this.app = app;
        this.repository = new TaskRepository(app);
        this.recurrenceManager = new RecurrenceManager(this.repository, this, this.app);
    }


    getTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    getTask(taskId: string): Task | undefined {
        return this.tasks.get(taskId);
    }

    getTasksForDate(date: string): Task[] {
        return this.getTasks().filter(t => t.date === date);
    }

    getTasksForVisualDay(visualDate: string, startHour: number): Task[] {
        // 1. Tasks from visualDate (startHour to 23:59)
        const currentDayTasks = this.getTasksForDate(visualDate).filter(t => {
            if (!t.startTime) return true; // All-day tasks belong to the date
            const [h] = t.startTime.split(':').map(Number);
            return h >= startHour;
        });

        // 2. Tasks from nextDay (00:00 to startHour - 1 min)
        const nextDate = new Date(visualDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0];

        const nextDayTasks = this.getTasksForDate(nextDateStr).filter(t => {
            if (!t.startTime) return false; // All-day tasks of next day don't belong here
            const [h] = t.startTime.split(':').map(Number);
            return h < startHour;
        });

        return [...currentDayTasks, ...nextDayTasks];
    }

    onChange(callback: (taskId?: string, changes?: string[]) => void): () => void {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    private notifyListeners(taskId?: string, changes?: string[]) {
        this.listeners.forEach(cb => cb(taskId, changes));
    }

    private scanQueue: Map<string, Promise<void>> = new Map();
    private processedCompletions: Map<string, number> = new Map(); // "file|date|content" -> count
    private visitedFiles = new Set<string>();

    private getTaskSignature(task: Task): string {
        const cmdSig = task.commands ? task.commands.map(c => `${c.name}(${c.args.join(',')})`).join('') : '';
        return `${task.file}|${task.date || 'no-date'}|${task.content}|${cmdSig}`;
    }

    private async scanVault() {
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            await this.queueScan(file);
        }
        this.notifyListeners();
        // Fallback: Ensure isInitializing is false after explicit vault scan, 
        // though onLayoutReady handles it too.
        this.isInitializing = false;
    }

    public async requestScan(file: TFile): Promise<void> {
        return this.queueScan(file);
    }

    private async queueScan(file: TFile): Promise<void> {
        // Simple queue mechanism: chain promises per file path
        const previousScan = this.scanQueue.get(file.path) || Promise.resolve();

        const currentScan = previousScan.then(async () => {
            try {
                await this.scanFile(file);
            } catch (error) {
                console.error(`Error scanning file ${file.path}:`, error);
            }
        });

        this.scanQueue.set(file.path, currentScan);
        return currentScan;
    }

    private async scanFile(file: TFile) {
        // Double check: if layout is not ready, maybe skip? But queue handles ordering.
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');

        // 1. Parse all new tasks first
        const newTasks: Task[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const task = TaskParser.parse(line, file.path, i);

            if (task) {
                // Look ahead for children
                const children: string[] = [];
                let j = i + 1;
                const taskIndent = line.search(/\S|$/); // Index of first non-whitespace

                while (j < lines.length) {
                    const nextLine = lines[j];
                    const nextIndent = nextLine.search(/\S|$/);

                    if (nextLine.trim() === '') {
                        children.push(nextLine);
                        j++;
                        continue;
                    }

                    if (nextIndent > taskIndent) {
                        children.push(nextLine);
                        j++;
                    } else {
                        break;
                    }
                }

                task.children = children;
                newTasks.push(task);

                // Skip consumed lines
                i = j - 1;
            }
        }

        // 2. Count Current Completions
        const currentCounts = new Map<string, number>();
        const doneTasks: Task[] = [];

        for (const task of newTasks) {
            // Check extended triggerable status (x, X, -, !)
            if (TaskParser.isTriggerableStatus(task) && task.commands && task.commands.length > 0) {
                const sig = this.getTaskSignature(task);
                currentCounts.set(sig, (currentCounts.get(sig) || 0) + 1);
                doneTasks.push(task);
            }
        }

        // 3. Diff and Trigger
        const tasksToTrigger: Task[] = [];
        const checkedSignatures = new Set<string>();

        let isFirstScan = false;
        if (!this.visitedFiles.has(file.path)) {
            this.visitedFiles.add(file.path);
            isFirstScan = true;
        }

        for (const task of doneTasks) {
            const sig = this.getTaskSignature(task);
            if (checkedSignatures.has(sig)) continue; // Process each unique signature once per scan
            checkedSignatures.add(sig);

            const currentCount = currentCounts.get(sig) || 0;
            const previousCount = this.processedCompletions.get(sig) || 0;

            if (currentCount > previousCount) {
                // Number of done tasks increased! Trigger recurrence for the *difference*
                const diff = currentCount - previousCount;

                // Only trigger if NOT initializing AND NOT the first scan of this file
                if (!this.isInitializing && !isFirstScan) {
                    for (let k = 0; k < diff; k++) {
                        tasksToTrigger.push(task);
                    }
                }
            }
        }

        // 4. Update Memory
        // Filter out entries for this file from processedCompletions
        const prefix = `${file.path}|`;
        for (const key of this.processedCompletions.keys()) {
            if (key.startsWith(prefix)) {
                this.processedCompletions.delete(key);
            }
        }

        // Add new counts
        for (const [sig, count] of currentCounts) {
            this.processedCompletions.set(sig, count);
        }

        // 5. Update Index
        // Clear old tasks for this file
        this.removeTasksForFile(file.path);

        // Add new tasks
        for (const task of newTasks) {
            this.tasks.set(task.id, task);
        }

        // 6. Execute Triggers
        if (tasksToTrigger.length > 0) {
            for (const task of tasksToTrigger) {
                await this.recurrenceManager.handleTaskCompletion(task);
            }
        }
    }

    private removeTasksForFile(filePath: string) {
        for (const [id, task] of this.tasks) {
            if (task.file === filePath) {
                this.tasks.delete(id);
            }
        }
    }

    async waitForScan(filePath: string): Promise<void> {
        const promise = this.scanQueue.get(filePath);
        if (promise) {
            await promise;
        }
    }

    resolveTask(originalTask: Task): Task | undefined {
        // Try to find the task in the current index
        // 1. By ID (if stable or lucky)
        let found = this.tasks.get(originalTask.id);
        if (found &&
            found.content === originalTask.content &&
            found.file === originalTask.file &&
            found.line === originalTask.line &&
            found.date === originalTask.date // Strict date check to prevent swapping identical tasks
        ) {
            return found;
        }

        // 2. By Signature (File + Content)
        for (const t of this.tasks.values()) {
            if (t.file === originalTask.file && t.content === originalTask.content) {
                // Heuristic: Status should match the *completed* status?
                // When we queue, status is 'done'. Index should have 'done' too.
                // But check date too if possible.
                if (t.date === originalTask.date) {
                    return t;
                }
            }
        }

        return undefined;
    }

    async updateTask(taskId: string, updates: Partial<Task>) {
        console.log(`[TaskIndex] updateTask called for ${taskId}`, updates);
        const task = this.tasks.get(taskId);
        if (!task) {
            console.warn(`[TaskIndex] Task ${taskId} not found in index`);
            return;
        }

        // Optimistic Update
        // If we are unchecking a task, we must eagerly decrement the processed count.
        // "Unchecking": Transitioning from Triggerable -> Not Triggerable (Todo)

        // Note: TaskParser.isTriggerableStatus checks the *current* task state (before update is applied to object fully?)
        // Wait, `task` object is referencing the one in `this.tasks`. `updates` are partial.
        // We need to check if it *was* triggerable before updates.
        const wasTriggerable = TaskParser.isTriggerableStatus(task);

        // Assuming updates.status is 'todo' means uncheck. 
        const willBeTodo = updates.status === 'todo';

        if (wasTriggerable && willBeTodo) {
            const sig = this.getTaskSignature(task);
            const currentCount = this.processedCompletions.get(sig) || 0;
            if (currentCount > 0) {
                this.processedCompletions.set(sig, currentCount - 1);
                console.log(`[TaskIndex] Optimistic decrement for "${sig}" -> ${currentCount - 1}`);
            }
        }

        Object.assign(task, updates);
        this.notifyListeners(taskId, Object.keys(updates));

        // Delegate to Repository
        const updatedTask = { ...task, ...updates };
        await this.repository.updateTaskInFile(task, updatedTask);
    }
    async updateLine(filePath: string, lineNumber: number, newContent: string) {
        await this.repository.updateLine(filePath, lineNumber, newContent);
    }

    async deleteTask(taskId: string) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        // Optimistic Update
        this.tasks.delete(taskId);
        this.notifyListeners();

        await this.repository.deleteTaskFromFile(task);
    }

    async duplicateTask(taskId: string) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        await this.repository.duplicateTaskInFile(task);
    }

    async addTaskToDailyNote(fileDateStr: string, time: string, content: string, settings: TaskViewerSettings, taskDateStr?: string) {
        await this.repository.addTaskToDailyNote(fileDateStr, time, content, settings, taskDateStr);
    }
}
