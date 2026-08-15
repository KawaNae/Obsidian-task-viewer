import { type App, TFolder } from 'obsidian';
import type { Task } from '../../../types';
import { hasBodyLine } from '../../../types';
import { CodeFenceTracker } from '../../../utils/CodeFenceTracker';
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
     * The indent string of the task's first child, or null when it has none.
     * Blank lines and anything at or above the task's own depth end the search,
     * matching {@link collectChildrenFromLines}.
     */
    static firstChildIndent(lines: string[], taskLineIndex: number): string | null {
        const taskIndent = lines[taskLineIndex].search(/\S|$/);
        for (let j = taskLineIndex + 1; j < lines.length; j++) {
            const line = lines[j];
            if (line.trim() === '') break;
            if (line.search(/\S|$/) <= taskIndent) break;
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
     * Visual width of a line's indentation, counting a tab as four columns.
     *
     * Obsidian accepts only a tab or four spaces per level, so this maps both
     * spellings of the same depth onto the same number. Comparing raw character
     * counts instead treats a tab as one column, which makes a tab-indented
     * sibling look shallower than a space-indented one and cuts sibling walks
     * short in files where the two are mixed.
     */
    static indentWidth(line: string): number {
        const indent = line.match(/^(\s*)/)?.[1] ?? '';
        let width = 0;
        for (const ch of indent) width += ch === '\t' ? 4 : 1;
        return width;
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
     * True when `line` is a task line that carries no name — everything it says
     * is notation (`- [ ]  @2026-08-15`).
     *
     * Such a task is invisible to {@link lineHasTaskContent}, which needs a name
     * to compare, so every strategy after the exact-text ones used to miss and
     * the write was dropped. The test is deliberately narrow: anything before
     * the date block means the line has a name, so only a genuinely empty one
     * qualifies. It is never used alone — the caller pairs it with a date token,
     * because a name-less line with no date has nothing left to identify it by.
     */
    private static lineHasEmptyTaskContent(line: string): boolean {
        const parsed = TaskLineClassifier.classify(line);
        if (!parsed) return false;
        return parsed.rawContent.split('@')[0].trim() === '';
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
     * Decide which of several equally matching lines the task means.
     *
     * One candidate answers itself. With more than one, the stored line number
     * breaks the tie when it points at one of them — it is independent evidence,
     * and the candidates are indistinguishable without it. Otherwise nothing is
     * returned: writing to the first of several identical records would edit a
     * neighbour with no sign that it happened, and the caller now reverts and
     * reports rather than dropping the write in silence.
     */
    private static pickUnique(hits: number[], task: Task): number {
        if (hits.length === 1) return hits[0];
        if (hasBodyLine(task) && hits.includes(task.line)) return task.line;
        return -1;
    }

    /**
     * Find the current line number of a task in the file.
     * Uses multiple strategies: exact match, content + date match, verified
     * fallback to the stored line. Returns -1 when no line can be trusted —
     * every caller treats that as "do not write".
     */
    findTaskLineNumber(lines: string[], task: Task): number {
        // A line inside a code fence is an example, not a task. The parser
        // already refuses to index it, so no task ever *lives* there — but the
        // search below looks for lines that resemble the task, and a sample in
        // a fence resembles one exactly. Excluding them keeps a write aimed at
        // the real line from landing on a quoted copy of it.
        //
        // Only the document-level reading is used, matching what the parser
        // does when it decides which lines become tasks. A fence indented under
        // a task is invisible to both (CommonMark measures the ≤3-space
        // allowance from column 0), so a sample written there is still a
        // candidate. That gap is left as it is rather than widened here: the
        // dedented reading would have to be applied to the whole document, and
        // an unclosed indented fence would then swallow every line after it.
        const fenced = CodeFenceTracker.mask(lines);

        // Strategy -1: Resolve by block ID (most stable against content edits).
        if (task.blockId) {
            const blockIdRegex = new RegExp(`\\s\\^${task.blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
            for (let i = 0; i < lines.length; i++) {
                if (!fenced[i] && blockIdRegex.test(lines[i])) {
                    return i;
                }
            }
        }

        // Strategy 0: Stored line number (O(1), correct when no line shift has occurred)
        // Must run before Strategy 1 to avoid returning the first duplicate when
        // multiple lines share the same originalText (e.g. duplicate bare-checkbox child lines).
        if (hasBodyLine(task) && task.line < lines.length
            && !fenced[task.line] && lines[task.line] === task.originalText) {
            return task.line;
        }

        // Strategy 1: Exact originalText match (fallback for shifted lines)
        for (let i = 0; i < lines.length; i++) {
            if (!fenced[i] && lines[i] === task.originalText) {
                return i;
            }
        }

        // Strategy 2: Match by content and date notation (more resilient)
        const content = task.content || '';
        // due-only / end-only タスクで bare '@' に退化すると同名タスクを誤マッチ
        // するため、実トークン(>due / >end)で照合する。
        //
        // 開始時刻まで含めるのは、同名・同日のレコードが日常的に並ぶため。
        // ポモドーロは 30 分ごとに同じ名前の行を積むし、中断と再開も 1 日に何度も
        // 起きる。日付だけで照合すると、その列のどれを指しているのか決まらない。
        // 実データでは時刻がほぼ常に異なるので、これでほぼ一意になる。
        const datePattern = task.startDate
            ? `@${task.startDate}${task.startTime ? `T${task.startTime}` : ''}`
            : task.due
                ? `>${task.due}`
                : task.endDate
                    ? `>${task.endDate}`
                    : null;

        const matches = (line: string): boolean => {
            if (content) {
                if (!FileOperations.lineHasTaskContent(line, content)) return false;
            } else {
                // 名前が無い行は、日付トークンだけが手がかり。日付も無ければ
                // 見分ける材料がゼロなので、この経路自体を使わない。
                if (!datePattern) return false;
                if (!FileOperations.lineHasEmptyTaskContent(line)) return false;
            }
            return !datePattern || FileOperations.lineHasDateToken(line, datePattern);
        };

        const hits: number[] = [];
        for (let i = 0; i < lines.length; i++) {
            if (!fenced[i] && matches(lines[i])) hits.push(i);
        }
        if (hits.length > 0) return FileOperations.pickUnique(hits, task);

        // Strategy 3: Stored line, but only when it still holds the same task.
        // The unverified fallback this replaces wrote to whatever happened to
        // sit at task.line, which silently clobbered unrelated lines whenever
        // the earlier strategies all missed on a shifted file.
        if (hasBodyLine(task) && task.line < lines.length && !fenced[task.line]) {
            const stored = lines[task.line];
            const stillHolds = content
                ? FileOperations.lineHasTaskContent(stored, content)
                : !!datePattern
                    && FileOperations.lineHasEmptyTaskContent(stored)
                    && FileOperations.lineHasDateToken(stored, datePattern);
            if (stillHolds) return task.line;
        }

        return -1;
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
