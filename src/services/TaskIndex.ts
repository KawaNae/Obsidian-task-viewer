import { App, TFile, Vault } from 'obsidian';
import { Task } from '../types';
import { TaskParser } from './TaskParser';

export class TaskIndex {
    private app: App;
    private tasks: Map<string, Task> = new Map(); // ID -> Task
    private listeners: (() => void)[] = [];

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

    getTasksForDate(date: string): Task[] {
        return this.getTasks().filter(t => t.date === date);
    }

    onChange(callback: () => void): () => void {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(cb => cb());
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
}
