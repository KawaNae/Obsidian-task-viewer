import { type App, TFolder } from 'obsidian';
import { TaskLineClassifier } from '../../parsing/utils/TaskLineClassifier';
import { Outline, type OutlineReading } from '../../parsing/utils/Outline';


/**
 * ファイル操作の共通ヘルパークラス
 * TaskRepository の各ライターから使用される低レベルなファイル操作を提供
 */
export class FileOperations {
    constructor(private app: App) { }

    /**
     * The lines of the task's subtree below its own line, as `outline` reads
     * them (`OutlineReading.subtreeEnd`): blank lines between them included, the
     * blank lines after the last of them not.
     */
    collectChildrenFromLines(outline: OutlineReading, taskLineIndex: number): {
        childrenLines: string[];
    } {
        const childrenLines = outline.lines.slice(taskLineIndex + 1, outline.subtreeEnd(taskLineIndex));
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
        outline: OutlineReading,
        taskLineIndex: number,
        except: ReadonlySet<number> = new Set(),
    ): string | null {
        const end = outline.subtreeEnd(taskLineIndex);
        for (let j = taskLineIndex + 1; j < end; j++) {
            if (outline.item(j)?.parent === taskLineIndex && !except.has(j)) return Outline.indentOf(outline.lines[j]);
        }
        return null;
    }

    /**
     * The indent to give a new child of the task at `taskLineIndex`, the
     * child going under `parent`: the task's own line, or a line not yet
     * written in its place — the next instance of a series, a generated
     * parent or child — whose children are to be spelled as the task's are.
     *
     * Obsidian's editor's rule, as the source editor keeps it too: a line
     * written at the depth of a line there takes that line's spelling, and a
     * line one level deeper than any there takes `unit`, the level Obsidian's
     * settings say (`ObsidianConfig.indentUnit`). So the task's existing
     * children decide it, and a subtree keeps one spelling: its first child,
     * past the lines in `except` (the ones the write takes away) where it has
     * another, carried under `parent` as far past it as it stood past the
     * task (`Outline.shiftedIndent`). A task with no children has its first
     * one a level deeper: `parent`'s indentation and `unit`, repeated until
     * the line reaches the parent's content column (`Outline.childIndent`,
     * the one rule for a child's indentation). How the rest of the file is
     * indented does not decide it, as it does not in the editor: a
     * space-indented vault with a note of top-level tasks had its first child
     * written with a tab, the editor's children with spaces. The lines are
     * read as `outline` reads them.
     */
    static resolveChildIndent(
        outline: OutlineReading,
        taskLineIndex: number,
        unit: string,
        parent: string = outline.lines[taskLineIndex],
        except: ReadonlySet<number> = new Set(),
    ): string {
        const lines = outline.lines;
        const first = FileOperations.firstChildIndent(outline, taskLineIndex, except)
            ?? (except.size > 0 ? FileOperations.firstChildIndent(outline, taskLineIndex) : null);
        const sample = first === null ? null
            : Outline.shiftedIndent(first, Outline.indentOf(lines[taskLineIndex]), Outline.indentOf(parent));
        return Outline.childIndent(parent, sample, unit);
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
