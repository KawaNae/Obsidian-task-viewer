import { App, TFile } from 'obsidian';
import { Task } from '../types';
import { TaskParser } from './TaskParser';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { TaskViewerSettings } from '../types';

export class TaskRepository {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    async updateTaskInFile(task: Task, updatedTask: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lines.length <= task.line) return content;

            // Re-format line
            const newLine = TaskParser.format(updatedTask);

            // Preserve indentation if possible
            const originalIndent = lines[task.line].match(/^(\s*)/)?.[1] || '';
            lines[task.line] = originalIndent + newLine.trim();

            return lines.join('\n');
        });
    }

    async insertLineAfterTask(task: Task, lineContent: string): Promise<number> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return -1;

        let insertedLineIndex = -1;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lines.length <= task.line) return content;

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
            lines.splice(insertIndex, 0, lineContent);
            insertedLineIndex = insertIndex;

            return lines.join('\n');
        });

        return insertedLineIndex;
    }

    async updateLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lines.length <= lineNumber) return content;

            lines[lineNumber] = newContent;

            return lines.join('\n');
        });
    }

    async deleteTaskFromFile(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lines.length <= task.line) return content;

            lines.splice(task.line, 1);

            return lines.join('\n');
        });
    }

    async duplicateTaskInFile(task: Task): Promise<void> {
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
            const insertIndex = task.line + 1 + task.children.length;

            lines.splice(insertIndex, 0, ...linesToInsert);

            return lines.join('\n');
        });
    }

    async addTaskToDailyNote(fileDateStr: string, time: string, content: string, settings: TaskViewerSettings, taskDateStr?: string): Promise<void> {
        const date = new Date(fileDateStr);
        // Fix timezone offset issue
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
                // Header exists
                let insertIndex = headerIndex + 1;

                // Advance past content
                while (insertIndex < lines.length) {
                    const line = lines[insertIndex];
                    if (line.startsWith('#')) {
                        const match = line.match(/^(#+)\s/);
                        if (match && match[1].length <= level) {
                            break;
                        }
                    }
                    insertIndex++;
                }

                // Scan backwards to skip trailing blank lines
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
                // Header doesn't exist
                if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
                    lines.push('');
                }
                lines.push(fullHeader);
                lines.push(taskLine);
            }

            return lines.join('\n');
        });
    }

    async insertRecurrenceForTask(task: Task, content: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (fileContent) => {
            const lines = fileContent.split('\n');
            if (lines.length <= task.line) return fileContent;

            // 1. Get indent from original task
            const originalIndent = lines[task.line].match(/^(\s*)/)?.[1] || '';
            const nextLine = originalIndent + content;

            // 2. Insert using gap-skip logic
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
            console.log(`[TaskRepository] Inserted recurrence task at line ${insertIndex}`);

            return lines.join('\n');
        });
    }
}
