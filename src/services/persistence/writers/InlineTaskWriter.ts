import { type App, TFile } from 'obsidian';
import type { Task } from '../../../types';
import { TaskParser } from '../../parsing/TaskParser';
import { TaskLineClassifier } from '../../parsing/utils/TaskLineClassifier';
import { collectFlowLineIndicesInFile } from '../../flow/FlowLineScanner';
import { FileOperations } from '../utils/FileOperations';
import { ChildPropertyLineEditor } from '../utils/ChildPropertyLineEditor';
import type { PropertyOp } from '../PropertyUpdatePlanner';
import { type FlowInstanceInsert, renderFlowInstance } from '../FlowInstanceLines';
import { appendLines, processLines, splitLines } from '../../../utils/FileLines';
import type { WriteObserver } from '../WriteObserver';
import { logWarn } from '../../../log/log';


/**
 * インラインタスクの書き込み操作を担当するクラス
 * タスク行の更新、削除、挿入などのCRUD操作を提供
 */
export class InlineTaskWriter {
    constructor(
        private app: App,
        private fileOps: FileOperations,
        private writes?: WriteObserver
    ) { }

    /**
     * @returns whether the task's line was found and rewritten. A `false` here
     * means nothing was written at all, which the caller must not treat as a
     * successful no-op: the index has already been updated optimistically, and
     * an unwritten file leaves the two disagreeing until something else forces
     * a rescan.
     */
    async updateTaskInFile(task: Task, updatedTask: Task, childOps: PropertyOp[] = []): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) {
            logWarn(`[InlineTaskWriter] File not found: ${task.file}`);
            return false;
        }

        return processLines(this.app, file, (lines, _eol, edits) => {
            // Find current line number using originalText (handles line shifts)
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                logWarn(`[InlineTaskWriter] Task not found in file`);
                return null;
            }

            // Re-format line
            const newLine = TaskParser.format(updatedTask);

            // Preserve indentation if possible
            const originalIndent = lines[currentLine].match(/^(\s*)/)?.[1] || '';
            lines[currentLine] = originalIndent + newLine.trim();
            // An update rewrites the line and leaves it the same task — the
            // whole point of the call is that this row is the one being
            // changed. Filed before the child ops because `applyOps` only ever
            // touches lines below `currentLine` (its scan starts at
            // `taskLineIdx + 1` and stops at the first line that is not a
            // descendant), so this coordinate is still this line afterwards.
            edits.replaced(currentLine);

            // 子プロパティ行（- key:: value）の更新は同一 process 内で
            // 連続適用する（別 process だと originalText 失効と行番号
            // シフトが競合するため、タスク行と子行は1原子書き込み）。
            if (childOps.length > 0) {
                ChildPropertyLineEditor.applyOps(lines, currentLine, childOps, edits);
            }

            return lines;
        }, this.writes?.for(task.file));
    }

    async updateLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await processLines(this.app, file, (lines, _eol, edits) => {
            if (lines.length <= lineNumber) return null;

            // Preserve original indentation
            const originalLine = lines[lineNumber];
            const originalIndent = originalLine.match(/^(\s*)/)?.[1] || '';
            const newContentTrimmed = newContent.trimStart();

            lines[lineNumber] = originalIndent + newContentTrimmed;
            // The editor's own menu comes through here: a status change, and
            // the conversion of a bare checkbox into an inline task. Both
            // rewrite the row in place and leave it the row it was.
            edits.replaced(lineNumber);

            return lines;
        }, this.writes?.for(filePath));
    }

    async insertLineAfterLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await processLines(this.app, file, (lines) => {
            if (lineNumber < 0 || lineNumber >= lines.length) return null;
            lines.splice(lineNumber + 1, 0, newContent);
            return lines;
        });
    }

    /**
     * Delete one line by its coordinate, whatever that line is.
     *
     * The claim says a line went away and nothing else. It cannot say more:
     * this path is reached from the editor's context menu on a raw checkbox,
     * so the line is not necessarily a task, and the lines under it are left
     * where they are. A child that outlives its parent here keeps the identity
     * it had — it is the same line, one row higher.
     */
    async deleteLine(filePath: string, lineNumber: number): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        await processLines(this.app, file, (lines, _eol, edits) => {
            if (lineNumber < 0 || lineNumber >= lines.length) return null;
            edits.splice(lineNumber, 1);
            return lines;
        }, this.writes?.for(filePath));
    }

    /**
     * Fire-consumes a flow command: rewrite the task line without `==>` and
     * delete the task's direct `- ==>` flow child lines — one atomic
     * vault.process. Flow lines are located by a content scan from the
     * resolved task line (never by stored body offsets, which are stale
     * after create-next inserted the new instance above).
     */
    async stripFlow(task: Task): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) {
            logWarn(`[InlineTaskWriter] File not found: ${task.file}`);
            return;
        }

        await processLines(this.app, file, (lines, _eol, edits) => {
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                logWarn(`[InlineTaskWriter] Task not found in file (stripFlow)`);
                return null;
            }

            // Every index here is below `currentLine`: the scan starts at
            // `taskLineIndex + 1` and stops at the first line that is not a
            // descendant (FlowLineScanner.ts:82-86). So the deletions leave
            // `currentLine` where it is, and the `replaced` below is filed at
            // the same coordinate it was read at.
            const flowIndices = collectFlowLineIndicesInFile(lines, currentLine);
            for (let i = flowIndices.length - 1; i >= 0; i--) {
                edits.splice(flowIndices[i], 1);
            }

            const newLine = TaskParser.format({ ...task, flow: undefined });
            const originalIndent = lines[currentLine].match(/^(\s*)/)?.[1] || '';
            lines[currentLine] = originalIndent + newLine.trim();
            // The fired line keeps its identity: losing `==>` rewrites the text
            // but does not make it another task.
            edits.replaced(currentLine);

            return lines;
        }, this.writes?.for(task.file));
    }

    /**
     * @param moved where the task's lines were written before this call, when
     * this delete is the origin half of a move. The half that matters for
     * identity is the destination, and it is a separate write — to another
     * file, or to another place in this one. Naming the destination rather
     * than passing a flag is what stage 4 needs to tie the two halves
     * together; today it only says "stay quiet".
     * @returns whether the task's lines were found and removed. A `false` means
     * the file still holds them — the caller must not report the task gone.
     */
    async deleteTaskFromFile(task: Task, moved?: { to: string }): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) {
            logWarn(`[InlineTaskWriter] File not found: ${task.file}`);
            return false;
        }

        // A move's origin does not claim. Within one file the move's rows are
        // still alive further down, and `removed` would call a living row dead
        // — the next scan would mint new IDs for rows the ladder could have
        // carried. Across files the claim would be true, but telling the two
        // apart is the same judgement stage 4 has to make for the destination
        // hint, so both halves wait for it together.
        const sink = moved ? undefined : this.writes?.for(task.file);

        return processLines(this.app, file, (lines, _eol, edits) => {
            // Find current line using originalText
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                logWarn(`[InlineTaskWriter] Task not found in file (delete)`);
                return null;
            }

            const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);

            // Delete task line + all children. What the claim carries is what
            // this splice actually removed, not `1 + childrenLines.length`
            // counted a second time: the two cannot disagree if only one of
            // them exists.
            edits.splice(currentLine, 1 + childrenLines.length);

            return lines;
        }, sink);
    }

    /**
     * Take the task's lines away and put what its firing wrote in their place,
     * as one write.
     *
     * This is a deletion fire: the user asked for the line to go, and the
     * command on it gets to write its next instance before it does. Both
     * halves used to be writes of their own, each resolving the original by
     * `findTaskLineNumber` — and the second search is what could not be made
     * right. The next instance is worded exactly like the line it comes from
     * whenever the original carries no date and no block id (the command
     * living in a child line), so the search that ran after it was written
     * could not tell the two apart, and the delete took the instance that had
     * just been created. The file came back to exactly what it started as and
     * the task the user deleted was still there.
     *
     * The fix is not a better search. It is to resolve the line once, while
     * nothing has moved, and to take every number from the array being
     * written. Nothing here looks for the task a second time, so there is no
     * second answer to be wrong.
     *
     * The order invariant the interpreter follows (see `FlowEffects`) — write
     * the instance first, remove the original last, because line resolution
     * matches on `originalText` — has nothing left to protect here and is not
     * what this does. The removal goes first, and that is only so the two
     * numbers stay independent: the insert lands at the head of the sibling
     * group, at or above the task's own line, so removing the task's lines
     * cannot move it. What the original's lines say is read before either
     * splice, since the instance is rendered against them.
     *
     * A task that cannot be resolved is not written around: nothing goes in,
     * nothing comes out, and the file is left byte-identical. The insert has
     * no "append it at the end instead" of its own to fall back on — an
     * instance appended to a file whose original could not be removed is the
     * one outcome this call exists to make impossible.
     *
     * @returns whether the task's lines were found and replaced. `false` means
     * the file is untouched, in full.
     */
    async replaceTaskWithInstances(task: Task, inserts: FlowInstanceInsert[]): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) {
            logWarn(`[InlineTaskWriter] File not found: ${task.file}`);
            return false;
        }

        return processLines(this.app, file, (lines, _eol, edits) => {
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                logWarn('[InlineTaskWriter] Task not found in file (replace with instances)');
                return null;
            }

            // Everything that reads the original reads it here, before a
            // single line has moved.
            const rendered = inserts.flatMap(
                insert => renderFlowInstance(this.fileOps, lines, currentLine, insert));
            const insertAt = this.fileOps.findSiblingGroupStart(lines, currentLine);
            const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);

            edits.splice(currentLine, 1 + childrenLines.length);
            edits.splice(insertAt, 0, ...rendered);

            return lines;
        }, this.writes?.for(task.file));
    }

    /**
     * The line index just past the task's subtree — where a following line
     * would go. Trailing blank lines inside the subtree are not counted, so an
     * insert lands against the last written line instead of after a gap.
     */
    private subtreeEnd(lines: string[], taskLineIndex: number): number {
        const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, taskLineIndex);

        let effectiveChildrenCount = childrenLines.length;
        for (let i = childrenLines.length - 1; i >= 0; i--) {
            if (childrenLines[i].trim() === '') {
                effectiveChildrenCount--;
            } else {
                break;
            }
        }

        return taskLineIndex + 1 + effectiveChildrenCount;
    }

    /**
     * Walk forward over the siblings that immediately follow `taskLineIndex`
     * for as long as they are completed, and return the last one's index (the
     * starting index when the very next sibling is not completed).
     *
     * "Completed" is `[x]` and nothing else — the status character is a fact the
     * parser knows, unlike the shape of a line, which cannot be told apart from
     * something the user typed by hand. The run stops at the first line that is
     * not a completed sibling: a blank line, a shallower line, or an unfinished
     * one. Deeper lines are never seen here because they belong to a subtree
     * that {@link subtreeEnd} has already skipped over.
     */
    private completedRunEnd(lines: string[], taskLineIndex: number): number {
        // Depth is compared by visual width, not by character count: a file that
        // mixes tabs and four-space indents writes the same depth two ways, and
        // counting characters makes the tab line look shallower — the walk then
        // stops at the first sibling spelled differently and a new record lands
        // in the middle of the run instead of at its end.
        const baseWidth = FileOperations.indentWidth(lines[taskLineIndex]);

        let last = taskLineIndex;
        for (; ;) {
            const next = this.subtreeEnd(lines, last);
            if (next >= lines.length) return last;

            const line = lines[next];
            if (line.trim() === '') return last;
            if (FileOperations.indentWidth(line) !== baseWidth) return last;

            const parsed = TaskLineClassifier.classify(line);
            if (parsed?.statusChar !== 'x') return last;

            last = next;
        }
    }

    /**
     * Append `lineBody` as the task's last child.
     *
     * `lineBody` carries no indentation: the depth is read off the file here,
     * from the children the task already has. Letting the caller prefix it meant
     * deriving the unit from the parent line alone, which returns four spaces
     * for any top-level task and so mixed spaces into tab-written files.
     */
    async insertLineAfterTask(task: Task, lineBody: string): Promise<number> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return -1;

        let insertedLineIndex = -1;

        await processLines(this.app, file, (lines) => {
            // Find current line using originalText (handles line shifts)
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) return null;

            const indent = FileOperations.resolveChildIndent(lines, currentLine);
            const insertIndex = this.subtreeEnd(lines, currentLine);
            lines.splice(insertIndex, 0, indent + lineBody.trim());
            insertedLineIndex = insertIndex;

            return lines;
        });

        return insertedLineIndex;
    }

    /**
     * Insert `lineBody` just past the task's subtree, at the task's own
     * indentation — the task gains a next sibling.
     *
     * The indentation is read from the *resolved* line rather than from
     * `task.originalText`, which can be stale after a shift; a sibling that
     * lands one level off would silently become a child of the wrong line.
     *
     * With `opts.afterCompletedRun`, the insert moves past the completed
     * siblings that directly follow the task (see {@link completedRunEnd}) so a
     * new session record joins the end of a chronological run instead of
     * splitting it. Deciding *where* belongs here rather than in the caller
     * because the answer needs the file's own lines, and reading them outside
     * this `vault.process` would reintroduce the gap between "what the index
     * last saw" and "what the file holds now".
     *
     * Returns the inserted line index, or -1 when the line cannot be resolved.
     */
    async insertSiblingAfterTask(
        task: Task,
        lineBody: string,
        opts: { afterCompletedRun?: boolean } = {}
    ): Promise<number> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return -1;

        let insertedLineIndex = -1;

        await processLines(this.app, file, (lines) => {
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                logWarn(`[InlineTaskWriter] Task not found in file (insertSiblingAfterTask)`);
                return null;
            }

            const indent = lines[currentLine].match(/^(\s*)/)?.[1] ?? '';
            const anchor = opts.afterCompletedRun
                ? this.completedRunEnd(lines, currentLine)
                : currentLine;

            const insertIndex = this.subtreeEnd(lines, anchor);
            lines.splice(insertIndex, 0, indent + lineBody.trim());
            insertedLineIndex = insertIndex;

            return lines;
        });

        return insertedLineIndex;
    }

    /**
     * Insert `lineBody` as the first child of a task (right after the task line).
     * Used for timer/pomodoro records that should appear at the top of children.
     *
     * As with {@link insertLineAfterTask}, the indent is resolved here from the
     * task's existing children rather than supplied by the caller.
     */
    async insertLineAsFirstChild(task: Task, lineBody: string): Promise<number> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return -1;

        let insertedLineIndex = -1;

        await processLines(this.app, file, (lines) => {
            // Find the current line number using multiple strategies
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);

            if (currentLine < 0 || currentLine >= lines.length) {
                logWarn(`[InlineTaskWriter] Task not found in file (insertLineAsFirstChild)`);
                return null;
            }

            const indent = FileOperations.resolveChildIndent(lines, currentLine);

            // Insert directly after the task line (as first child)
            const insertIndex = currentLine + 1;
            lines.splice(insertIndex, 0, indent + lineBody.trim());
            insertedLineIndex = insertIndex;

            return lines;
        });

        return insertedLineIndex;
    }

    /** @returns the 0-based line the task landed on, or -1 when nothing was written. */
    async appendTaskToFile(filePath: string, content: string): Promise<number> {
        const file = this.app.vault.getAbstractFileByPath(filePath);

        if (!file) {
            await this.fileOps.ensureDirectoryExists(filePath);
            await this.app.vault.create(filePath, content);
            return 0;
        }

        if (!(file instanceof TFile)) {
            logWarn(`[InlineTaskWriter] Not a file: ${filePath}`);
            return -1;
        }

        // The appended text is built with LF; splitting it here lets the file's
        // own terminator go back between every line, its own included.
        let insertedLine = -1;
        await processLines(this.app, file, (lines) => {
            insertedLine = appendLines(lines, splitLines(content).lines);
            return lines;
        });
        return insertedLine;
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
        // The task's own direct `- ==>` flow lines are consumed by the fire —
        // they must not travel to the archive. Descendant tasks' flow lines
        // are NOT direct (structural-parent rule) and stay as templates.
        const flowAbs = new Set(collectFlowLineIndicesInFile(lines, currentLine));
        const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);
        const kept = childrenLines.filter((_, i) => !flowAbs.has(currentLine + 1 + i));
        const cleaned = this.fileOps.stripBlockIds(kept);
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
            await processLines(this.app, sourceFile, (lines) => {
                const adjustedChildren = this.buildAdjustedChildren(lines, task);
                appendLines(lines, [...splitLines(content).lines, ...adjustedChildren]);
                return lines;
            });
            return;
        }

        // Cross-file: collect children from source, then append to dest (see note).
        let adjustedChildren: string[] = [];
        if (sourceFile instanceof TFile) {
            const sourceContent = await this.app.vault.read(sourceFile);
            adjustedChildren = this.buildAdjustedChildren(splitLines(sourceContent).lines, task);
        }

        const fullContent = [content, ...adjustedChildren].join('\n');
        await this.appendTaskToFile(destPath, fullContent);
    }
}
