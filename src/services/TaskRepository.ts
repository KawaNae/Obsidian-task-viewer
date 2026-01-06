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

            // 1. Get original task line from file
            const taskLine = lines[task.line];
            const taskIndent = taskLine.search(/\S|$/);

            // 2. Collect original children lines from file (with original indentation)
            const childrenLines: string[] = [];
            let j = task.line + 1;
            while (j < lines.length) {
                const nextLine = lines[j];
                const nextIndent = nextLine.search(/\S|$/);

                if (nextLine.trim() === '') {
                    childrenLines.push(nextLine);
                    j++;
                    continue;
                }

                if (nextIndent > taskIndent) {
                    childrenLines.push(nextLine);
                    j++;
                } else {
                    break;
                }
            }

            // 3. Strip block ID from task line and children: ^blockid at end of line
            const blockIdRegex = /\s\^[a-zA-Z0-9-]+$/;
            const newTaskLine = taskLine.replace(blockIdRegex, '');
            const newChildLines = childrenLines.map(child => child.replace(blockIdRegex, ''));

            const linesToInsert = [newTaskLine, ...newChildLines];

            // 4. Insert after the original block
            const insertIndex = task.line + 1 + childrenLines.length;

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

            // Get original task line and its indentation
            const taskLine = lines[task.line];
            const taskIndent = taskLine.search(/\S|$/);

            // Collect original children lines from file (with original indentation)
            const childrenLines: string[] = [];
            let j = task.line + 1;
            while (j < lines.length) {
                const nextLine = lines[j];
                const nextIndent = nextLine.search(/\S|$/);

                if (nextLine.trim() === '') {
                    childrenLines.push(nextLine);
                    j++;
                    continue;
                }

                if (nextIndent > taskIndent) {
                    childrenLines.push(nextLine);
                    j++;
                } else {
                    break;
                }
            }

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
                const originalIndent = taskLine.match(/^(\s*)/)?.[1] || '';

                // Strip block ID
                const cleanLine = (originalIndent + formattedLine.trim()).replace(blockIdRegex, '');
                allNewLines.push(cleanLine);

                // Add children without block IDs (from file, with original indentation)
                for (const child of childrenLines) {
                    allNewLines.push(child.replace(blockIdRegex, ''));
                }
            }

            // Insert after the original task block
            const insertIndex = task.line + 1 + childrenLines.length;
            lines.splice(insertIndex, 0, ...allNewLines);

            return lines.join('\n');
        });
    }

    async addTaskToDailyNote(fileDateStr: string, time: string, content: string, settings: TaskViewerSettings, taskDateStr?: string): Promise<void> {
        // Fix timezone offset issue
        const [y, m, d] = fileDateStr.split('-').map(Number);
        const date = new Date();
        date.setFullYear(y, m - 1, d);
        date.setHours(0, 0, 0, 0);

        // Use taskDateStr if provided, otherwise default to fileDateStr
        const targetDateStr = taskDateStr || fileDateStr;
        const taskLine = `- [ ] ${content} @${targetDateStr}T${time} `;

        await DailyNoteUtils.appendLineToDailyNote(
            this.app,
            date,
            taskLine,
            settings.dailyNoteHeader,
            settings.dailyNoteHeaderLevel
        );
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
