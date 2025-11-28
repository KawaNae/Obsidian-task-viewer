import { App, TFile, Vault } from 'obsidian';
import { Task } from '../types';
import { TaskParser } from './TaskParser';

export class TaskIndex {
    private app: App;
    private tasks: Map<string, Task> = new Map(); // ID -> Task
    private listeners: ((taskId?: string, changes?: string[]) => void)[] = [];

    constructor(app: App) {
        this.app = app;
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

        // Remove old tasks for this file
        for (const [id, task] of this.tasks) {
            if (task.file === file.path) {
                this.tasks.delete(id);
            }
        }

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
                this.tasks.set(task.id, task);

                // Skip consumed lines
                i = j - 1;
            }
        }
    }

    async updateTask(taskId: string, updates: Partial<Task>) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        // Optimistic Update
        Object.assign(task, updates);
        this.notifyListeners(taskId, Object.keys(updates));

        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lines.length <= task.line) return content;

            // Merge updates
            const updatedTask = { ...task, ...updates };

            // Re-format line
            const newLine = TaskParser.format(updatedTask);

            // Preserve indentation if possible
            const originalIndent = lines[task.line].match(/^(\s*)/)?.[1] || '';
            lines[task.line] = originalIndent + newLine.trim();

            return lines.join('\n');
        });
    }

    async updateLine(filePath: string, lineNumber: number, newContent: string) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lines.length <= lineNumber) return content;

            lines[lineNumber] = newContent;

            return lines.join('\n');
        });
    }

    async deleteTask(taskId: string) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        // Optimistic Update
        this.tasks.delete(taskId);
        this.notifyListeners();

        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lines.length <= task.line) return content;

            lines.splice(task.line, 1);

            return lines.join('\n');
        });
    }

    async duplicateTask(taskId: string) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lines.length <= task.line) return content;

            // 1. Get original lines (task + children)
            const taskLine = lines[task.line];

            // 2. Prepare new lines
            // Strip block ID from task line: ^blockid at end of line
            const blockIdRegex = /\s\^[a-zA-Z0-9-]+$/;
            const newTaskLine = taskLine.replace(blockIdRegex, '');

            const newChildLines = task.children.map(child => child.replace(blockIdRegex, ''));

            const linesToInsert = [newTaskLine, ...newChildLines];

            // 3. Insert after the original block
            // The original block ends at task.line + task.children.length
            const insertIndex = task.line + 1 + task.children.length;

            lines.splice(insertIndex, 0, ...linesToInsert);

            return lines.join('\n');
        });
    }
}
