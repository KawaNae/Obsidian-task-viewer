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
     * The lines of the task's subtree below its own line, as the parser reads
     * them (`Outline.subtreeEnd`): blank lines between them included, the
     * blank lines after the last of them not. `taskIndent` is the task's depth.
     */
    collectChildrenFromLines(lines: readonly string[], taskLineIndex: number): {
        childrenLines: string[];
        taskIndent: number;
    } {
        const taskIndent = Outline.depthOf(lines[taskLineIndex]);
        const childrenLines = lines.slice(taskLineIndex + 1, Outline.subtreeEnd(lines, taskLineIndex));
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
    stripBlockIds(lines: readonly string[]): string[] {
        return lines.map(line => TaskLineClassifier.extractBlockId(line).text);
    }

    /**
     * One indent level, inferred from the given line's own indentation.
     * Obsidian supports only a tab or 4 spaces, so a line already using tabs
     * implies a tab unit; anything else — including an unindented line, where
     * there is nothing to read — implies 4 spaces.
     */
    static getIndentUnit(line: string): string {
        const indent = Outline.indentOf(line);
        return indent.includes('\t') ? '\t' : '    ';
    }

    /**
     * Compute the indent string for a direct child of the given parent line.
     * Detects tabs vs spaces from the parent and adds one level.
     */
    static getChildIndent(parentLine: string): string {
        const parentIndent = Outline.indentOf(parentLine);
        return parentIndent + FileOperations.getIndentUnit(parentLine);
    }

    /**
     * The indent string of the task's first child, or null when it has none:
     * the first line of its subtree that is not blank.
     */
    static firstChildIndent(lines: readonly string[], taskLineIndex: number): string | null {
        const end = Outline.subtreeEnd(lines, taskLineIndex);
        for (let j = taskLineIndex + 1; j < end; j++) {
            if (lines[j].trim() !== '') return Outline.indentOf(lines[j]);
        }
        return null;
    }

    /**
     * One indent level as this file spells it, taken from the first indented
     * line. A file with no indentation anywhere gets a tab, Obsidian's default.
     */
    static detectIndentUnit(lines: readonly string[]): string {
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
    static resolveChildIndent(lines: readonly string[], taskLineIndex: number): string {
        const own = FileOperations.firstChildIndent(lines, taskLineIndex);
        if (own !== null) return own;

        const parentIndent = Outline.indentOf(lines[taskLineIndex]);
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
            const currentIndent = Outline.indentOf(line);
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
