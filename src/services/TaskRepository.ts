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

    /**
     * Helper: Collect children lines from file content starting at taskLine
     * Returns { childrenLines, taskIndent }
     * Note: Empty/blank lines are NOT included as children
     */
    private collectChildrenFromLines(lines: string[], taskLineIndex: number): {
        childrenLines: string[];
        taskIndent: number;
    } {
        const taskLine = lines[taskLineIndex];
        const taskIndent = taskLine.search(/\S|$/);
        const childrenLines: string[] = [];

        let j = taskLineIndex + 1;
        while (j < lines.length) {
            const nextLine = lines[j];

            // Skip blank lines - they are NOT children
            if (nextLine.trim() === '') {
                break;
            }

            const nextIndent = nextLine.search(/\S|$/);
            if (nextIndent > taskIndent) {
                childrenLines.push(nextLine);
                j++;
            } else {
                break;
            }
        }

        return { childrenLines, taskIndent };
    }

    /**
     * Helper: Strip block IDs from lines
     */
    private stripBlockIds(lines: string[]): string[] {
        const blockIdRegex = /\s\^[a-zA-Z0-9-]+$/;
        return lines.map(line => line.replace(blockIdRegex, ''));
    }

    async updateTaskInFile(task: Task, updatedTask: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) {
            console.warn(`[TaskRepository] File not found: ${task.file}`);
            return;
        }

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find current line number using originalText (handles line shifts)
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                console.warn(`[TaskRepository] Task not found in file`);
                return content;
            }

            // Re-format line
            const newLine = TaskParser.format(updatedTask);
            console.log(`[TaskRepository] Updating line ${currentLine}: "${lines[currentLine]}" -> "${newLine}"`);

            // Preserve indentation if possible
            const originalIndent = lines[currentLine].match(/^(\s*)/)?.[1] || '';
            lines[currentLine] = originalIndent + newLine.trim();

            return lines.join('\n');
        });
    }

    async insertLineAfterTask(task: Task, lineContent: string): Promise<number> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return -1;

        let insertedLineIndex = -1;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find current line using originalText (handles line shifts)
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            // Use file-based calculation to get actual children count
            const { childrenLines } = this.collectChildrenFromLines(lines, currentLine);

            // Ignore trailing blank lines to avoid gaps
            let effectiveChildrenCount = childrenLines.length;
            for (let i = childrenLines.length - 1; i >= 0; i--) {
                if (childrenLines[i].trim() === '') {
                    effectiveChildrenCount--;
                } else {
                    break;
                }
            }

            const insertIndex = currentLine + 1 + effectiveChildrenCount;
            lines.splice(insertIndex, 0, lineContent);
            insertedLineIndex = insertIndex;

            return lines.join('\n');
        });

        return insertedLineIndex;
    }

    /**
     * Insert a line as the first child of a task (right after the task line).
     * Used for timer/pomodoro records that should appear at the top of children.
     */
    async insertLineAsFirstChild(task: Task, lineContent: string): Promise<number> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return -1;

        let insertedLineIndex = -1;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find the current line number using multiple strategies
            let currentLine = this.findTaskLineNumber(lines, task);

            if (currentLine < 0 || currentLine >= lines.length) return content;

            // Insert directly after the task line (as first child)
            const insertIndex = currentLine + 1;
            lines.splice(insertIndex, 0, lineContent);
            insertedLineIndex = insertIndex;

            return lines.join('\n');
        });

        return insertedLineIndex;
    }

    /**
     * Find the current line number of a task in the file.
     * Uses multiple strategies: exact match, content + date match, fallback to stored line.
     */
    private findTaskLineNumber(lines: string[], task: Task): number {
        // Strategy 1: Exact originalText match
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === task.originalText) {
                return i;
            }
        }

        // Strategy 2: Match by content and date notation (more resilient)
        // Build a pattern: contains task content AND @ date notation
        const escapedContent = task.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const datePattern = task.startDate ? `@${task.startDate}` : (task.deadline ? `@` : null);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Must be a task line (checkbox), contain the content, and match approx indent
            if (line.includes(`] ${task.content}`) || line.match(new RegExp(`\\]\\s+${escapedContent}`))) {
                // Verify it has similar characteristics
                if (datePattern && line.includes(datePattern)) {
                    return i;
                } else if (!datePattern && line.includes(task.content)) {
                    return i;
                }
            }
        }

        // Strategy 3: Fallback to stored line number
        return task.line;
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

            // Find current line using originalText
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            const { childrenLines } = this.collectChildrenFromLines(lines, currentLine);

            // Delete task line + all children
            lines.splice(currentLine, 1 + childrenLines.length);

            return lines.join('\n');
        });
    }

    async duplicateTaskInFile(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find current line using originalText
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            // 1. Get original task line and collect children
            const taskLine = lines[currentLine];
            const { childrenLines } = this.collectChildrenFromLines(lines, currentLine);

            // 2. Strip block IDs from task line and children
            const newTaskLine = this.stripBlockIds([taskLine])[0];
            const newChildLines = this.stripBlockIds(childrenLines);

            const linesToInsert = [newTaskLine, ...newChildLines];

            // 3. Insert after the original block
            const insertIndex = currentLine + 1 + childrenLines.length;
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

            // Find current line using originalText
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            // Get original task line and its indentation
            const taskLine = lines[currentLine];
            const taskIndent = taskLine.search(/\S|$/);

            // Collect original children lines from file (with original indentation)
            const childrenLines: string[] = [];
            let j = currentLine + 1;
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
            const insertIndex = currentLine + 1 + childrenLines.length;
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

    async insertRecurrenceForTask(task: Task, content: string, newTask?: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (fileContent) => {
            const lines = fileContent.split('\n');

            // Find current line using originalText
            const currentLine = this.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return fileContent;

            // 1. Get indent and collect children
            const originalIndent = lines[currentLine].match(/^(\s*)/)?.[1] || '';
            const { childrenLines } = this.collectChildrenFromLines(lines, currentLine);

            // 2. Strip block IDs from children
            const newChildLines = this.stripBlockIds(childrenLines);

            // 3. Build lines to insert: new task line + children
            const nextLine = originalIndent + content;
            const linesToInsert = [nextLine, ...newChildLines];

            // 4. Insert after the original block
            const insertIndex = currentLine + 1 + childrenLines.length;
            lines.splice(insertIndex, 0, ...linesToInsert);

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

    /**
     * Append task with children to file (for move command)
     * Reads children from the original file and appends them together
     * Adjusts children indentation relative to new parent position
     */
    async appendTaskWithChildren(destPath: string, content: string, task: Task): Promise<void> {
        // 1. Read children from original file
        const sourceFile = this.app.vault.getAbstractFileByPath(task.file);
        let childrenLines: string[] = [];
        let parentIndent = 0;

        if (sourceFile instanceof TFile) {
            const sourceContent = await this.app.vault.read(sourceFile);
            const lines = sourceContent.split('\n');

            // Find current line using originalText
            const currentLine = this.findTaskLineNumber(lines, task);

            if (currentLine >= 0 && currentLine < lines.length) {
                // Get parent's original indentation
                const parentLine = lines[currentLine];
                parentIndent = parentLine.search(/\S|$/);

                const result = this.collectChildrenFromLines(lines, currentLine);
                childrenLines = result.childrenLines;
            }
        }

        // 2. Strip block IDs from children
        const cleanedChildren = this.stripBlockIds(childrenLines);

        // 3. Adjust children indentation relative to parent
        // Remove parent's indentation amount, keep only relative indent
        const adjustedChildren = cleanedChildren.map(line => {
            if (line.trim() === '') return line; // Keep empty lines as-is
            const currentIndent = line.search(/\S|$/);
            const relativeIndent = Math.max(0, currentIndent - parentIndent);
            // Use tabs for the relative indentation
            return '\t'.repeat(relativeIndent / (line.includes('\t') ? 1 : 4)) + line.trimStart();
        });

        // 4. Build full content to append
        const fullContent = [content, ...adjustedChildren].join('\n');

        // 5. Append to destination file
        await this.appendTaskToFile(destPath, fullContent);
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
