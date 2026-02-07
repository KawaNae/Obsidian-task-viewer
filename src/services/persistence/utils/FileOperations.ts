import { App, TFile, TFolder } from 'obsidian';
import type { Task } from '../../../types';


/**
 * ファイル操作の共通ヘルパークラス
 * TaskRepository の各ライターから使用される低レベルなファイル操作を提供
 */
export class FileOperations {
    constructor(private app: App) { }

    /**
     * Helper: Collect children lines from file content starting at taskLine
     * Returns { childrenLines, taskIndent }
     * Note: Empty/blank lines are NOT included as children
     */
    collectChildrenFromLines(lines: string[], taskLineIndex: number): {
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
    stripBlockIds(lines: string[]): string[] {
        const blockIdRegex = /\s\^[a-zA-Z0-9-]+$/;
        return lines.map(line => line.replace(blockIdRegex, ''));
    }

    /**
     * Find the current line number of a task in the file.
     * Uses multiple strategies: exact match, content + date match, fallback to stored line.
     */
    findTaskLineNumber(lines: string[], task: Task): number {
        // Strategy 0: Stored line number (O(1), correct when no line shift has occurred)
        // Must run before Strategy 1 to avoid returning the first duplicate when
        // multiple lines share the same originalText (e.g. inherited-date child tasks).
        if (task.line >= 0 && task.line < lines.length && lines[task.line] === task.originalText) {
            return task.line;
        }

        // Strategy 1: Exact originalText match (fallback for shifted lines)
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

    /**
     * Ensure directory exists, creating it if necessary
     */
    async ensureDirectoryExists(filePath: string): Promise<void> {
        const lastSlashIndex = filePath.lastIndexOf('/');
        if (lastSlashIndex === -1) return; // Root directory

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
