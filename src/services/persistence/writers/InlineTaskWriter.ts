import { type App, TFile } from 'obsidian';
import type { Task } from '../../../types';
import { TaskParser } from '../../parsing/TaskParser';
import { collectFlowLineIndicesInFile } from '../../parsing/utils/FlowLineScanner';
import { FileOperations } from '../utils/FileOperations';
import { ChildPropertyLineEditor } from '../utils/ChildPropertyLineEditor';
import { Placement } from '../utils/Placement';
import type { PropertyOp } from '../PropertyUpdatePlanner';
import { renderFlowInstance } from '../FlowInstanceLines';
import {
    createFile, fileGone, processLines, splitLines,
    type EditorLine, type LineDraft, type Refusal, type WriteAt, type WriteOrigin, type WriteOutcome,
} from '../../../utils/FileLines';
import type { WriteObserver } from '../WriteObserver';
import { recordedOn, subjectOf, type PlannedTarget } from '../TaskRefs';
import { readsAsPlanned } from '../RowBasis';
import type { TaskOp } from '../TaskOps';
import { logWarn } from '../../../log/log';
import { Outline } from '../../parsing/utils/Outline';


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
     * Rewrite the row as `updatedTask`, and its property lines by `childOps`.
     *
     * The line is made from the index's copy, so it is written only over a
     * row that still reads as that copy (`target.basis`): a line edited since
     * — by hand, by the editor's menu, by a fire — would otherwise be put back
     * to what the copy says, the edit lost without a word.
     *
     * @returns the outcome. `written: false` means nothing was written at all,
     * which the caller must not treat as a successful no-op: the index has
     * already been updated optimistically, and an unwritten file leaves the two
     * disagreeing until something else forces a rescan. `rows` holds the row
     * as it was handed in and as it was written.
     */
    async updateTaskInFile(target: PlannedTarget, updatedTask: Task, childOps: PropertyOp[] = []): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(target.file);
        if (!(file instanceof TFile)) return this.refusedGone(target, 'user');

        return processLines(this.app, file, this.writes?.for(target.file, 'user'), (draft, _eol, { row }) => {
            const currentLine = row(target);
            if (currentLine === null) return false;

            // Re-format line
            const newLine = TaskParser.format(updatedTask);

            // Preserve indentation if possible. An update rewrites the line
            // and leaves it the same task — the whole point of the call is
            // that this row is the one being changed. Done before the child
            // ops because `applyOps` only ever touches lines below
            // `currentLine` (its scan starts at `taskLineIdx + 1` and stops at
            // the first line that is not a descendant), so this coordinate is
            // still this line afterwards.
            const originalIndent = Outline.indentOf(draft.lines[currentLine]);
            draft.rewrite(currentLine, originalIndent + Outline.dedent(newLine));

            // 子プロパティ行（- key:: value）の更新は同一 process 内で
            // 連続適用する（別 process だと originalText 失効と行番号
            // シフトが競合するため、タスク行と子行は1原子書き込み）。
            if (childOps.length > 0) {
                ChildPropertyLineEditor.applyOps(draft, currentLine, childOps);
            }

            return true;
        });
    }

    /** Nothing written: the file is not there. Told as `gone`, like a row that is not. */
    private refusedGone(target: PlannedTarget, origin: WriteOrigin): WriteOutcome {
        return fileGone(this.writes?.for(target.file, origin), target.file, target.subject);
    }

    async updateLine(filePath: string, at: EditorLine, newContent: string): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return fileGone(this.writes?.for(filePath, 'user'), filePath, at.text.trim());

        return processLines(this.app, file, this.writes?.for(filePath, 'user'), (draft, _eol, { row }) => {
            const lineNumber = row(at);
            if (lineNumber === null) return false;

            // Preserve original indentation
            const originalIndent = Outline.indentOf(draft.lines[lineNumber]);
            const newContentTrimmed = Outline.dedent(newContent);

            // The editor's own menu comes through here: a status change, and
            // the conversion of a bare checkbox into an inline task. Both
            // rewrite the row in place and leave it the row it was.
            draft.rewrite(lineNumber, originalIndent + newContentTrimmed);

            return true;
        });
    }

    /**
     * Insert one line below a coordinate, whatever that line is.
     *
     * The editor's menu duplicates a task through here, so the line written is
     * usually a copy of the line above it, word for word. Two rows a file
     * cannot tell apart is the shape the claim exists for: the write knows
     * which of them it made, and says so, where a reader comparing text has
     * nothing to go on but the order they appear in.
     */
    async insertLineAfterLine(filePath: string, at: EditorLine, newContent: string): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return fileGone(this.writes?.for(filePath, 'user'), filePath, at.text.trim());

        return processLines(this.app, file, this.writes?.for(filePath, 'user'), (draft, _eol, { row }) => {
            const lineNumber = row(at);
            if (lineNumber === null) return false;
            draft.splice(lineNumber + 1, 0, newContent);
            return true;
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
    async deleteLine(filePath: string, at: EditorLine): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return fileGone(this.writes?.for(filePath, 'user'), filePath, at.text.trim());

        return processLines(this.app, file, this.writes?.for(filePath, 'user'), (draft, _eol, { row }) => {
            const lineNumber = row(at);
            if (lineNumber === null) return false;
            draft.splice(lineNumber, 1);
            return true;
        });
    }

    /**
     * Take the row away with its subtree. Planned from the row and the subtree
     * the index read (`target.basis.subtree`), so a line written into the
     * subtree since, or a row rewritten from outside, is not taken with it.
     *
     * @returns the outcome. Not written means the file still holds the lines:
     * the caller must not report the task gone.
     */
    async deleteTaskFromFile(target: PlannedTarget): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(target.file);
        if (!(file instanceof TFile)) return this.refusedGone(target, 'user');

        return processLines(this.app, file, this.writes?.for(target.file, 'user'), (draft, _eol, { row }) => {
            const currentLine = row(target);
            if (currentLine === null) return false;

            const { childrenLines } = this.fileOps.collectChildrenFromLines(draft.lines, currentLine);

            // Delete task line + all children. What the claim carries is what
            // this splice actually removed, not `1 + childrenLines.length`
            // counted a second time: the two cannot disagree if only one of
            // them exists.
            draft.splice(currentLine, 1 + childrenLines.length);

            return true;
        });
    }

    /**
     * Do everything one operation does to one row of one file, as one write.
     *
     * A fire used to write each of its effects on its own — the next
     * instance, then the consumed command — and each write asked where the
     * row stood. The second asked after the first had moved it, and found it
     * only because the line just written read differently from the one that
     * fired: held by value, not by construction. Here the row is located once,
     * every effect after the first takes its line from that answer carried
     * across the splices before it (see `WriteSession.locate`), and nothing
     * searches the file a second time.
     *
     * One write also settles what the separate ones could not: either every
     * effect lands, or none does. A row that cannot be placed leaves the file
     * byte-identical — no next instance beside a command that was not
     * consumed, which would fire again.
     *
     * Where each line goes is read off the lines as they stand when the
     * effect is applied: the sibling group, the subtree, the indentation. The
     * separate writes did the same, each against the file the previous one
     * left, so the lines written are the same.
     */
    async applyToTask(
        target: PlannedTarget,
        ops: readonly TaskOp[],
        opts: { tellRefusal?: boolean } = {},
    ): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(target.file);
        const told = this.writes?.for(target.file, 'flow');
        // A caller that tells the refusal itself, in words of its own, has it
        // from the outcome; telling it here too would be the same news twice.
        const channel = told && opts.tellRefusal === false ? { ...told, refused: () => { } } : told;
        if (!(file instanceof TFile)) return fileGone(channel, target.file, target.subject);

        return processLines(this.app, file, channel, (draft, _eol, { row, refuse }) => {
            // Asked before any op, so the plan is checked against the lines as
            // they were handed in — and checked at all, whatever the ops are.
            if (row(target) === null) return false;
            for (const op of ops) {
                const line = row(target);
                if (line === null) return false;
                if (!this.applyOp(draft, line, op)) {
                    return refuse({ kind: 'unplaceable' }, target.subject);
                }
            }
            return true;
        });
    }

    /**
     * Apply one op to the row at `line`. False when the op's lines have
     * nowhere in the body to go: the write is then refused whole, and the
     * ops before this one are not written either.
     */
    private applyOp(draft: LineDraft, line: number, op: TaskOp): boolean {
        const lines = draft.lines;
        switch (op.kind) {
            case 'insert-instance': {
                const at = Placement.groupHead(lines, line);
                if (at === null) return false;
                const rendered = renderFlowInstance(this.fileOps, lines, line, op.insert);
                draft.splice(at, 0, ...rendered);
                return true;
            }
            case 'strip-flow': {
                // Every flow line is below the row (the scan starts past it
                // and stops at the first line that is not a descendant), so
                // taking them out leaves the row where it is.
                const flowIndices = collectFlowLineIndicesInFile(lines, line);
                for (let i = flowIndices.length - 1; i >= 0; i--) {
                    draft.splice(flowIndices[i], 1);
                }
                const indent = Outline.indentOf(lines[line]);
                // Losing `==>` rewrites the text; the row is the one that fired.
                draft.rewrite(line, indent + Outline.dedent(op.text));
                return true;
            }
            case 'move-to-end': {
                // The row and what goes with it are carried to the end — where
                // an append puts lines, the file's final terminator kept after
                // them — and then its whole subtree is taken away from where
                // it was. Everything is read before either: carrying to the
                // end leaves every line above it where it is.
                const at = Placement.end(lines);
                if (at === null) return false;
                const [head, ...rest] = splitLines(op.text).lines;
                const children = this.childrenToCarry(lines, line);
                const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, line);
                draft.carry(at, [{ from: line, text: head }]);
                // A line past the row's first is one the archive wrote, not
                // one that was here.
                if (rest.length > 0) draft.splice(at + 1, 0, ...rest);
                draft.carry(at + 1 + rest.length, children);
                draft.splice(line, 1 + childrenLines.length);
                return true;
            }
            case 'remove': {
                const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, line);
                draft.splice(line, 1 + childrenLines.length);
                return true;
            }
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
    async insertLineAfterTask(task: Task, lineBody: string): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return fileGone(this.writes?.for(task.file, 'user'), task.file, subjectOf(task));

        return processLines(this.app, file, this.writes?.for(task.file, 'user'), (draft, _eol, { row, refuse }) => {
            const lines = draft.lines;
            const currentLine = row(recordedOn(task));
            if (currentLine === null) return false;

            const indent = FileOperations.resolveChildIndent(lines, currentLine);
            const insertIndex = Placement.afterSubtree(lines, currentLine);
            if (insertIndex === null) return refuse({ kind: 'unplaceable' }, subjectOf(task));
            draft.splice(insertIndex, 0, indent + Outline.dedent(lineBody));

            return true;
        });
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
     * siblings that directly follow the task (see `Placement.afterCompletedRun`) so a
     * new session record joins the end of a chronological run instead of
     * splitting it. Deciding *where* belongs here rather than in the caller
     * because the answer needs the file's own lines, and reading them outside
     * this `vault.process` would reintroduce the gap between "what the index
     * last saw" and "what the file holds now".
     *
     */
    async insertSiblingAfterTask(
        task: Task,
        lineBody: string,
        opts: { afterCompletedRun?: boolean } = {}
    ): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return fileGone(this.writes?.for(task.file, 'user'), task.file, subjectOf(task));

        return processLines(this.app, file, this.writes?.for(task.file, 'user'), (draft, _eol, { row, refuse }) => {
            const lines = draft.lines;
            const currentLine = row(recordedOn(task));
            if (currentLine === null) return false;

            const indent = Outline.indentOf(lines[currentLine]);
            const insertIndex = opts.afterCompletedRun
                ? Placement.afterCompletedRun(lines, currentLine)
                : Placement.afterSubtree(lines, currentLine);
            if (insertIndex === null) return refuse({ kind: 'unplaceable' }, subjectOf(task));
            draft.splice(insertIndex, 0, indent + Outline.dedent(lineBody));

            return true;
        });
    }

    /**
     * Insert `lineBody` as the first child of a task (right after the task line).
     * Used for timer/pomodoro records that should appear at the top of children.
     *
     * As with {@link insertLineAfterTask}, the indent is resolved here from the
     * task's existing children rather than supplied by the caller.
     */
    async insertLineAsFirstChild(task: Task, lineBody: string): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return fileGone(this.writes?.for(task.file, 'user'), task.file, subjectOf(task));

        return processLines(this.app, file, this.writes?.for(task.file, 'user'), (draft, _eol, { row, refuse }) => {
            const lines = draft.lines;
            const currentLine = row(recordedOn(task));
            if (currentLine === null) return false;

            const indent = FileOperations.resolveChildIndent(lines, currentLine);

            // Insert directly after the task line (as first child)
            const insertIndex = Placement.firstChild(lines, currentLine);
            if (insertIndex === null) return refuse({ kind: 'unplaceable' }, subjectOf(task));
            draft.splice(insertIndex, 0, indent + Outline.dedent(lineBody));

            return true;
        });
    }

    /**
     * @returns the outcome.
     *
     * The file that does not exist yet is the one write here with nothing to
     * claim: `vault.create` writes the whole file, so every row in it is new
     * and the scan that reads it has no previous generation to confuse them
     * with. A claim would say what the ledger's silence already says.
     */
    async appendTaskToFile(filePath: string, content: string, origin: WriteOrigin): Promise<WriteAt> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        const subject = splitLines(content).lines[0].trim();
        const channel = this.writes?.for(filePath, origin);

        if (!file) {
            const created = await createFile(this.app, filePath, channel, subject, async () => {
                await this.fileOps.ensureDirectoryExists(filePath);
                return content;
            });
            return created.written ? { ...created, line: 0 } : created;
        }

        // A folder by that name: there is no note to append to.
        if (!(file instanceof TFile)) return fileGone(channel, filePath, subject);

        // The appended text is built with LF; splitting it here lets the file's
        // own terminator go back between every line, its own included.
        let inserted = -1;
        const outcome = await processLines(this.app, file, channel, (draft, _eol, { refuse }) => {
            const at = Placement.end(draft.lines);
            if (at === null) return refuse({ kind: 'unplaceable' }, subject);
            draft.splice(at, 0, ...splitLines(content).lines);
            inserted = at;
            return true;
        });
        return outcome.written ? { ...outcome, line: inserted } : outcome;
    }

    /**
     * Collect the task's children from `lines`, strip block IDs, and re-indent
     * them relative to the parent. Returns the children lines ready to append.
     * Shared by both the same-file (atomic) and cross-file paths of
     * `appendTaskWithChildren` so the collection logic lives in one place.
     *
     * Each comes with the index of the line it is made from: a move within one
     * file carries them rather than copying them (see `LineEdits.carry`).
     */
    private childrenToCarry(lines: readonly string[], currentLine: number): Array<{ from: number; text: string }> {

        // Parent's original indentation prefix (preserves tabs/spaces)
        const parentIndent = Outline.indentOf(lines[currentLine]);
        // The task's own direct `- ==>` flow lines are consumed by the fire —
        // they must not travel to the archive. Descendant tasks' flow lines
        // are NOT direct (structural-parent rule) and stay as templates.
        const flowAbs = new Set(collectFlowLineIndicesInFile(lines, currentLine));
        const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);
        const kept = childrenLines
            .map((text, i) => ({ from: currentLine + 1 + i, text }))
            .filter(child => !flowAbs.has(child.from));
        const cleaned = this.fileOps.stripBlockIds(kept.map(child => child.text));
        const adjusted = FileOperations.adjustChildIndentation(cleaned, parentIndent);
        return kept.map((child, i) => ({ from: child.from, text: adjusted[i] }));
    }

    /**
     * The half of a move to another file that writes to the destination: the
     * row, as `content`, and its children, re-indented under it, appended to
     * `destPath`. The children are read from the source here; the source is
     * not written. Taking the original away is the caller's next write, to the
     * source, and it is made only once this one has landed (see
     * `FlowExecutor.executeFlow`). A move within one file is not this: it is
     * one write that carries the row (`move-to-end` in {@link applyToTask}).
     *
     * The two files cannot be one write — Obsidian's `process` is per file —
     * so a source edited between this read and the caller's write can leave
     * the task in both. The caller's write is checked against the subtree
     * answered here, so an edit in between is refused there rather than
     * taken away unseen. Handing a move from one file to the other is F8's.
     *
     * The appended lines are claimed as new rows: the move drops the task's
     * `^id` on the way (see `FlowPlanner`'s archived copy), and a row in
     * another file is another row to the index.
     *
     * @returns the source row and its subtree as they read when they were
     * archived, verbatim; null when nothing was written — the source row could
     * not be placed or no longer reads as the move was planned from (told to
     * the user as a refusal), or the destination is not a file.
     */
    async appendTaskWithChildren(
        destPath: string,
        content: string,
        source: PlannedTarget,
    ): Promise<readonly string[] | null> {
        const sourceFile = this.app.vault.getAbstractFileByPath(source.file);
        const channel = this.writes?.for(source.file, 'flow');
        // The source is only read, so its target is asked of the channel
        // directly rather than through a write, and checked against its basis
        // the way a write's is (`WriteSession.row`). A source row that cannot
        // be placed is not archived at all: an archive of the parent alone
        // would lose the children once the original goes.
        if (!(sourceFile instanceof TFile)) {
            channel?.refused({ file: source.file, reason: { kind: 'gone' }, subject: source.subject });
            return null;
        }
        const sourceLines = splitLines(await this.app.vault.read(sourceFile)).lines;
        const located = channel ? channel.locate(sourceLines, source.ref) : { kind: 'gone' as const };
        const unplanned = located.kind === 'at' && !readsAsPlanned(sourceLines, located.line, source.basis);
        if (located.kind !== 'at' || unplanned) {
            const reason = located.kind === 'at' || located.kind === 'outdated' ? { kind: 'changed' as const } : located;
            logWarn(`[InlineTaskWriter] move source not placed: ${source.file} ${reason.kind}`);
            channel?.refused({ file: source.file, reason, subject: source.subject });
            return null;
        }
        const children = this.childrenToCarry(sourceLines, located.line).map(child => child.text);
        const { childrenLines } = this.fileOps.collectChildrenFromLines(sourceLines, located.line);

        const fullContent = [content, ...children].join('\n');
        if (!(await this.appendTaskToFile(destPath, fullContent, 'flow')).written) return null;
        return sourceLines.slice(located.line, located.line + 1 + childrenLines.length);
    }
}
