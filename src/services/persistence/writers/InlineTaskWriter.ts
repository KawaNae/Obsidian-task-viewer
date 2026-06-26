import { App, TFile } from 'obsidian';
import type { Task } from '../../../types';
import { TaskParser } from '../../parsing/TaskParser';
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

    async insertLineAfterLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lineNumber < 0 || lineNumber >= lines.length) return content;
            lines.splice(lineNumber + 1, 0, newContent);
            return lines.join('\n');
        });
    }

    async deleteLine(filePath: string, lineNumber: number): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            if (lineNumber < 0 || lineNumber >= lines.length) return content;
            lines.splice(lineNumber, 1);
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
     * Collect the task's children from `lines`, strip block IDs, and re-indent
     * them relative to the parent. Returns the children lines ready to append.
     * Shared by both the same-file (atomic) and cross-file paths of
     * `appendTaskWithChildren` so the collection logic lives in one place.
     */
    private buildAdjustedChildren(lines: string[], task: Task): string[] {
        const currentLine = this.fileOps.findTaskLineNumber(lines, task);
        if (currentLine < 0 || currentLine >= lines.length) return [];

        // Parent's original indentation prefix (preserves tabs/spaces)
        const parentIndent = lines[currentLine].match(/^\s*/)?.[0] ?? '';
        const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);
        const cleaned = this.fileOps.stripBlockIds(childrenLines);
        return FileOperations.adjustChildIndentation(cleaned, parentIndent);
    }

    /**
     * Append task with children to file (for move command).
     * Reads children from the original file and appends them together,
     * adjusting children indentation relative to the new parent position.
     *
     * Atomicity note: when source === dest we read and write in a single
     * `vault.process` (atomic). When source ≠ dest (the normal move case) the
     * operation spans two files, which Obsidian's single-file `process` API
     * cannot make atomic. That split is harmless: read(source) → write(dest)
     * only copies the collected child lines into another file — a concurrent
     * edit to source between the read and the append cannot corrupt the dest
     * write, and the subsequent deletion of the original re-locates the task by
     * line number, so it tracks any shift. Do not "fix" this by serializing the
     * two files — the window has no observable effect.
     */
    async appendTaskWithChildren(destPath: string, content: string, task: Task): Promise<void> {
        const sourceFile = this.app.vault.getAbstractFileByPath(task.file);

        // Same-file append: a single atomic process reads children and appends.
        if (sourceFile instanceof TFile && destPath === task.file) {
            await this.app.vault.process(sourceFile, (fileContent) => {
                const lines = fileContent.split('\n');
                const adjustedChildren = this.buildAdjustedChildren(lines, task);
                const fullContent = [content, ...adjustedChildren].join('\n');
                const prefix = fileContent.length > 0 && !fileContent.endsWith('\n') ? '\n' : '';
                return fileContent + prefix + fullContent;
            });
            return;
        }

        // Cross-file: collect children from source, then append to dest (see note).
        let adjustedChildren: string[] = [];
        if (sourceFile instanceof TFile) {
            const sourceContent = await this.app.vault.read(sourceFile);
            adjustedChildren = this.buildAdjustedChildren(sourceContent.split('\n'), task);
        }

        const fullContent = [content, ...adjustedChildren].join('\n');
        await this.appendTaskToFile(destPath, fullContent);
    }
}
