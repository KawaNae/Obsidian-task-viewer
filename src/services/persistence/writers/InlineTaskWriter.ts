import { type App, TFile } from 'obsidian';
import type { Task } from '../../../types';
import { TaskParser } from '../../parsing/TaskParser';
import { collectFlowLineIndices, collectFlowLineIndicesInFile } from '../../parsing/utils/FlowLineScanner';
import { FileOperations } from '../utils/FileOperations';
import { ChildPropertyLineEditor } from '../utils/ChildPropertyLineEditor';
import { Block, Placement, type PlacedLine } from '../utils/Placement';
import type { PropertyOp } from '../PropertyUpdatePlanner';
import { flowInstanceHead, renderFlowInstance } from '../FlowInstanceLines';
import {
    createFile, fileGone, processLines, splitLines,
    type EditorLine, type EditorSubtree, type LineDraft, type NamedRow, type Refusal, type WriteAt, type WriteOrigin, type WriteOutcome,
    type WriteSession,
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
     * Rewrite the row as `updatedTask`, and its property lines by `childOps`
     * — and, with `fire`, fire its flow in the same write: a card's, the
     * API's or a timer's completion of the row (`TaskIndex.writeUpdate`).
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
    async updateTaskInFile(target: PlannedTarget, updatedTask: Task, childOps: PropertyOp[] = [], fire?: TaskOp): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(target.file);
        if (!(file instanceof TFile)) return this.refusedGone(target, 'user');

        // 子プロパティ行（- key:: value）の更新は同一 process 内で
        // 連続適用する（別 process だと originalText 失効と行番号
        // シフトが競合するため、タスク行と子行は1原子書き込み）。
        const update: TaskOp = { kind: 'update', text: TaskParser.format(updatedTask), childOps };
        return processLines(this.app, file, this.writes?.for(target.file, 'user'),
            (draft, _eol, session) => this.applyOps(draft, session, target, fire ? [update, fire] : [update]));
    }

    /** Nothing written: the file is not there. Told as `gone`, like a row that is not. */
    private refusedGone(target: PlannedTarget, origin: WriteOrigin): WriteOutcome {
        return fileGone(this.writes?.for(target.file, origin), target.file, target.subject);
    }

    /** Rewrite the editor's line as `newContent`, and with `fire`, fire its flow in the same write. */
    async updateLine(filePath: string, at: EditorLine, newContent: string, fire?: TaskOp): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return fileGone(this.writes?.for(filePath, 'user'), filePath, at.text.trim());

        // The editor's own menu comes through here: a status change, and
        // the conversion of a bare checkbox into an inline task. Both
        // rewrite the row in place and leave it the row it was.
        const update: TaskOp = { kind: 'update', text: newContent };
        return processLines(this.app, file, this.writes?.for(filePath, 'user'),
            (draft, _eol, session) => this.applyOps(draft, session, at, fire ? [update, fire] : [update]));
    }

    /**
     * Apply `ops` to the row at a coordinate, planned from the row and its
     * subtree as `at` holds them: the source's write of a move to another
     * file, made once the destination landed, to the row the completing
     * write left (`FlowExecutor.finishAway`). A caller that tells a refusal
     * in its own words has it from the outcome, as `applyToTask` does.
     */
    async applyToLine(
        filePath: string,
        at: EditorSubtree,
        ops: readonly TaskOp[],
        opts: { tellRefusal?: boolean } = {},
    ): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        const told = this.writes?.for(filePath, 'flow');
        const channel = told && opts.tellRefusal === false ? { ...told, refused: () => { } } : told;
        if (!(file instanceof TFile)) return fileGone(channel, filePath, at.text.trim());
        return processLines(this.app, file, channel, (draft, _eol, session) => this.applyOps(draft, session, at, ops));
    }

    /**
     * Put `newContent` in as the next sibling of the line at a coordinate:
     * past its subtree, spelled as that line is: the line written is a copy
     * (`Placement.copyOf`).
     *
     * The editor's menu duplicates a task through here, so the line written is
     * usually a copy of the line above it, word for word. Put just below it,
     * the copy took the line's children for its own (P1's counterexample 5).
     * Two rows a file cannot tell apart is the shape the claim exists for: the
     * write knows which of them it made, and says so, where a reader comparing
     * text has nothing to go on but the order they appear in.
     */
    async insertLineAfterLine(filePath: string, at: EditorLine, newContent: string): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return fileGone(this.writes?.for(filePath, 'user'), filePath, at.text.trim());

        return processLines(this.app, file, this.writes?.for(filePath, 'user'), (draft, _eol, { row }) => {
            const lineNumber = row(at);
            if (lineNumber === null) return false;
            draft.put(Placement.copyOf(draft.lines, lineNumber, 'below', newContent), Block.line(newContent));
            return true;
        });
    }

    /**
     * Take the line at a coordinate away with its subtree, as a card's
     * delete takes a task (the user's decision, 2026-09-24).
     *
     * This path is reached from the editor's context menu on a raw checkbox,
     * so the line is not necessarily a task. It used to take the one line
     * and leave the lines under it, and a property or `==>` line under it
     * went on the task above.
     *
     * What it takes is what the editor showed when the menu was opened: the
     * line and its subtree (`at.subtree`). A child added or rewritten since,
     * which the user has not seen, is not taken with it: the write is refused
     * as `changed` (`WriteSession.row`).
     */
    async deleteLine(filePath: string, at: EditorSubtree): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return fileGone(this.writes?.for(filePath, 'user'), filePath, at.text.trim());

        return processLines(this.app, file, this.writes?.for(filePath, 'user'), (draft, _eol, { row }) => {
            const lineNumber = row(at);
            if (lineNumber === null) return false;
            const { childrenLines } = this.fileOps.collectChildrenFromLines(draft.lines, lineNumber);
            draft.splice(lineNumber, 1 + childrenLines.length);
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

        return processLines(this.app, file, channel, (draft, _eol, session) => this.applyOps(draft, session, target, ops));
    }

    /**
     * Apply `ops` in order to the row `target` names, inside a write: the
     * one loop every write of ops runs, to a file (`applyToTask`) or to an
     * editor's lines (`editLines`). Answers false when the row has no line,
     * which the session has refused with its reason.
     *
     * The row is asked for before any op, so the plan is checked against the
     * lines as they were handed in — and checked at all, whatever the ops are
     * — and again before each op, its line carried across the ops before it.
     * A `fire` is planned where it stands, from the lines the ops before it
     * left, and the ops it answers take its place.
     */
    applyOps(draft: LineDraft, session: WriteSession, target: NamedRow | EditorLine, ops: readonly TaskOp[]): boolean {
        if (session.row(target) === null) return false;
        const queue = [...ops];
        for (let op = queue.shift(); op !== undefined; op = queue.shift()) {
            const line = session.row(target);
            if (line === null) return false;
            if (op.kind === 'fire') queue.unshift(...op.plan(draft.lines, line));
            else this.applyOp(draft, line, op);
        }
        return true;
    }

    /**
     * Apply one op to the row at `line`. Whether the lines it puts in read
     * as put, and every other line as it did, is asked of the whole write
     * once every op is applied (`processLines`): refused, none of the ops is
     * written.
     */
    private applyOp(draft: LineDraft, line: number, op: Exclude<TaskOp, { kind: 'fire' }>): void {
        const lines = draft.lines;
        switch (op.kind) {
            case 'update': {
                // The row is the one being changed, and stays the same task.
                // Done before the property lines, which are all below it, so
                // the coordinate is still this line afterwards.
                draft.rewrite(line, Outline.indentOf(lines[line]) + Outline.dedent(op.text));
                ChildPropertyLineEditor.applyOps(draft, line, [...(op.childOps ?? [])]);
                return;
            }
            case 'insert-instance': {
                draft.put(Placement.groupHead(lines, line, flowInstanceHead(op.insert)), renderFlowInstance(this.fileOps, lines, line, op.insert));
                return;
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
                return;
            }
            case 'move-to-end': {
                // The row and what goes with it are carried to the end — where
                // an append puts lines, the file's final terminator kept after
                // them — and then its whole subtree is taken away from where
                // it was. Everything is read before either: carrying to the
                // end leaves every line above it where it is.
                const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, line);
                draft.put(Placement.end(lines), this.carriedWith(lines, line, op.text, true));
                draft.splice(line, 1 + childrenLines.length);
                return;
            }
            case 'remove': {
                const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, line);
                draft.splice(line, 1 + childrenLines.length);
                return;
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

        return processLines(this.app, file, this.writes?.for(task.file, 'user'), (draft, _eol, { row }) => {
            const currentLine = row(recordedOn(task));
            if (currentLine === null) return false;

            draft.put(Placement.lastChild(draft.lines, currentLine, lineBody), Block.line(lineBody));

            return true;
        });
    }

    /**
     * Insert `lineBody` just past the task's subtree — the task gains a next
     * sibling. The line is a new one, not a copy of the task: it is spelled
     * as the item next to it is (`Placement.afterSubtree`).
     *
     * The spot is read from the *resolved* lines rather than from
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

        return processLines(this.app, file, this.writes?.for(task.file, 'user'), (draft, _eol, { row }) => {
            const lines = draft.lines;
            const currentLine = row(recordedOn(task));
            if (currentLine === null) return false;

            const spot = opts.afterCompletedRun
                ? Placement.afterCompletedRun(lines, currentLine, lineBody)
                : Placement.afterSubtree(lines, currentLine, lineBody);
            draft.put(spot, Block.line(lineBody));

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

        return processLines(this.app, file, this.writes?.for(task.file, 'user'), (draft, _eol, { row }) => {
            const currentLine = row(recordedOn(task));
            if (currentLine === null) return false;

            // Directly below the task line, past its own text that goes on.
            draft.put(Placement.firstChild(draft.lines, currentLine, lineBody), Block.line(lineBody));

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
        // The appended text is built with LF; splitting it here lets the file's
        // own terminator go back between every line, its own included. The
        // lines are to read as they read by themselves.
        return this.appendBlock(filePath, Block.read(splitLines(content).lines), origin);
    }

    /** Append `block` to the note, or make the note of it (see {@link appendTaskToFile}). */
    private async appendBlock(filePath: string, block: readonly PlacedLine[], origin: WriteOrigin): Promise<WriteAt> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        const subject = block[0].text.trim();
        const channel = this.writes?.for(filePath, origin);

        if (!file) {
            const created = await createFile(this.app, filePath, channel, subject, async () => {
                await this.fileOps.ensureDirectoryExists(filePath);
                // At the top of the note, as a put at its end would write it.
                return Block.at(block, '').map(line => line.text).join('\n');
            });
            return created.written ? { ...created, line: 0 } : created;
        }

        // A folder by that name: there is no note to append to.
        if (!(file instanceof TFile)) return fileGone(channel, filePath, subject);

        let inserted = -1;
        const outcome = await processLines(this.app, file, channel, (draft) => {
            const spot = Placement.end(draft.lines);
            draft.put(spot, block);
            inserted = spot.at;
            return true;
        }, subject);
        return outcome.written ? { ...outcome, line: inserted } : outcome;
    }

    /**
     * The row, written as `head`, and the lines of its subtree that go with
     * it on a move: to read, once written, as they read under the row
     * (`Block.of`), written as they stand, the row's own indentation before
     * `head` (`format` writes none), each line of its subtree its block ID
     * taken off; the put writes them at the spot (`LineDraft.put`). Shared by the
     * move within one file, which carries the lines (`carried`), and the move
     * to another, which writes them anew.
     *
     * The task's own direct `- ==>` flow lines are consumed by the fire and
     * do not travel to the archive. Descendant tasks' flow lines are NOT
     * direct (structural-parent rule) and stay as templates. A line that
     * stood under one of them has lost its item: a task, command or property
     * there is not written (`checkWrite`).
     */
    private carriedWith(lines: readonly string[], currentLine: number, head: string, carried: boolean): PlacedLine[] {
        const outline = Outline.read(lines);
        const flowAbs = new Set(collectFlowLineIndices(outline, currentLine));
        const rows = [currentLine];
        for (let row = currentLine + 1; row < outline.subtreeEnd(currentLine); row++) {
            if (!flowAbs.has(row)) rows.push(row);
        }
        const texts = [Outline.indentOf(lines[currentLine]) + Outline.dedent(head),
            ...this.fileOps.stripBlockIds(rows.slice(1).map(row => lines[row]))];
        return Block.of(outline, rows, texts, carried);
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
        const archive = this.archiveOf(sourceLines, located.line, content);
        if (!(await this.appendArchive(destPath, archive.block))) return null;
        return archive.subtree;
    }

    /**
     * What a move to another file writes to the destination for the row at
     * `line` of `lines`: the row as `content` and the lines of its subtree
     * that go with it (`block`, new lines to the destination), and the row's
     * whole subtree as `lines` hold it (`subtree`), which is what taking the
     * original away plans from.
     */
    archiveOf(lines: readonly string[], line: number, content: string): { block: PlacedLine[]; subtree: string[] } {
        const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, line);
        return {
            block: this.carriedWith(lines, line, content, false),
            subtree: lines.slice(line, line + 1 + childrenLines.length),
        };
    }

    /**
     * Append a move's archive (`archiveOf`) to `destPath`, or make the note
     * of it: whether it was written. A refusal is told by the write layer.
     */
    async appendArchive(destPath: string, block: readonly PlacedLine[]): Promise<boolean> {
        return (await this.appendBlock(destPath, block, 'flow')).written;
    }
}
