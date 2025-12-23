import { App, TFile, Vault } from 'obsidian';
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

    constructor(app: App) {
        this.app = app;
        this.repository = new TaskRepository(app);
        this.recurrenceManager = new RecurrenceManager(this.repository);
    }

    async initialize() {
        // Wait for layout to be ready before initial scan
        this.app.workspace.onLayoutReady(async () => {
            await this.scanVault();
        });

        this.app.vault.on('modify', async (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                await this.scanFile(file);
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

    private async scanVault() {
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            await this.scanFile(file);
        }
        this.notifyListeners();
    }

    private async scanFile(file: TFile) {
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

        // 2. Diff and Trigger Recurrence
        const tasksToTrigger: Task[] = [];

        for (const newTask of newTasks) {
            // Find existing task
            const oldTask = this.tasks.get(newTask.id); // Try ID match

            if (oldTask && oldTask.recurrence) {
                if (oldTask.status !== 'done' && newTask.status === 'done') {
                    tasksToTrigger.push(newTask);
                }
            }
        }

        // 3. Update Index
        // Clear old tasks for this file
        this.removeTasksForFile(file.path);

        // Add new tasks
        for (const task of newTasks) {
            this.tasks.set(task.id, task);
        }

        // 4. Execute Triggers
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

    async updateTask(taskId: string, updates: Partial<Task>) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return;
        }

        // Optimistic Update
        Object.assign(task, updates);
        this.notifyListeners(taskId, Object.keys(updates));

        // Delegate to Repository
        const updatedTask = { ...task, ...updates };
        await this.repository.updateTaskInFile(task, updatedTask);

        // Handle Recurrence (Optimistic Trigger?)
        // The repository update will trigger a file change event -> scanFile -> handleRecurrence.
        // However, if we want immediate feedback or if scanFile happens too late?
        // UI checkboxes feel better if we trigger recurrence immediately?
        // But doing it here AND in scanFile might cause duplicates if we are not careful.
        // Our RecurrenceManager logic is stateless, it just appends.
        // If we trigger here, the file changes. `scanFile` will read the NEW file which normally has the 'done' task.
        // But `scanFile` also checks `oldTask.status !== 'done'`.
        // If we updated `this.tasks` optimistically above, `scanFile` will see `oldTask.status` as `done`!
        // So `scanFile` diff check (`oldTask.status !== 'done'`) will FAIL (return false).
        // Therefore, `scanFile` will NOT trigger recurrence.
        // This effectively means we MUST trigger it manually here if we do optimistic updates.

        if (task.recurrence && updates.status === 'done') {
            await this.recurrenceManager.handleTaskCompletion(task);
        }
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
