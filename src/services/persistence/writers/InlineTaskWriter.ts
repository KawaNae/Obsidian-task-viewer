import { type App, TFile } from 'obsidian';
import type { Task } from '../../../types';
import { TaskParser } from '../../parsing/TaskParser';
import { collectFlowLineIndices, collectFlowLineIndicesInFile } from '../../parsing/utils/FlowLineScanner';
import { FileOperations } from '../utils/FileOperations';
import { ChildPropertyLineEditor } from '../utils/ChildPropertyLineEditor';
import { Block, Placement, type PlacedLine, type Spot } from '../utils/Placement';
import type { PropertyOp } from '../PropertyUpdatePlanner';
import { flowInstanceHead, renderFlowInstance } from '../FlowInstanceLines';
import {
    UnfollowableDraft, createFile, fileGone, processLines, splitLines,
    type EditorLine, type LineDraft, type NamedRow, type Refusal, type WriteAt, type WriteChannels, type WriteOutcome,
    type WriteSession,
} from '../../../utils/FileLines';
import type { PlannedTarget } from '../TaskRefs';
import type { MoveDestination, TaskOp } from '../TaskOps';
import { Outline } from '../../parsing/utils/Outline';


/**
 * インラインタスクの書き込み操作を担当するクラス
 * タスク行の更新、削除、挿入などのCRUD操作を提供
 */
export class InlineTaskWriter {
    constructor(
        private app: App,
        private fileOps: FileOperations,
        private channelOf: WriteChannels = () => undefined,
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
        if (!(file instanceof TFile)) return this.refusedGone(target);

        // 子プロパティ行（- key:: value）の更新は同一 process 内で
        // 連続適用する（別 process だと originalText 失効と行番号
        // シフトが競合するため、タスク行と子行は1原子書き込み）。
        const update: TaskOp = { kind: 'update', text: TaskParser.format(updatedTask), childOps };
        return processLines(this.app, file, this.channelOf(target.file),
            (draft, _eol, session) => this.applyOps(draft, session, target, fire ? [update, fire] : [update]));
    }

    /** Nothing written: the file is not there. Told as `gone`, like a row that is not. */
    private refusedGone(target: PlannedTarget): WriteOutcome {
        return fileGone(this.channelOf(target.file), target.file, target.subject);
    }

    /**
     * Apply `ops` to the row at a line the editor pointed at, planned from the
     * row, and its subtree when `at` holds one: the editor menu's write, when
     * the editor it was opened in no longer shows the file, and the source's
     * write of a move to another file, made once the destination landed, to
     * the row the completing write left (`FlowExecutor.finishAway`). A caller
     * that tells a refusal in its own words has it from the outcome, as
     * `applyToTask` does.
     */
    async applyToLine(
        filePath: string,
        at: EditorLine,
        ops: readonly TaskOp[],
        opts: { tellRefusal?: boolean } = {},
    ): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        const told = this.channelOf(filePath);
        const channel = told && opts.tellRefusal === false ? { ...told, refused: () => { } } : told;
        if (!(file instanceof TFile)) return fileGone(channel, filePath, at.text.trim());
        return processLines(this.app, file, channel, (draft, _eol, session) => this.applyOps(draft, session, at, ops));
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
        if (!(file instanceof TFile)) return this.refusedGone(target);

        return processLines(this.app, file, this.channelOf(target.file), (draft, _eol, { row }) => {
            const currentLine = row(target);
            if (currentLine === null) return false;

            const { childrenLines } = this.fileOps.collectChildrenFromLines(draft.lines, currentLine);

            // Delete task line + all children. What the report carries is what
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
     * across the splices before it (see `WriteSession.row`), and nothing
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
        const told = this.channelOf(target.file);
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
            case 'move': {
                // The row and what goes with it are carried to where the move
                // goes — the end of the note, where an append puts lines, the
                // file's final terminator kept after them; or the end of a
                // heading's section — and then its whole subtree is taken
                // away from where it was. Everything is read before either.
                // The spot is never inside the subtree (a section's end is
                // past every item in it), so the subtree is where it was, or
                // below the carried lines when they went above it.
                const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, line);
                const block = this.carriedWith(lines, line, op.text, true);
                const spot = this.destinationOf(lines, op.to, block[0].text);
                draft.put(spot, block);
                draft.splice(spot.at <= line ? line + block.length : line, 1 + childrenLines.length);
                return;
            }
            case 'remove': {
                const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, line);
                draft.splice(line, 1 + childrenLines.length);
                return;
            }
            case 'insert': {
                // A new line beside the row, spelled as the item next to it.
                draft.put(Placement[op.place](lines, line, op.text), Block.line(op.text));
                return;
            }
            case 'copy': {
                // Usually a copy of the row, word for word. Put just below
                // it, the copy took the row's children for its own (P1's
                // counterexample 5): it goes past the subtree, and the
                // report says which of the two rows the write made.
                draft.put(Placement.copyOf(lines, line, 'below', op.text), Block.line(op.text));
                return;
            }
        }
    }

    /**
     * Where a move to `to` puts its lines, `head` their first: the end of the
     * note, or the end of the section of the heading `to` names. The heading
     * is looked up as the fire's plan looked it up (`FlowExecutor.planTask`),
     * in the lines the plan was made from as the ops before this one left
     * them; none of those ops writes a heading, so the plan's answer — one
     * heading — is this one. Any other answer is a caller's bug.
     */
    private destinationOf(lines: readonly string[], to: MoveDestination, head: string): Spot {
        if (to.kind === 'end') return Placement.end(lines);
        const found = Placement.heading(lines, to.name);
        if (found.kind !== 'one') throw new UnfollowableDraft(`a move to the heading '${to.name}' finds ${found.kind === 'none' ? 'none' : found.count} where it was planned to find one`);
        return Placement.sectionEnd(lines, found.heading, head);
    }

    /**
     * Append `lineBody` as the task's last child.
     *
     * `lineBody` carries no indentation: the depth is read off the file here,
     * from the children the task already has. Letting the caller prefix it meant
     * deriving the unit from the parent line alone, which returns four spaces
     * for any top-level task and so mixed spaces into tab-written files.
     */
    async insertLineAfterTask(target: PlannedTarget, lineBody: string): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(target.file);
        if (!(file instanceof TFile)) return fileGone(this.channelOf(target.file), target.file, target.subject);

        return processLines(this.app, file, this.channelOf(target.file), (draft, _eol, { row }) => {
            const currentLine = row(target);
            if (currentLine === null) return false;

            draft.put(Placement.lastChild(draft.lines, currentLine, lineBody), Block.line(lineBody));

            return true;
        });
    }

    /**
     * Insert `lineBody` as the first child of a task (right after the task line):
     * a child added from a card's menu, the API or the CLI.
     *
     * As with {@link insertLineAfterTask}, the indent is resolved here from the
     * task's existing children rather than supplied by the caller.
     */
    async insertLineAsFirstChild(target: PlannedTarget, lineBody: string): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(target.file);
        if (!(file instanceof TFile)) return fileGone(this.channelOf(target.file), target.file, target.subject);

        return processLines(this.app, file, this.channelOf(target.file), (draft, _eol, { row }) => {
            const currentLine = row(target);
            if (currentLine === null) return false;

            // Directly below the task line, past its own text that goes on.
            draft.put(Placement.firstChild(draft.lines, currentLine, lineBody), Block.line(lineBody));

            return true;
        });
    }

    /**
     * @returns the outcome.
     *
     * A note that does not exist yet is made whole (`createFile`): every row
     * in it is new, and there is no report of lines to follow.
     */
    async appendTaskToFile(filePath: string, content: string): Promise<WriteAt> {
        // The appended text is built with LF; splitting it here lets the file's
        // own terminator go back between every line, its own included. The
        // lines are to read as they read by themselves.
        return this.appendBlock(filePath, Block.read(splitLines(content).lines));
    }

    /** Append `block` to the note, or make the note of it (see {@link appendTaskToFile}). */
    private async appendBlock(filePath: string, block: readonly PlacedLine[]): Promise<WriteAt> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        const subject = block[0].text.trim();
        const channel = this.channelOf(filePath);

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
     * What a move to another file writes to the destination for the row at
     * `line` of `lines` — the lines the completing write held — the row as
     * `content` and the lines of its subtree that go with it (`block`, new
     * lines to the destination), and the row's whole subtree as `lines` hold
     * it (`subtree`), which is what taking the original away plans from.
     *
     * The two files cannot be one write — Obsidian's `process` is per file —
     * so the destination is written first (`appendArchive`), and the source's
     * write is made once it has landed, checked against `subtree`: a child
     * edited in between is refused there rather than taken away unseen.
     * Handing a move from one file to the other is F8's. The appended lines are
     * new rows: the move drops the task's `^id` on the way (see
     * `FlowPlanner`'s archived copy), and a row in another file is another
     * row to the index.
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
        return (await this.appendBlock(destPath, block)).written;
    }
}
