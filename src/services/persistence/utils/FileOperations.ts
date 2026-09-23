import { type App, TFolder } from 'obsidian';
import { TaskLineClassifier } from '../../parsing/utils/TaskLineClassifier';
import { Outline } from '../../parsing/utils/Outline';


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
        const taskIndent = Outline.depthOf(taskLine);
        const childrenLines: string[] = [];

        let j = taskLineIndex + 1;
        while (j < lines.length) {
            const nextLine = lines[j];

            // Skip blank lines - they are NOT children
            if (nextLine.trim() === '') {
                break;
            }

            const nextIndent = Outline.depthOf(nextLine);
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
     * Strip a trailing `^block-id` from each line.
     *
     * The reading comes from TaskLineClassifier, which is where every parser
     * asks the same question. A stricter copy here would leave an id on a
     * line the parser still reads as anchored, and the copy would then claim
     * the anchor of the line it was copied from.
     */
    stripBlockIds(lines: string[]): string[] {
        return lines.map(line => TaskLineClassifier.extractBlockId(line).text);
    }

    /**
     * One indent level, inferred from the given line's own indentation.
     * Obsidian supports only a tab or 4 spaces, so a line already using tabs
     * implies a tab unit; anything else — including an unindented line, where
     * there is nothing to read — implies 4 spaces.
     */
    static getIndentUnit(line: string): string {
        const indent = line.match(/^(\s*)/)?.[1] ?? '';
        return indent.includes('\t') ? '\t' : '    ';
    }

    /**
     * Compute the indent string for a direct child of the given parent line.
     * Detects tabs vs spaces from the parent and adds one level.
     */
    static getChildIndent(parentLine: string): string {
        const parentIndent = parentLine.match(/^(\s*)/)?.[1] ?? '';
        return parentIndent + FileOperations.getIndentUnit(parentLine);
    }

    /**
     * The indent string of the task's first child, or null when it has none.
     * Blank lines and anything at or above the task's own depth end the search,
     * matching {@link collectChildrenFromLines}.
     */
    static firstChildIndent(lines: string[], taskLineIndex: number): string | null {
        const taskIndent = Outline.depthOf(lines[taskLineIndex]);
        for (let j = taskLineIndex + 1; j < lines.length; j++) {
            const line = lines[j];
            if (line.trim() === '') break;
            if (Outline.depthOf(line) <= taskIndent) break;
            return line.match(/^(\s*)/)?.[1] ?? null;
        }
        return null;
    }

    /**
     * One indent level as this file spells it, taken from the first indented
     * line. A file with no indentation anywhere gets a tab, Obsidian's default.
     */
    static detectIndentUnit(lines: string[]): string {
        for (const line of lines) {
            const m = line.match(/^([ \t]+)\S/);
            if (m) return m[1].includes('\t') ? '\t' : '    ';
        }
        return '\t';
    }

    /**
     * The indent to give a new child of the task at `taskLineIndex`.
     *
     * The task's existing children decide it, so a subtree keeps one spelling.
     * With no children to copy, the rest of the file decides — reading the
     * parent line alone cannot, because a top-level task has no indentation and
     * {@link getIndentUnit} then answers four spaces for every file, tab-written
     * ones included. That is how the two spellings ended up in one subtree.
     */
    static resolveChildIndent(lines: string[], taskLineIndex: number): string {
        const own = FileOperations.firstChildIndent(lines, taskLineIndex);
        if (own !== null) return own;

        const parentIndent = lines[taskLineIndex].match(/^(\s*)/)?.[1] ?? '';
        return parentIndent + FileOperations.detectIndentUnit(lines);
    }

    /**
     * Strip the parent's indent prefix from each child line, preserving deeper
     * indentation (tabs / spaces / mixed) exactly as written in the source.
     */
    static adjustChildIndentation(childLines: string[], oldParentIndent: string): string[] {
        return childLines.map(line => {
            if (line.trim() === '') return line;
            if (line.startsWith(oldParentIndent)) {
                return line.substring(oldParentIndent.length);
            }
            // Defensive: line indent is shorter than declared parent prefix.
            const currentIndent = line.match(/^\s*/)?.[0] ?? '';
            return line.substring(Math.min(oldParentIndent.length, currentIndent.length));
        });
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
