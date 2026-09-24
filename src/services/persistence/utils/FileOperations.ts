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
     * them (`OutlineReading.subtreeEnd`): blank lines between them included, the
     * blank lines after the last of them not.
     */
    collectChildrenFromLines(lines: readonly string[], taskLineIndex: number): {
        childrenLines: string[];
    } {
        const childrenLines = lines.slice(taskLineIndex + 1, Outline.read(lines).subtreeEnd(taskLineIndex));
        return { childrenLines };
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
        return lines.map(line => TaskLineClassifier.extractLineBlockId(line).text);
    }

    /**
     * The indent string of the task's first child, or null when it has none:
     * the first list item the outline reads directly under the task's own
     * item, past the lines in `except`. A line of the subtree that opens no
     * item — a paragraph going on at any depth, indented code — is no child,
     * and a line written at its indentation would be none either.
     */
    static firstChildIndent(
        lines: readonly string[],
        taskLineIndex: number,
        except: ReadonlySet<number> = new Set(),
    ): string | null {
        const outline = Outline.read(lines);
        const end = outline.subtreeEnd(taskLineIndex);
        for (let j = taskLineIndex + 1; j < end; j++) {
            if (outline.item(j)?.parent === taskLineIndex && !except.has(j)) return Outline.indentOf(lines[j]);
        }
        return null;
    }

    /**
     * One indent level as this file spells it, taken from the first indented
     * line. A file with no indentation anywhere gets a tab, Obsidian's default.
     */
    static detectIndentUnit(lines: readonly string[]): string {
        for (const line of lines) {
            const indent = Outline.indentOf(line);
            if (indent !== '' && line.trim() !== '') return indent.includes('\t') ? '\t' : '    ';
        }
        return '\t';
    }

    /**
     * The indent to give a new child of the task at `taskLineIndex`, the
     * child going under `parent`: the task's own line, or a line not yet
     * written in its place — the next instance of a series, a generated
     * parent or child — whose children are to be spelled as the task's are.
     *
     * The task's existing children decide it, so a subtree keeps one spelling:
     * its first child, past the lines in `except` (the ones the write takes
     * away) where it has another, carried under `parent` as far past it as it
     * stood past the task (`Outline.shiftedIndent`). With no children to copy,
     * the rest of the file decides — reading the parent line alone cannot,
     * because a top-level task has no indentation to read a unit from. Reading
     * it there answered four spaces for every file, tab-written ones included,
     * and put the two spellings in one subtree. The file's unit is repeated
     * until the line reaches the parent's content column (`Outline.childIndent`,
     * the one rule for a child's indentation).
     */
    static resolveChildIndent(
        lines: readonly string[],
        taskLineIndex: number,
        parent: string = lines[taskLineIndex],
        except: ReadonlySet<number> = new Set(),
    ): string {
        const first = FileOperations.firstChildIndent(lines, taskLineIndex, except)
            ?? (except.size > 0 ? FileOperations.firstChildIndent(lines, taskLineIndex) : null);
        const sample = first === null ? null
            : Outline.shiftedIndent(first, Outline.indentOf(lines[taskLineIndex]), Outline.indentOf(parent));
        return Outline.childIndent(parent, sample, FileOperations.detectIndentUnit(lines));
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
