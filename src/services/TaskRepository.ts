import { App, TFile, TFolder } from 'obsidian';
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
        if (!(file instanceof TFile)) {
            console.warn(`[TaskRepository] File not found: ${task.file}`);
            return;
        }

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lines.length <= task.line) {
                console.warn(`[TaskRepository] Line ${task.line} out of bounds (file has ${lines.length} lines)`);
                return content;
            }

            // Re-format line
            const newLine = TaskParser.format(updatedTask);
            console.log(`[TaskRepository] Updating line ${task.line}: "${lines[task.line]}" -> "${newLine}"`);

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

            // Preserve original indentation
            const originalLine = lines[lineNumber];
            const originalIndent = originalLine.match(/^(\s*)/)?.[1] || '';
            const newContentTrimmed = newContent.trimStart();

            lines[lineNumber] = originalIndent + newContentTrimmed;

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

    /**
     * タスクを1週間分（7日間）複製。各タスクの日付を1日ずつシフト
     * @param task 複製元タスク
     */
    async duplicateTaskForWeek(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        // Import needed inside method to avoid circular dependencies
        const { DateUtils } = await import('../utils/DateUtils');

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lines.length <= task.line) return content;

            const blockIdRegex = /\s\^[a-zA-Z0-9-]+$/;
            const allNewLines: string[] = [];

            // Generate 7 copies with shifted dates (1 day, 2 days, ..., 7 days)
            for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
                // Create shifted task
                const shiftedTask: Task = {
                    ...task,
                    startDate: task.startDate ? DateUtils.shiftDateString(task.startDate, dayOffset) : undefined,
                    endDate: task.endDate ? DateUtils.shiftDateString(task.endDate, dayOffset) : undefined,
                    deadline: task.deadline ? DateUtils.shiftDateString(task.deadline, dayOffset) : undefined,
                };

                // Format the shifted task
                const formattedLine = TaskParser.format(shiftedTask);

                // Preserve original indentation
                const originalIndent = lines[task.line].match(/^(\s*)/)?.[1] || '';

                // Strip block ID
                const cleanLine = (originalIndent + formattedLine.trim()).replace(blockIdRegex, '');
                allNewLines.push(cleanLine);

                // Add children without block IDs
                for (const child of task.children) {
                    allNewLines.push(child.replace(blockIdRegex, ''));
                }
            }

            // Insert after the original task block
            const insertIndex = task.line + 1 + task.children.length;
            lines.splice(insertIndex, 0, ...allNewLines);

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

            return lines.join('\n');
        });
    }

    async appendTaskToFile(filePath: string, content: string): Promise<void> {
        let file = this.app.vault.getAbstractFileByPath(filePath);

        if (!file) {
            // Ensure directory exists
            await this.ensureDirectoryExists(filePath);

            // Create file if it doesn't exist
            await this.app.vault.create(filePath, content);
            return;
        }

        if (file instanceof TFile) {
            await this.app.vault.process(file, (fileContent) => {
                // Ensure starts with newline if file not empty
                const prefix = fileContent.length > 0 && !fileContent.endsWith('\n') ? '\n' : '';
                return fileContent + prefix + content;
            });
        }
    }

    private async ensureDirectoryExists(filePath: string): Promise<void> {
        const lastSlashIndex = filePath.lastIndexOf('/');
        if (lastSlashIndex === -1) return; // Rooy directory

        const folderPath = filePath.substring(0, lastSlashIndex);
        if (this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder) {
            return;
        }

        // Recursive creation
        const folders = folderPath.split('/');
        let currentPath = '';
        for (const segment of folders) {
            currentPath = currentPath === '' ? segment : `${currentPath}/${segment}`;
            const existing = this.app.vault.getAbstractFileByPath(currentPath);
            if (!existing) {
                try {
                    await this.app.vault.createFolder(currentPath);
                } catch (error) {
                    // Ignore "Folder already exists" error
                    if (error.message && error.message.includes('Folder already exists')) {
                        continue;
                    }
                    throw error;
                }
            }
        }
    }
}
