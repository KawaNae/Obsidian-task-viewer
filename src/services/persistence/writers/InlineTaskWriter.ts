import { type App, TFile } from 'obsidian';
import type { Task } from '../../../types';
import { TaskParser } from '../../parsing/TaskParser';
import { TaskLineClassifier } from '../../parsing/utils/TaskLineClassifier';
import { collectFlowLineIndicesInFile, flowLineTail } from '../../flow/FlowLineScanner';
import { FileOperations } from '../utils/FileOperations';
import { ChildPropertyLineEditor } from '../utils/ChildPropertyLineEditor';
import type { PropertyOp } from '../PropertyUpdatePlanner';
import { renderFlowInstance } from '../FlowInstanceLines';
import { collectGenBlocks } from '../../parsing/gen/GenBlockCollector';
import {
    appendLines, processLines, splitLines,
    type EditorLine, type LineEdits, type Refusal, type WriteOutcome,
} from '../../../utils/FileLines';
import type { WriteObserver } from '../WriteObserver';
import { refOf, subjectOf, type RowBasis, type WriteTarget } from '../TaskRefs';
import type { TaskOp } from '../TaskOps';
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
            this.writes?.for(task.file)?.refused({ file: task.file, reason: { kind: 'gone' }, subject: subjectOf(task) });
            return false;
        }

        return processLines(this.app, file, (lines, _eol, { edits, lineOf }) => {
            const currentLine = lineOf(refOf(task), subjectOf(task));
            if (currentLine === null) return null;

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
        }, this.writes?.for(task.file)).then(outcome => outcome.written);
    }

    async updateLine(filePath: string, at: EditorLine, newContent: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;
        const lineNumber = at.line;

        await processLines(this.app, file, (lines, _eol, { edits, refuse }) => {
            if (lines[lineNumber] !== at.text) return refuse({ kind: 'changed' }, at.text.trim());

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

    /**
     * Insert one line below a coordinate, whatever that line is.
     *
     * The editor's menu duplicates a task through here, so the line written is
     * usually a copy of the line above it, word for word. Two rows a file
     * cannot tell apart is the shape the claim exists for: the write knows
     * which of them it made, and says so, where a reader comparing text has
     * nothing to go on but the order they appear in.
     */
    async insertLineAfterLine(filePath: string, at: EditorLine, newContent: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;
        const lineNumber = at.line;

        await processLines(this.app, file, (lines, _eol, { edits, refuse }) => {
            if (lines[lineNumber] !== at.text) return refuse({ kind: 'changed' }, at.text.trim());
            edits.splice(lineNumber + 1, 0, newContent);
            return lines;
        }, this.writes?.for(filePath));
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
    async deleteLine(filePath: string, at: EditorLine): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;
        const lineNumber = at.line;

        await processLines(this.app, file, (lines, _eol, { edits, refuse }) => {
            if (lines[lineNumber] !== at.text) return refuse({ kind: 'changed' }, at.text.trim());
            edits.splice(lineNumber, 1);
            return lines;
        }, this.writes?.for(filePath));
    }

    /**
     * @returns whether the task's lines were found and removed. A `false` means
     * the file still holds them — the caller must not report the task gone.
     */
    async deleteTaskFromFile(task: Task): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) {
            this.writes?.for(task.file)?.refused({ file: task.file, reason: { kind: 'gone' }, subject: subjectOf(task) });
            return false;
        }

        return processLines(this.app, file, (lines, _eol, { edits, lineOf }) => {
            const currentLine = lineOf(refOf(task), subjectOf(task));
            if (currentLine === null) return null;

            const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);

            // Delete task line + all children. What the claim carries is what
            // this splice actually removed, not `1 + childrenLines.length`
            // counted a second time: the two cannot disagree if only one of
            // them exists.
            edits.splice(currentLine, 1 + childrenLines.length);

            return lines;
        }, this.writes?.for(task.file)).then(outcome => outcome.written);
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
        target: WriteTarget & { basis?: RowBasis },
        ops: readonly TaskOp[],
        opts: { tellRefusal?: boolean } = {},
    ): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(target.file);
        const told = this.writes?.for(target.file);
        // A caller that tells the refusal itself, in words of its own, has it
        // from the outcome; telling it here too would be the same news twice.
        const channel = told && opts.tellRefusal === false ? { ...told, refused: () => { } } : told;
        if (!(file instanceof TFile)) {
            const refused: Refusal = { file: target.file, reason: { kind: 'gone' }, subject: target.subject };
            channel?.refused(refused);
            return { written: false, refused, made: [] };
        }

        return processLines(this.app, file, (lines, _eol, { edits, lineOf, refuse }) => {
            for (const [i, op] of ops.entries()) {
                const line = lineOf(target.ref, target.subject);
                if (line === null) return null;
                // Asked of the lines as they were handed in, before any op
                // has moved them: that is what the plan was made against.
                if (i === 0 && target.basis && !this.readsAsPlanned(lines, line, target.basis)) {
                    return refuse({ kind: 'changed' }, target.subject);
                }
                this.applyOp(lines, line, op, edits);
            }
            return lines;
        }, channel);
    }

    /**
     * Whether the row at `line` still reads as the operation's plan read it:
     * the row itself, its own command lines, the generation blocks the plan
     * read, and — for the source of a move away — its whole subtree as it was
     * written to the destination.
     *
     * A plan made from a copy the file has moved on from would otherwise be
     * written over what moved it: a strip putting the row back to an older
     * text, a fire consuming a command line edited since, a move taking a
     * child edited after the archive was written.
     */
    private readsAsPlanned(lines: readonly string[], line: number, basis: RowBasis): boolean {
        if (lines[line].trimStart() !== basis.text.trimStart()) return false;
        const commands = collectFlowLineIndicesInFile([...lines], line).map(i => flowLineTail(lines[i]));
        if (commands.length !== basis.commands.length) return false;
        if (commands.some((command, i) => command !== basis.commands[i])) return false;
        if (basis.subtree) {
            const { childrenLines } = this.fileOps.collectChildrenFromLines([...lines], line);
            const subtree = lines.slice(line, line + 1 + childrenLines.length);
            if (subtree.length !== basis.subtree.length) return false;
            if (subtree.some((text, i) => text !== basis.subtree![i])) return false;
        }
        if (basis.blocks) {
            const current = collectGenBlocks([...lines]).blocks;
            for (const block of basis.blocks) {
                const body = current.get(block.name)?.body;
                if (!body || body.length !== block.body.length) return false;
                if (body.some((text, i) => text !== block.body[i])) return false;
            }
        }
        return true;
    }

    private applyOp(lines: string[], line: number, op: TaskOp, edits: LineEdits): void {
        switch (op.kind) {
            case 'insert-instance': {
                const rendered = renderFlowInstance(this.fileOps, lines, line, op.insert);
                edits.splice(this.fileOps.findSiblingGroupStart(lines, line), 0, ...rendered);
                return;
            }
            case 'strip-flow': {
                // Every flow line is below the row (the scan starts past it
                // and stops at the first line that is not a descendant), so
                // taking them out leaves the row where it is.
                const flowIndices = collectFlowLineIndicesInFile(lines, line);
                for (let i = flowIndices.length - 1; i >= 0; i--) {
                    edits.splice(flowIndices[i], 1);
                }
                const indent = lines[line].match(/^(\s*)/)?.[1] || '';
                lines[line] = indent + op.text.trim();
                // Losing `==>` rewrites the text; the row is the one that fired.
                edits.replaced(line);
                return;
            }
            case 'move-to-end': {
                // The row and what goes with it are carried to the end — past
                // the file's final terminator, where an append puts lines —
                // and then its whole subtree is taken away from where it was.
                // Everything is read before either: carrying to the end
                // leaves every line above it where it is.
                const [head, ...rest] = splitLines(op.text).lines;
                const children = this.childrenToCarry(lines, line);
                const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, line);
                const at = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
                edits.splice(at, lines.length - at);
                edits.carry(at, [{ from: line, text: head }]);
                // A line past the row's first is one the archive wrote, not
                // one that was here.
                if (rest.length > 0) edits.splice(at + 1, 0, ...rest);
                edits.carry(at + 1 + rest.length, children);
                edits.splice(line, 1 + childrenLines.length);
                return;
            }
            case 'remove': {
                const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, line);
                edits.splice(line, 1 + childrenLines.length);
                return;
            }
        }
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
        if (!(file instanceof TFile)) {
            this.writes?.for(task.file)?.refused({ file: task.file, reason: { kind: 'gone' }, subject: subjectOf(task) });
            return -1;
        }

        let insertedLineIndex = -1;

        await processLines(this.app, file, (lines, _eol, { edits, lineOf }) => {
            const currentLine = lineOf(refOf(task), subjectOf(task));
            if (currentLine === null) return null;

            const indent = FileOperations.resolveChildIndent(lines, currentLine);
            const insertIndex = this.subtreeEnd(lines, currentLine);
            edits.splice(insertIndex, 0, indent + lineBody.trim());
            insertedLineIndex = insertIndex;

            return lines;
        }, this.writes?.for(task.file));

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
        if (!(file instanceof TFile)) {
            this.writes?.for(task.file)?.refused({ file: task.file, reason: { kind: 'gone' }, subject: subjectOf(task) });
            return -1;
        }

        let insertedLineIndex = -1;

        await processLines(this.app, file, (lines, _eol, { edits, lineOf }) => {
            const currentLine = lineOf(refOf(task), subjectOf(task));
            if (currentLine === null) return null;

            const indent = lines[currentLine].match(/^(\s*)/)?.[1] ?? '';
            const anchor = opts.afterCompletedRun
                ? this.completedRunEnd(lines, currentLine)
                : currentLine;

            const insertIndex = this.subtreeEnd(lines, anchor);
            edits.splice(insertIndex, 0, indent + lineBody.trim());
            insertedLineIndex = insertIndex;

            return lines;
        }, this.writes?.for(task.file));

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
        if (!(file instanceof TFile)) {
            this.writes?.for(task.file)?.refused({ file: task.file, reason: { kind: 'gone' }, subject: subjectOf(task) });
            return -1;
        }

        let insertedLineIndex = -1;

        await processLines(this.app, file, (lines, _eol, { edits, lineOf }) => {
            const currentLine = lineOf(refOf(task), subjectOf(task));
            if (currentLine === null) return null;

            const indent = FileOperations.resolveChildIndent(lines, currentLine);

            // Insert directly after the task line (as first child)
            const insertIndex = currentLine + 1;
            edits.splice(insertIndex, 0, indent + lineBody.trim());
            insertedLineIndex = insertIndex;

            return lines;
        }, this.writes?.for(task.file));

        return insertedLineIndex;
    }

    /**
     * @returns the 0-based line the task landed on, or -1 when nothing was written.
     *
     * The file that does not exist yet is the one write here with nothing to
     * claim: `vault.create` writes the whole file, so every row in it is new
     * and the scan that reads it has no previous generation to confuse them
     * with. A claim would say what the ledger's silence already says.
     */
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
        await processLines(this.app, file, (lines, _eol, { edits }) => {
            insertedLine = appendLines(lines, splitLines(content).lines, edits);
            return lines;
        }, this.writes?.for(filePath));
        return insertedLine;
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
    private childrenToCarry(lines: string[], currentLine: number): Array<{ from: number; text: string }> {

        // Parent's original indentation prefix (preserves tabs/spaces)
        const parentIndent = lines[currentLine].match(/^\s*/)?.[0] ?? '';
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
        source: WriteTarget & { basis?: RowBasis },
    ): Promise<readonly string[] | null> {
        const sourceFile = this.app.vault.getAbstractFileByPath(source.file);
        const channel = this.writes?.for(source.file);
        // The source is only read, so its target is asked of the channel
        // directly rather than through a write. A source row that cannot be
        // placed is not archived at all: an archive of the parent alone would
        // lose the children once the original goes.
        if (!(sourceFile instanceof TFile)) {
            channel?.refused({ file: source.file, reason: { kind: 'gone' }, subject: source.subject });
            return null;
        }
        const sourceLines = splitLines(await this.app.vault.read(sourceFile)).lines;
        const located = channel ? channel.locate(sourceLines, source.ref) : { kind: 'gone' as const };
        const unplanned = located.kind === 'at' && !located.edited
            && source.basis !== undefined && !this.readsAsPlanned(sourceLines, located.line, source.basis);
        if (located.kind !== 'at' || located.edited || unplanned) {
            const reason = located.kind === 'at' ? { kind: 'changed' as const } : located;
            logWarn(`[InlineTaskWriter] move source not placed: ${source.file} ${reason.kind}`);
            channel?.refused({ file: source.file, reason, subject: source.subject });
            return null;
        }
        const children = this.childrenToCarry(sourceLines, located.line).map(child => child.text);
        const { childrenLines } = this.fileOps.collectChildrenFromLines(sourceLines, located.line);

        const fullContent = [content, ...children].join('\n');
        if ((await this.appendTaskToFile(destPath, fullContent)) < 0) return null;
        return sourceLines.slice(located.line, located.line + 1 + childrenLines.length);
    }
}
