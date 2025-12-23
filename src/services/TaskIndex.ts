import { App, TFile, Vault } from 'obsidian';
import { Task } from '../types';
import { TaskParser } from './TaskParser';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { RecurrenceUtils } from '../utils/RecurrenceUtils';
import { DateUtils } from '../utils/DateUtils';
import { TaskViewerSettings } from '../types';

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

        this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.removeTasksForFile(file.path);
                this.notifyListeners();
            }
        });

        this.app.metadataCache.on('changed', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // Metadata changed (e.g. frontmatter), notify listeners to re-render
                // We don't necessarily need to re-scan the file content if only frontmatter changed,
                // but re-rendering views is necessary to pick up new colors.
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
            // Since we are scanning a file modification, user might have just changed status or text.
            // ID is "filepath:linenumber". 
            // If user inserts a line above, all IDs shift. This logic fails in that specific case.
            // But for in-place editing (checking a box), IDs remain stable.
            const oldTask = this.tasks.get(newTask.id); // Try ID match

            // TODO: Fallback to fuzzy match or content match if ID shifts?
            // For V1, assume stable lines for completion.

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
            // We need to be careful. Calling handleRecurrence writes to file, triggering another scanFile.
            // But we already updated this.tasks with 'done' status. 
            // So next scanFile will see 'done' -> 'done', so no trigger. Safe.

            // Execute sequentially to avoid race conditions on file write?
            // vault.process is atomic, but maybe better to do one by one.
            for (const task of tasksToTrigger) {
                await this.handleRecurrence(task);
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

            // Handle Recurrence
            if (task.recurrence && updates.status === 'done') {
                // Let's extract the Line Generation logic.
                const nextLine = this.generateNextRecurrenceLine(task, originalIndent);
                if (nextLine) {
                    // Insert after children, but effectively ignoring trailing blank lines to avoid gaps.
                    let effectiveChildrenCount = task.children ? task.children.length : 0;
                    if (task.children) {
                        for (let i = task.children.length - 1; i >= 0; i--) {
                            if (task.children[i].trim() === '') {
                                effectiveChildrenCount--;
                            } else {
                                break;
                            }
                        }
                    }

                    const insertIndex = task.line + 1 + effectiveChildrenCount;
                    lines.splice(insertIndex, 0, nextLine);
                }
            }

            return lines.join('\n');
        });
    }

    private generateNextRecurrenceLine(task: Task, indent: string): string | null {
        // Base Date Logic
        let baseDateObj: Date;
        if (task.date) {
            const [y, m, d] = task.date.split('-').map(Number);
            baseDateObj = new Date(y, m - 1, d);
        } else {
            baseDateObj = new Date();
            baseDateObj.setHours(0, 0, 0, 0);
        }

        const nextDateObj = RecurrenceUtils.calculateNextDate(baseDateObj, task.recurrence!);
        const nextDateStr = DateUtils.getLocalDateString(nextDateObj);

        // Reset status to todo
        const newTask: Task = {
            ...task,
            id: '',
            status: 'todo',
            statusChar: ' ',
            date: nextDateStr,
            originalText: '',
            children: []
        };

        const nextLine = TaskParser.format(newTask);
        return indent + nextLine.trim();
    }

    // New helper to perform the write transaction for recurrence (used by file scan)
    private async handleRecurrence(task: Task) {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            // We need to find the line again because it might have moved if we are async?
            // Actually, handleRecurrence is called from scanFile while consistent?
            // No, scanFile reads content, detects diff. But file on disk is same.
            // But we have task.line.
            // Let's trust task.line for now, but verify content?
            // If the line at task.line doesn't match task.originalText, we might be in trouble.
            // But strict matching is hard because task.originalText might be 'todo' but now it's 'done'.

            // Just use task.line. 
            // In scanFile context, task.line comes from the RECENT scan. So it is accurate.

            if (lines.length <= task.line) return content;

            const originalIndent = lines[task.line].match(/^(\s*)/)?.[1] || '';
            const nextLine = this.generateNextRecurrenceLine(task, originalIndent);

            if (nextLine) {
                // Insert after children, but effectively ignoring trailing blank lines to avoid gaps.
                // However, task.children INCLUDES blank lines.
                // If we want to insert immediately after the visual "block", we should traverse backwards.
                let effectiveChildrenCount = task.children ? task.children.length : 0;
                if (task.children) {
                    for (let i = task.children.length - 1; i >= 0; i--) {
                        if (task.children[i].trim() === '') {
                            effectiveChildrenCount--;
                        } else {
                            break;
                        }
                    }
                }

                const insertIndex = task.line + 1 + effectiveChildrenCount;
                lines.splice(insertIndex, 0, nextLine);
            }

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

    async addTaskToDailyNote(fileDateStr: string, time: string, content: string, settings: TaskViewerSettings, taskDateStr?: string) {
        const date = new Date(fileDateStr);
        // Fix timezone offset issue when creating date from YYYY-MM-DD string
        // We want the local date corresponding to that string
        const [y, m, d] = fileDateStr.split('-').map(Number);
        date.setFullYear(y, m - 1, d);
        date.setHours(0, 0, 0, 0);

        let file = DailyNoteUtils.getDailyNote(this.app, date);
        if (!file) {
            file = await DailyNoteUtils.createDailyNote(this.app, date);
        }

        if (!file) return;

        // Use taskDateStr if provided, otherwise default to fileDateStr
        const targetDateStr = taskDateStr || fileDateStr;

        await this.app.vault.process(file, (fileContent) => {
            const lines = fileContent.split('\n');
            const header = settings.dailyNoteHeader;
            const level = settings.dailyNoteHeaderLevel;
            const headerPrefix = '#'.repeat(level) + ' ';
            const fullHeader = headerPrefix + header;

            let headerIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === fullHeader) {
                    headerIndex = i;
                    break;
                }
            }

            const taskLine = `- [ ] ${content} @${targetDateStr}T${time} `;

            if (headerIndex !== -1) {
                // Header exists, append after it (and any existing content under it)
                // Find end of section
                let insertIndex = headerIndex + 1;

                // Advance past content
                while (insertIndex < lines.length) {
                    const line = lines[insertIndex];
                    // Stop at next header of same or higher level
                    if (line.startsWith('#')) {
                        const match = line.match(/^(#+)\s/);
                        if (match && match[1].length <= level) {
                            break;
                        }
                    }
                    insertIndex++;
                }

                // If we are at the end of a section, we might be sitting on the start of the next section (the header line)
                // or end of file.
                // We want to insert *before* any trailing blank lines that separate this section from the next.
                // Scan backwards from insertIndex-1
                let effectiveInsertIndex = insertIndex;
                while (effectiveInsertIndex > headerIndex + 1) {
                    const prevLine = lines[effectiveInsertIndex - 1];
                    if (prevLine.trim() === '') {
                        effectiveInsertIndex--;
                    } else {
                        break;
                    }
                }

                lines.splice(effectiveInsertIndex, 0, taskLine);
            } else {
                // Header doesn't exist, append to end
                if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
                    lines.push('');
                }
                lines.push(fullHeader);
                lines.push(taskLine);
            }

            return lines.join('\n');
        });
    }
}
