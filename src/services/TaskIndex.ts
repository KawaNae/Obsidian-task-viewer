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
        console.log('TaskIndex: Initializing...');

        // Wait for layout to be ready before initial scan
        this.app.workspace.onLayoutReady(async () => {
            console.log('TaskIndex: Layout ready, scanning vault...');
            await this.scanVault();
        });

        this.app.vault.on('modify', async (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                console.log(`TaskIndex: File modified ${file.path}`);
                await this.scanFile(file);
                this.notifyListeners();
            }
        });
        console.log('TaskIndex: Initialization complete.');
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
        console.log(`TaskIndex: Scanning ${files.length} files in vault.`);
        for (const file of files) {
            await this.scanFile(file);
        }
        console.log(`TaskIndex: Vault scan complete. Found ${this.tasks.size} tasks.`);
        this.notifyListeners();
    }

    private async scanFile(file: TFile) {
        // console.log(`TaskIndex: Scanning file ${file.path}`);
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

                    // Stop if line is not indented more than parent (and not empty)
                    // We treat empty lines as part of the block if they are followed by indented lines?
                    // For simplicity, let's stop at same or less indentation if not empty.
                    // If empty, we include it?

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

            // Preserve indentation if possible (TaskParser.format doesn't handle it yet, 
            // but we can grab it from original line)
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
