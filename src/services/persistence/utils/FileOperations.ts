import { type App, TFolder } from 'obsidian';
import type { Task } from '../../../types';
import { hasBodyLine } from '../../../types';
import { TaskLineClassifier } from '../../parsing/utils/TaskLineClassifier';


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
     * タスクが属する兄弟グループの先頭位置を返す。
     * - トップレベル: 上方向に同インデントの兄弟を辿り、最初の兄弟位置を返す
     * - 子タスク: 親タスクの直後（= 最初の子の位置）を返す
     */
    findSiblingGroupStart(lines: string[], taskLineIndex: number): number {
        const taskLine = lines[taskLineIndex];
        const taskIndent = taskLine.search(/\S|$/);

        if (taskIndent === 0) {
            let candidate = taskLineIndex;
            for (let i = taskLineIndex - 1; i >= 0; i--) {
                const line = lines[i];
                if (line.trim() === '') break;
                if (/^#{1,6}\s/.test(line)) break;
                const lineIndent = line.search(/\S|$/);
                if (lineIndent === taskIndent) {
                    candidate = i;
                } else if (lineIndent > taskIndent) {
                    continue; // 前の兄弟の子をスキップ
                } else {
                    break;
                }
            }
            return candidate;
        } else {
            for (let i = taskLineIndex - 1; i >= 0; i--) {
                const line = lines[i];
                if (line.trim() === '') break;
                const lineIndent = line.search(/\S|$/);
                if (lineIndent < taskIndent) {
                    return i + 1; // 親の直後
                }
            }
            return 0;
        }
    }

    /**
     * Helper: Strip block IDs from lines
     */
    stripBlockIds(lines: string[]): string[] {
        const blockIdRegex = /\s\^[a-zA-Z0-9-]+$/;
        return lines.map(line => line.replace(blockIdRegex, ''));
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
     * Add one indent level to every line of a block, leaving blank lines alone.
     * The inverse of adjustChildIndentation: the unit is only ever prepended,
     * never rewritten, so deeper indentation inside the block survives verbatim.
     */
    static indentBlock(lines: string[], unit: string): string[] {
        return lines.map(line => (line.trim() === '' ? line : unit + line));
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
     * True when `line` is a task line whose content is `content`, allowing the
     * trailing notation (`@date`, `#tag`, `^blockId`) to follow it.
     *
     * The trailing boundary is the point: a bare prefix test lets a write aimed
     * at `買い物` land on `買い物リスト` — the line resolution then overwrites an
     * unrelated task. Classification goes through TaskLineClassifier so that
     * "what counts as a task line" has one owner.
     */
    private static lineHasTaskContent(line: string, content: string): boolean {
        if (!content) return false;
        const parsed = TaskLineClassifier.classify(line);
        if (!parsed) return false;

        // Extra spaces after the checkbox are tolerated (`- [ ]   task`).
        const rawContent = parsed.rawContent.trimStart();
        if (!rawContent.startsWith(content)) return false;

        const next = rawContent.charAt(content.length);
        return next === '' || /\s/.test(next);
    }

    /**
     * True when `token` (`@start` / `>due` / `>end`) appears as a whole date
     * token. Only the *trailing* side needs guarding, and only loosely: a start
     * date legitimately continues into `>` (allday range) or `T` (time of day),
     * so those must stay matchable.
     */
    private static lineHasDateToken(line: string, token: string): boolean {
        for (let from = 0; ;) {
            const idx = line.indexOf(token, from);
            if (idx < 0) return false;
            const next = line.charAt(idx + token.length);
            if (next === '' || next === '>' || next === 'T' || /\s/.test(next)) return true;
            from = idx + 1;
        }
    }

    /**
     * Find the current line number of a task in the file.
     * Uses multiple strategies: exact match, content + date match, verified
     * fallback to the stored line. Returns -1 when no line can be trusted —
     * every caller treats that as "do not write".
     */
    findTaskLineNumber(lines: string[], task: Task): number {
        // Strategy -1: Resolve by block ID (most stable against content edits).
        if (task.blockId) {
            const blockIdRegex = new RegExp(`\\s\\^${task.blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
            for (let i = 0; i < lines.length; i++) {
                if (blockIdRegex.test(lines[i])) {
                    return i;
                }
            }
        }

        // Strategy 0: Stored line number (O(1), correct when no line shift has occurred)
        // Must run before Strategy 1 to avoid returning the first duplicate when
        // multiple lines share the same originalText (e.g. duplicate bare-checkbox child lines).
        if (hasBodyLine(task) && task.line < lines.length && lines[task.line] === task.originalText) {
            return task.line;
        }

        // Strategy 1: Exact originalText match (fallback for shifted lines)
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === task.originalText) {
                return i;
            }
        }

        // Strategy 2: Match by content and date notation (more resilient)
        const content = task.content || '';
        // due-only / end-only タスクで bare '@' に退化すると同名タスクを誤マッチ
        // するため、実トークン(>due / >end)で照合する。
        const datePattern = task.startDate
            ? `@${task.startDate}`
            : task.due
                ? `>${task.due}`
                : task.endDate
                    ? `>${task.endDate}`
                    : null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!FileOperations.lineHasTaskContent(line, content)) continue;

            if (datePattern) {
                if (FileOperations.lineHasDateToken(line, datePattern)) return i;
            } else {
                return i;
            }
        }

        // Strategy 3: Stored line, but only when it still holds the same task.
        // The unverified fallback this replaces wrote to whatever happened to
        // sit at task.line, which silently clobbered unrelated lines whenever
        // the earlier strategies all missed on a shifted file.
        if (hasBodyLine(task) && task.line < lines.length
            && FileOperations.lineHasTaskContent(lines[task.line], content)) {
            return task.line;
        }

        return -1;
    }

    /**
     * Pure core of the session-group transformation: rewrite `lines` so that the
     * task at `taskLineIndex` and its subtree sit one level under a new group
     * line, with `sessionLine` added as the subtree's new last sibling.
     *
     * The existing lines are only ever *prefixed* — no byte of their content is
     * rewritten — so block IDs, `- ==>` flow children and fenced blocks travel
     * unchanged.
     *
     * Known limitation, deliberately kept: collectChildrenFromLines stops at a
     * blank line, so a memo written after one stays where it is. It then reads
     * as a child of the group and a sibling of the record — nothing is lost, and
     * the shared subtree-range helper keeps the meaning every other writer
     * depends on.
     *
     * `groupLine` / `sessionLine` are formatted line bodies without indentation.
     * Returns null when the index is out of range.
     */
    buildGroupWrap(
        lines: string[],
        taskLineIndex: number,
        groupLine: string,
        sessionLine: string
    ): string[] | null {
        if (taskLineIndex < 0 || taskLineIndex >= lines.length) return null;

        const taskLine = lines[taskLineIndex];
        const baseIndent = taskLine.match(/^(\s*)/)?.[1] ?? '';
        const { childrenLines } = this.collectChildrenFromLines(lines, taskLineIndex);

        // Existing children are the better witness of the vault's indent style:
        // a top-level task carries no indentation to read.
        const unitSource = childrenLines.find(l => l.trim() !== '') ?? taskLine;
        const unit = FileOperations.getIndentUnit(unitSource);

        const moved = FileOperations.indentBlock([taskLine, ...childrenLines], unit);

        const result = [...lines];
        result.splice(
            taskLineIndex,
            1 + childrenLines.length,
            baseIndent + groupLine,
            ...moved,
            baseIndent + unit + sessionLine
        );
        return result;
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
