import { type App, TFile } from 'obsidian';
import type { Task } from '../../../types';
import { TaskParser } from '../../parsing/TaskParser';
import { collectFlowLineIndices } from '../../parsing/utils/FlowLineScanner';
import { carryTo } from '../Carry';
import { FileOperations } from '../utils/FileOperations';
import { ChildPropertyLineEditor } from '../utils/ChildPropertyLineEditor';
import { Block, Placement, type InSection, type PlacedLine, type Spot } from '../utils/Placement';
import { ListNumber } from '../utils/ListNumber';
import type { PropertyOp } from '../PropertyUpdatePlanner';
import { flowInstanceHead, renderFlowInstance } from '../FlowInstanceLines';
import {
    UnfollowableDraft, createFile, editLines, fileGone, processLines, splitLines,
    type DraftEdit, type EditTrials, type EditedLines, type EditorLine, type LineDraft, type NamedRow, type Refusal,
    type RowTarget, type WriteAt, type WriteRefused, type WriteChannel, type WriteChannels, type WriteOutcome, type WriteSession,
} from '../FileLines';
import type { PlannedTarget } from '../TaskRefs';
import type { CompletionFire, FiringOutcome, SubtreeReplacement, TaskOp } from '../TaskOps';
import { replaceSubtree } from '../ReplaceSubtree';
import { Outline, type OutlineReading } from '../../parsing/utils/Outline';
import { indentUnit } from '../../../utils/ObsidianConfig';


/**
 * インラインタスクの書き込み操作を担当するクラス
 * タスク行の更新、削除、挿入などのCRUD操作を提供
 */
export class InlineTaskWriter {
    constructor(
        private app: App,
        private fileOps: FileOperations,
        private channelOf: WriteChannels,
    ) { }

    /**
     * Rewrite the row as `updatedTask`, and its property lines by `childOps`
     * — and, with `fire`, fire its flow in the same write: a card's, the
     * API's or a timer's completion of the row (`TaskIndex.writeUpdate`).
     * A write refused with a fire that writes lines leaves the rewrite
     * written alone, in the same attempt (`CompletionFire.writes`).
     *
     * The line is made from the index's copy, so it is written only over a
     * row that still reads as that copy (`target.basis`): a line edited since
     * — by hand, by the editor's menu, by a fire — would otherwise be put back
     * to what the copy says, the edit lost without a word.
     *
     * @returns the outcome. `written: false` means nothing was written at all,
     * which the caller must not treat as a successful no-op: the index has
     * already been updated optimistically, and an unwritten file leaves the two
     * disagreeing until something else forces a rescan. A write made says
     * what came of `fire` (`FiringOutcome`).
     */
    async updateTaskInFile<F extends CompletionFire>(target: PlannedTarget, updatedTask: Task, childOps: PropertyOp[] = [], fire?: F): Promise<FiringOutcome<F>> {
        const file = this.app.vault.getAbstractFileByPath(target.file);
        if (!(file instanceof TFile)) return this.refusedGone(target);

        // 子プロパティ行（- key:: value）の更新は同一 process 内で
        // 連続適用する（別 process だと originalText 失効と行番号
        // シフトが競合するため、タスク行と子行は1原子書き込み）。
        const update: TaskOp = { kind: 'update', text: TaskParser.format(updatedTask), childOps };
        return this.writeOps(file, this.channelOf(target.file), target, [update], fire);
    }

    /**
     * Replace the row `target` names and its subtree with `replacement`, as
     * one write, and fire each row the write completes, in the same write:
     * the hub's source mode (`TaskIndex.replaceSubtree`). Which rows the
     * write keeps and which it writes anew, and which of the kept ones it
     * completes, is `ReplaceSubtree`'s to answer; whether a row is completed
     * is `completing.completes`, handed in by the index, since it is the flow
     * layer's question. Each completed row's fire is `completing.fire()`, and
     * stands or is set aside on its own ({@link writeFiring}).
     *
     * The target's basis holds the subtree the draft was opened on, so the
     * write is made only over a subtree that still reads so: a line written
     * into it since, by the form, a timer or by hand, refuses it as `changed`.
     * A caller that shows the refusal itself hears it at `opts.refused`
     * ({@link channelHearing}).
     */
    async replaceSubtreeInFile<F extends CompletionFire>(
        target: PlannedTarget,
        replacement: SubtreeReplacement,
        completing: { completes(before: string, after: string): boolean; fire(): F },
        opts: { refused?: (refusal: Refusal) => void } = {},
    ): Promise<FiringOutcome<F>> {
        const file = this.app.vault.getAbstractFileByPath(target.file);
        const channel = this.channelHearing(target.file, opts.refused);
        if (!(file instanceof TFile)) return fileGone(channel, target.file, target.subject);
        return this.writeFiring(file, channel, (draft, session) => {
            const line = session.row(target);
            if (line === null) return false;
            const rewritten = replaceSubtree(draft, session, line, replacement);
            if (rewritten === false) return false;
            return rewritten.filter(row => completing.completes(row.was, row.now)).map(row => row.row);
        }, completing.fire);
    }

    /**
     * Apply `ops` to the row `target` names, as one write, with `fire` after
     * them when a fire goes with them ({@link writeFiring}).
     */
    private writeOps<F extends CompletionFire>(
        file: TFile,
        channel: WriteChannel | undefined,
        target: NamedRow | EditorLine,
        ops: readonly TaskOp[],
        fire: F | undefined,
    ): Promise<FiringOutcome<F>> {
        return this.writeFiring(file, channel, (draft, session) => {
            if (!this.applyOps(draft, session, target, ops)) return false;
            return fire ? [target] : [];
        }, () => fire!);
    }

    /**
     * One write of `base`, and of the fire of each row it completed, each
     * fire kept or set aside on its own: as the editor fires the rows one
     * transaction completed (`FlowFireExtension`), but in one write
     * ({@link firingTrials}).
     *
     * A refusal says what the write was about by the row it asked for last,
     * else `about` (`processLines`): a write that may ask for no row of its
     * own names its subject there.
     *
     * @returns the outcome, and, when it was written, what `after` answered
     * in the run written.
     */
    async writeFiring<F extends CompletionFire, A = true>(
        file: TFile,
        channel: WriteChannel | undefined,
        base: (draft: LineDraft, session: WriteSession) => readonly RowTarget[] | false,
        fire: () => F,
        after?: (draft: LineDraft, session: WriteSession) => A | false,
        about?: string,
    ): Promise<FiringOutcome<F> & { after?: A }> {
        const firing = this.firingTrials(base, fire, after);
        const outcome = await processLines(this.app, file, channel, firing.trials, about);
        if (!outcome.written) return outcome;
        const { fires, after: answered } = firing.settled();
        return { ...outcome, fires, ...(answered !== undefined ? { after: answered } : {}) };
    }

    /**
     * The edits one write of `base` and its fires tries, to settle on the one
     * it writes (`EditTrials`): what {@link writeFiring} writes to its note,
     * and what a send tries first on the lines of a note to learn what the
     * write will leave of its rows (`SendWriter`). `settled` answers what the
     * last settle chose: each fire and the refusal it was set aside with, and
     * what `after` answered in the edit chosen.
     *
     * `base` does the write's own edit and answers the rows it completed,
     * where its session finds them (the row the write names, a line it
     * marked), in the order they stand; false when it gave the write up.
     * Each row's fire is `fire()`, asked once per row in each run of the
     * write, and applied after `base`, row by row, the ones above first, each
     * planned from the lines the fires before it left. A fire that carries a
     * row below it (a parent's move) carries it through the write's own
     * report, and the row fires where it went, once.
     *
     * `after`, when given, is the rest of the write, done once the fires
     * are: an edit of rows the fires may have changed or moved, which it
     * finds through the session where they left them — a send carries the
     * rows its draft completed once they fired where they stood
     * (`SendWriter`). It is part of every try, the one without fires too;
     * false gives the write up, as from `base`, and anything else is what it
     * answers of the edit.
     *
     * The write is tried with every fire first, which is the one try when
     * nothing is refused. Refused with a fire in it, it is tried with none:
     * refused so too, the refusal is the write's own, and nothing is
     * written. Otherwise the fires are put back one at a time, from the
     * top, each kept if the write with it and the ones kept before it is
     * made, and set aside, with the refusal it met, if not: the completion
     * stands without it, its command stays on the row, and the user is owed a
     * word of it (`FiringOutcome`). All of it is tried on the lines of one
     * run of the write's callback (`EditTrials`).
     */
    firingTrials<F extends CompletionFire, A = true>(
        base: (draft: LineDraft, session: WriteSession) => readonly RowTarget[] | false,
        fire: () => F,
        after?: (draft: LineDraft, session: WriteSession) => A | false,
    ): { trials: EditTrials; settled(): { fires: ReadonlyArray<{ fire: F; setAside: Refusal | null }>; after: A | undefined } } {
        // The last settle's fires, what came of them, and what `after`
        // answered in the edit it chose.
        let fires: F[] = [];
        let setAside = new Map<number, Refusal>();
        let chosen: A | undefined;
        const settle = (tryEdit: (edit: DraftEdit) => EditedLines): EditedLines => {
            fires = [];
            setAside = new Map();
            chosen = undefined;
            const fireAt = (k: number): F => fires[k] ??= fire();
            // How many rows `base` completed, as its last try answered.
            let rows = 0;
            // What `after` answered in each edit made.
            const answers = new Map<EditedLines, A | undefined>();
            // The write with the fires of the rows `kept` names (all of them
            // for null), each after the ones above it.
            const tryWith = (kept: readonly number[] | null): EditedLines => {
                let answered: A | undefined;
                const edited = tryEdit((draft, _eol, session) => {
                    answered = undefined;
                    const completed = base(draft, session);
                    if (completed === false) return false;
                    rows = completed.length;
                    for (const k of kept ?? completed.keys()) {
                        if (!this.applyOps(draft, session, completed[k], [fireAt(k).op])) return false;
                    }
                    if (!after) return true;
                    const answer = after(draft, session);
                    if (answer === false) return false;
                    answered = answer;
                    return true;
                });
                if (edited.written) answers.set(edited, answered);
                return edited;
            };
            const choose = (edited: EditedLines): EditedLines => {
                chosen = answers.get(edited);
                return edited;
            };
            const all = tryWith(null);
            if (all.written || rows === 0) return choose(all);
            let made = tryWith([]);
            if (!made.written) return made;
            const kept: number[] = [];
            for (let k = 0; k < rows; k++) {
                // With every fire above it kept, the last is the first try again.
                const withIt = kept.length === k && k === rows - 1 ? all : tryWith([...kept, k]);
                if (withIt.written) {
                    kept.push(k);
                    made = withIt;
                } else {
                    setAside.set(k, withIt.refused);
                }
            }
            return choose(made);
        };
        return {
            trials: { settle },
            settled: () => ({ fires: fires.map((one, k) => ({ fire: one, setAside: setAside.get(k) ?? null })), after: chosen }),
        };
    }

    /** Nothing written: the file is not there. Told as `gone`, like a row that is not. */
    private refusedGone(target: PlannedTarget): WriteRefused {
        return fileGone(this.channelOf(target.file), target.file, target.subject);
    }

    /**
     * The channel a write to `file` goes through: the index's, with a refusal
     * handed to `refused` instead when the caller gives one. A caller that
     * shows the refusal in a place of its own hears it there, and decides
     * what else is done of it (the index still learns from it); telling it
     * through the channel too would be the same news twice.
     */
    private channelHearing(file: string, refused: ((refusal: Refusal) => void) | undefined): WriteChannel | undefined {
        const told = this.channelOf(file);
        return told && refused ? { ...told, refused } : told;
    }

    /**
     * Apply `ops` to the row at a line the editor pointed at, planned from the
     * row, and its subtree when `at` holds one: the editor menu's write, when
     * the editor it was opened in no longer shows the file, with `opts.fire`
     * when it completes the line (see {@link updateTaskInFile}). A caller that
     * tells a refusal in its own words has it from the outcome, as
     * `applyToTask` does.
     */
    async applyToLine<F extends CompletionFire>(
        filePath: string,
        at: EditorLine,
        ops: readonly TaskOp[],
        opts: { refused?: (refusal: Refusal) => void; fire?: F } = {},
    ): Promise<FiringOutcome<F>> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        const channel = this.channelHearing(filePath, opts.refused);
        if (!(file instanceof TFile)) return fileGone(channel, filePath, at.text.trim());
        return this.writeOps(file, channel, at, ops, opts.fire);
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
        opts: { refused?: (refusal: Refusal) => void } = {},
    ): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(target.file);
        const channel = this.channelHearing(target.file, opts.refused);
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
    applyOps(draft: LineDraft, session: WriteSession, target: RowTarget, ops: readonly TaskOp[]): boolean {
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
                ChildPropertyLineEditor.applyOps(draft, line, [...(op.childOps ?? [])], indentUnit(this.app));
                return;
            }
            case 'insert-instance': {
                const outline = draft.reading();
                const unit = indentUnit(this.app);
                draft.put(Placement.groupHead(outline, line, flowInstanceHead(op.insert), unit), renderFlowInstance(outline, line, op.insert, unit));
                return;
            }
            case 'strip-flow': {
                // Every flow line is below the row (the scan starts past it
                // and stops at the first line that is not a descendant), so
                // taking them out leaves the row where it is.
                const flowIndices = collectFlowLineIndices(draft.reading(), line);
                for (let i = flowIndices.length - 1; i >= 0; i--) {
                    draft.splice(flowIndices[i], 1);
                }
                const indent = Outline.indentOf(lines[line]);
                // Losing `==>` rewrites the text; the row is the one that fired.
                draft.rewrite(line, indent + Outline.dedent(op.text));
                return;
            }
            case 'move': {
                // The row and what goes with it are carried to the heading's
                // section, at the side the move says, without its own `==>`
                // lines, which the fire consumes (`carryTo`). The spot is
                // asked with the row as it lands, numbered 1 when ordered.
                const outline = draft.reading();
                const head = ListNumber.first(Outline.indentOf(lines[line]) + Outline.dedent(op.text));
                carryTo(draft, line, this.destinationOf(outline, op.to, head), { head: op.text, flow: 'drop' });
                return;
            }
            case 'remove': {
                const { childrenLines } = this.fileOps.collectChildrenFromLines(draft.reading(), line);
                draft.splice(line, 1 + childrenLines.length);
                return;
            }
            case 'insert': {
                // A new line beside the row, spelled as the item next to it.
                draft.put(Placement[op.place](draft.reading(), line, op.text, indentUnit(this.app)), Block.line(op.text));
                return;
            }
            case 'copy': {
                // Usually a copy of the row, word for word. Put just below
                // it, the copy took the row's children for its own (P1's
                // counterexample 5): it goes past the subtree, and the
                // report says which of the two rows the write made.
                draft.put(Placement.copyOf(draft.reading(), line, 'below', op.text), Block.line(op.text));
                return;
            }
        }
    }

    /**
     * Where a move to `to` puts its lines, `head` their first
     * (`Placement.into`). The heading is looked up as the fire's plan looked
     * it up (`FlowExecutor.planTask`), in the lines the plan was made from as
     * the ops before this one left them; none of those ops writes a heading,
     * so the plan's answer — one heading — is this one. Any other answer is
     * a caller's bug.
     */
    private destinationOf(outline: OutlineReading, to: InSection, head: string): Spot {
        const found = Placement.into(outline, to, head);
        if (found.kind !== 'spot') throw new UnfollowableDraft(`a move to the heading '${to.heading}' finds ${found.kind === 'none' ? 'none' : found.count} where it was planned to find one`);
        return found.spot;
    }

    /**
     * @returns the outcome.
     *
     * A note that does not exist yet is made of what the append writes to an
     * empty note, held to the same check (`editLines`), and created whole
     * (`createFile`): every row in it is new, and there is no report of lines
     * to follow.
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
        let inserted = -1;
        const append = (draft: LineDraft) => {
            const spot = Placement.end(draft.reading());
            draft.put(spot, block);
            inserted = spot.at;
            return true;
        };

        if (!file) {
            const edited = editLines(filePath, [], '\n', append, { about: subject });
            if (!edited.written) {
                channel?.refused(edited.refused);
                return edited;
            }
            const created = await createFile(this.app, filePath, channel, subject, async () => {
                await this.fileOps.ensureDirectoryExists(filePath);
                return edited.lines.join('\n');
            });
            return created.written ? { ...created, line: inserted } : created;
        }

        // A folder by that name: there is no note to append to.
        if (!(file instanceof TFile)) return fileGone(channel, filePath, subject);

        const outcome = await processLines(this.app, file, channel, append, subject);
        return outcome.written ? { ...outcome, line: inserted } : outcome;
    }
}
