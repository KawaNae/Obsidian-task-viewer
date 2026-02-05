import { App, TFile } from 'obsidian';
import type { Task } from '../../../types';
import { TaskParser } from '../../TaskParser';
import { FileOperations } from '../utils/FileOperations';


/**
 * インラインタスクの書き込み操作を担当するクラス
 * タスク行の更新、削除、挿入などのCRUD操作を提供
 */
export class InlineTaskWriter {
    constructor(
        private app: App,
        private fileOps: FileOperations
    ) { }

    async updateTaskInFile(task: Task, updatedTask: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) {
            console.warn(`[InlineTaskWriter] File not found: ${task.file}`);
            return;
        }

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');

            // Find current line number using originalText (handles line shifts)
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                console.warn(`[InlineTaskWriter] Task not found in file`);
                return content;
            }

            // Re-format line
            const newLine = TaskParser.format(updatedTask);
            console.log(`[InlineTaskWriter] Updating line ${currentLine}: "${lines[currentLine]}" -> "${newLine}"`);

            // Preserve indentation if possible
            const originalIndent = lines[currentLine].match(/^(\s*)/)?.[1] || '';
            lines[currentLine] = originalIndent + newLine.trim();

            return lines.join('\n');
        });
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
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);

            // Delete task line + all children
            lines.splice(currentLine, 1 + childrenLines.length);

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
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return content;

            // Use file-based calculation to get actual children count
            const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);

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
            let currentLine = this.fileOps.findTaskLineNumber(lines, task);

            if (currentLine < 0 || currentLine >= lines.length) return content;

            // Insert directly after the task line (as first child)
            const insertIndex = currentLine + 1;
            lines.splice(insertIndex, 0, lineContent);
            insertedLineIndex = insertIndex;

            return lines.join('\n');
        });

        return insertedLineIndex;
    }

    async appendTaskToFile(filePath: string, content: string): Promise<void> {
        let file = this.app.vault.getAbstractFileByPath(filePath);

        if (!file) {
            // Ensure directory exists
            await this.fileOps.ensureDirectoryExists(filePath);

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
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);

            if (currentLine >= 0 && currentLine < lines.length) {
                // Get parent's original indentation
                const parentLine = lines[currentLine];
                parentIndent = parentLine.search(/\S|$/);

                const result = this.fileOps.collectChildrenFromLines(lines, currentLine);
                childrenLines = result.childrenLines;
            }
        }

        // 2. Strip block IDs from children
        const cleanedChildren = this.fileOps.stripBlockIds(childrenLines);

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
}
