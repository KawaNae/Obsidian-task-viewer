import { type App, Notice, TFile } from 'obsidian';
import type { DuplicateOptions, Task, TaskViewerSettings } from '../../types';
import { isTvInline } from '../../types';
import { TaskRepository } from '../persistence/TaskRepository';
import { PropertyUpdatePlanner } from '../persistence/PropertyUpdatePlanner';
import { FlowExecutor, type FireOp } from '../flow/FlowExecutor';
import { FlowNotices } from '../flow/FlowNotices';
import { completes } from '../flow/FlowTrigger';
import type { EditorFireHost } from '../../editor/FlowFireExtension';
import type { EditorLineHost } from '../../editor/EditorWrite';
import type { FlowDeleteAssessment } from '../flow/FlowDeletion';
import type { TaskIndex } from '../core/TaskIndex';
import { refusalNotice, type IndexRefusal } from '../core/RefusalClause';
import { readName } from '../core/RowNames';
import { formatRow } from '../parsing/TaskLineFormat';
import { planDuplicate } from './DuplicateShift';
import { isReadCopy, plannedOn, subjectOf, type ReadCopy } from '../persistence/TaskRefs';
import { logDebug, logInfo, logWarn } from '../../log/log';
import { splitLines, type Refusal, type RowRef, type WriteChannels } from '../persistence/FileLines';
import type { FiringOutcome } from '../persistence/FiringTrials';
import type { InsertPlace, SubtreeReplacement, TaskOp } from '../persistence/TaskOps';
import { Destination } from '../persistence/Destination';
import { Block } from '../persistence/utils/Placement';
import type { SendTo } from '../persistence/writers/SendWriter';
import type { OnDisk } from '../core/ReadingCheck';
import { outermostRows } from '../persistence/writers/SendRows';
import { openPeriodicNote, putInPeriodicNote } from '../persistence/Notes';
import { saveTemplateNote } from '../template/TemplateNote';
import { dailyNotes, type PeriodicNote } from '../../utils/PeriodicNotes';

/**
 * A row looked up by its anchor in a reading of the note as the disk holds it
 * (`Operations.freshByAnchor`): the row, no row carrying the anchor, or a note
 * that could not be read — which says nothing of whether the row is there.
 */
export type AnchoredRow =
    | { kind: 'row'; task: Task }
    | { kind: 'none' }
    | { kind: 'unreadable' };

/**
 * What came of a write to the row an anchor names (`Operations.updateByAnchor`):
 * written, with the copy the anchor found; not written, and told the user
 * unless the row is read-only; or the row not found, as {@link AnchoredRow}.
 */
export type AnchoredWrite =
    | { kind: 'written'; task: Task }
    | { kind: 'not-written' }
    | { kind: 'none' }
    | { kind: 'unreadable' };

/**
 * What a rewrite of a row writes: the fields, or what they are made of the
 * copy the write is planned from (`Operations.updateByAnchor`).
 */
export type RowUpdates = Partial<Task> | ((row: Task) => Partial<Task>);

/**
 * A row a send takes (`Operations.send`): its id, the row and its subtree as
 * the send's dialog was opened on them (`Task.subtreeLines`), which the write
 * is checked against, and the draft the user wrote of them there
 * (`SubtreeFrame.check`'s `write`), if any.
 */
export interface SendRow {
    taskId: string;
    base: readonly string[];
    draft?: SubtreeReplacement;
}

/**
 * What came of a send (`Operations.send`): the note written, what the send
 * was about in the user's words (the first row's text), the notes
 * whose rows went there (`landed`), and the refusals of the notes whose rows
 * stayed where they stood, not told the user (`refused`), and whether what
 * went of those was taken out of the note again (`takenBack`; the note
 * taken away or written back as it was when no row went); or nothing
 * written, and why — told the user unless the caller asked not to — or
 * `refused: null` for a send its caller asked wrongly, said only in the log.
 */
export type SendWrite =
    | { kind: 'done'; note: TFile; subject: string; landed: readonly string[]; refused: readonly Refusal[]; takenBack: boolean }
    | { kind: 'not-done'; refused: IndexRefusal | null };

/** A row as the index read it, and the note's lines it was read in (`Operations.rowSnapshot`). */
export interface RowSnapshot {
    task: Task;
    lines: readonly string[];
}

/**
 * The operations on the notes: the one way a consumer — a view, a menu, the
 * hub, a timer, the API, the CLI, the editor — writes (structure/layers.md).
 *
 * Each operation that names a row plans from the index's copy of it, once
 * the copy is known to be the row on the disk (`planCopy`), and in order
 * with the writes already asked of the row (`onRow`); writes it through the
 * repository, the row's fire in the same write when it completes the row;
 * and tells the user once when it was refused (`reportRefusal`). What a
 * write left comes back to the index as its next reading (`landed`), and the
 * index tells the views; an operation neither changes the index's copy nor
 * tells a view itself.
 *
 * The index is read here (its copies, the check of a copy against the disk,
 * what it learns from a refusal); the index knows nothing of the operations.
 *
 * Every taskId is a row's name. A segment of a task split at the day
 * boundary is a key within the display (`SegmentIds`); a caller acting on
 * one hands its row's name (`getOriginalTaskId`).
 */
export class Operations {
    private readonly repository: TaskRepository;
    private readonly commandExecutor: FlowExecutor;
    /**
     * What the user is told of the flow: a completion whose flow was not
     * run, for a write here and the editor's transaction alike
     * (`FlowNotices.firing`).
     */
    private readonly notices = new FlowNotices();

    /**
     * `dispose` 済みか。閉じたあとの書き込みは行わず、できなかったと答える。
     *
     * reload 後も開いたままのハブが旧インスタンスの書き込み経路を握っていて、
     * 古い内容で行を上書きしていた（#165）。購読を切るだけでは、既に参照を
     * 持っている相手からの呼び出しは止まらない。
     */
    private disposed = false;

    /** The writes asked of each row, in order (see {@link onRow}). */
    private rowWrites?: Map<string, Promise<unknown>>;

    constructor(private readonly app: App, private readonly index: TaskIndex) {
        this.repository = new TaskRepository(app);
        // Settings asked of the index each time (not a snapshot): a change of
        // them replaces the object, and a completion is judged by the latest
        // status definitions.
        this.commandExecutor = new FlowExecutor(this.repository, index, app, () => index.getSettings());
        // Cut on dispose, so a write that outlives these operations lands
        // nothing in the index (see WriteChannels).
        this.repository.connect((path) => ({
            landed: landing => index.landed(path, landing),
            refused: refusal => { void this.reportRefusal(refusal); },
            follow: (read, line, now) => index.followLine(path, read, line, now),
            reading: () => index.readingOf(path),
        }));
    }

    private get settings(): TaskViewerSettings {
        return this.index.getSettings();
    }

    /**
     * Let go of the index: a write asked after is refused, and one under way
     * lands nothing in it.
     */
    dispose(): void {
        this.disposed = true;
        this.repository.disconnect();
    }

    /**
     * 閉じたあとの書き込みを断る。
     *
     * 購読を切っても、既に参照を持っている相手（reload 前から開いているハブ、
     * 走行中のタイマー）からの呼び出しは止まらない。断ったことはログに残す —
     * 黙って捨てると、書いたつもりの側が気づけない。
     */
    private refuseAfterDispose(operation: string): boolean {
        if (!this.disposed) return false;
        logWarn(`[Operations] refused after dispose: ${operation}`);
        return true;
    }

    /**
     * Rewrite the row `taskId` names with `updates`, in one write of its file.
     *
     * The index's copy is not touched: what the write left is the index's
     * next reading of the file (`landed`), and its notify draws it. A view
     * that shows the new values before then shows them from its own state
     * (the hub's draft, the box a click changed), not from the copy.
     *
     * @returns whether the file was written. Not written: the user has been
     * told why, once, and the copy still says what the file says.
     */
    async updateTask(taskId: string, updates: Partial<Task>): Promise<boolean> {
        return this.update(taskId, updates);
    }

    /**
     * The row `anchor` anchors in `filePath`, looked up in a reading of the
     * note as the disk holds it (`freshByAnchor`), rewritten by the name
     * that answers as {@link updateTask} rewrites a row: for a caller that
     * names its row by `^id` (a timer). `updates` may be made from the copy
     * the write is planned from, for a caller that writes what the row says
     * (a record's name, the start it moves).
     *
     * @returns `written`, with the copy the anchor found (its name is
     * followed to the row's name now, `IndexReads.getTask`); `not-written`,
     * told the user unless the row is read-only; `none`, no row carries the
     * anchor; `unreadable`, the note could not be read, which says nothing of
     * whether the row is there. Nothing but `not-written` is told the user.
     */
    async updateByAnchor(filePath: string, anchor: string, updates: RowUpdates): Promise<AnchoredWrite> {
        if (this.refuseAfterDispose('updateByAnchor')) return { kind: 'not-written' };
        const found = await this.freshByAnchor(filePath, anchor);
        if (found.kind !== 'row') return found;
        return (await this.update(found.task.id, updates)) ? { kind: 'written', task: found.task } : { kind: 'not-written' };
    }

    /** {@link updateTask} and {@link updateByAnchor}: `updates`, or what they make of the copy planned from. */
    private async update(taskId: string, updates: RowUpdates): Promise<boolean> {
        if (this.refuseAfterDispose('updateTask')) return false;
        if (typeof updates !== 'function') logInfo(`[updateTask] id=${taskId} fields=[${Object.keys(updates)}]`);

        const known = this.index.getTask(taskId);
        return this.onRow(taskId, () => this.writeUpdate(taskId, updates, known));
    }

    /** {@link update}, once every write already asked of the row has finished. */
    private async writeUpdate(taskId: string, asked: RowUpdates, known: Task | undefined): Promise<boolean> {
        const task = await this.copyToPlan(taskId, known, { write: true });
        if (!task) return false;
        const updates = typeof asked === 'function' ? asked(task) : asked;
        if (typeof asked === 'function') logInfo(`[updateTask] id=${taskId} fields=[${Object.keys(updates)}]`);

        // 非時刻プロパティ（color/tags/custom 等）の書き込み操作。写しと更新の
        // diff から導く。
        const propertyOps = PropertyUpdatePlanner.plan(task, updates, this.settings.scopeKeys);

        // 書く行は写しに更新を重ねた姿から作る。行の探索は写しで行う:
        // ファイルに書かれているのは写しの行なので、更新後の日付や時刻で
        // 探しに行くと、まさにその値を変える更新のときに空振りする。子の
        // プロパティ行も写しの値から作るので、書き換えるときは部分木も計画が
        // 読んだものになる。外から足したタグの上に写しのタグを書かない。
        //
        // 行を完了させる書き換えは、同じ書き込みでフローを発火させる。完了か
        // どうかは、書き込みが照合する土台の行と書く行の対で答える
        // （`completes`）。発火の計画は書き込みの中で、書く行から立てる。
        const text = formatRow({ ...task, ...updates });
        const target = plannedOn(task, { subtree: propertyOps.length > 0 });
        const written = await this.writeCompleting(
            completes(task.originalText, text, this.settings.statusDefinitions) ? task.file : null,
            (fire) => this.repository.write(task.file, target, [{ kind: 'update', text, childOps: propertyOps }], { fire }));

        // Not written: the write layer has told the user why (see reportRefusal).
        if (!written) logWarn(`[Operations] update was not written: id=${taskId} fields=[${Object.keys(updates)}]`);
        return written;
    }

    /**
     * A write that may complete a row (`completingIn`, its file; null when it
     * does not), made with the row's fire in it: whether it was written. A
     * write refused with the fire in it is made without it in the same
     * attempt (`firingTrials`), and the user told (`FlowNotices.firing`).
     */
    private async writeCompleting(
        completingIn: string | null,
        write: (fire?: FireOp) => Promise<FiringOutcome<FireOp>>,
    ): Promise<boolean> {
        const outcome = await write(completingIn === null ? undefined : this.commandExecutor.fireOp(completingIn));
        this.notices.firing(outcome);
        return outcome.written;
    }

    /**
     * Write the row `taskId` and its subtree anew from a draft of their text:
     * the hub's source mode. `base` is the row and its subtree as the draft
     * was opened on them (the copy's `subtreeLines`), and the write is made
     * only over a subtree that still reads so; `replacement` is the draft
     * (`SubtreeReplacement`).
     *
     * One write, as every write that names a row: planned from the copy the
     * index holds once the row's earlier writes are done (`onRow`,
     * `copyToPlan`), named by the copy's line and reading, and checked against
     * `base`. A row the write completes — the row, or a child line it keeps
     * and writes checked — fires in the same write, each on its own
     * (`InlineTaskWriter.writeFiring`), as the editor fires the rows one
     * transaction completed; a line the draft made fires nothing, however it
     * reads.
     *
     * @returns whether the draft was written; when not, why not, for the
     * caller to show beside the draft it keeps. The user is told it as any
     * refusal is (`reportRefusal`), unless `opts.tellRefusal` is false: the
     * caller shows it itself, and a notice would say it twice. The index
     * learns from it either way (`learnFrom`). A read-only row is not
     * written and answers `refused: null`: the hub does not offer it.
     */
    async replaceSubtree(
        taskId: string,
        base: readonly string[],
        replacement: SubtreeReplacement,
        opts: { tellRefusal?: boolean } = {},
    ): Promise<{ written: true } | { written: false; refused: IndexRefusal | null }> {
        if (this.refuseAfterDispose('replaceSubtree')) return { written: false, refused: null };
        const known = this.index.getTask(taskId);
        const hear = opts.tellRefusal === false
            ? (refusal: IndexRefusal) => this.index.learnFrom(refusal)
            : (refusal: IndexRefusal) => this.reportRefusal(refusal);
        return this.onRow(taskId, async () => {
            const planned = await this.planCopy(taskId, known, { write: true, hear });
            if ('refused' in planned) return { written: false, refused: planned.refused };
            const { task } = planned;
            if (base.length === 0) {
                logWarn(`[Operations] replaceSubtree: not a row to write: id=${taskId}`);
                return { written: false, refused: null };
            }
            logInfo(`[replaceSubtree] id=${taskId} lines=${base.length}->${replacement.children.length + 1}`);
            const target = { ...plannedOn(task), basis: { text: base[0], subtree: base } };
            const defs = this.settings.statusDefinitions;
            const outcome = await this.repository.replaceSubtree(task.file, target, replacement, {
                completes: (was, now) => completes(was, now, defs),
                fire: () => this.commandExecutor.fireOp(task.file),
            }, { refused: (refusal) => { void hear(refusal); } });
            this.notices.firing(outcome);
            return outcome.written ? { written: true } : { written: false, refused: outcome.refused };
        });
    }

    /**
     * Send rows and their subtrees to a section of a note: the send
     * operation (`NoteOps.send`). Each row is `SendRow`: named by its id,
     * with the subtree the dialog was opened on (`base`) and the draft the
     * user wrote of it, if any. `to` is the note, made by the send when
     * `create` says so, its section, and the keys to write into its
     * frontmatter where it has none by their name.
     *
     * Planned as every write that names a row: once the writes already
     * asked of each row are done (`onRow`), from copies the disk still reads
     * as (`planCopy`), each named by its line and checked against its
     * `base`. A row inside another's subtree goes with that one's subtree
     * (`outermostRows`), and the rows go in the order they stand, note by
     * note.
     *
     * The write layer makes it (`SendWriter.send`): to the rows' own note,
     * one write; to another, the note first, then each note the rows came
     * from, what went taken back again for a note that refused. A refusal
     * before anything is written is told as for any write. One of a note the
     * rows came from, once the note is written, is only learnt from
     * (`learnFrom`) and answered, for the caller to tell once with what
     * became of the rest.
     *
     * @returns `done` once the note is written; else `not-done`, and why.
     * A refusal before anything is written — a row's copy the disk no longer
     * reads as (`planCopy`), a note the write turned away — is told the user
     * as any refusal is (`reportRefusal`), unless `opts.tellRefusal` is
     * false: the caller shows it itself, and a notice would say it twice.
     * The index learns from it either way (`learnFrom`). `opts.landed` is
     * handed each note the rows came from whose write landed, as it lands
     * (`SendHearing.landed`).
     */
    async send(rows: readonly SendRow[], to: SendTo, opts: { tellRefusal?: boolean; landed?: (path: string) => void } = {}): Promise<SendWrite> {
        if (this.refuseAfterDispose('send')) return { kind: 'not-done', refused: null };
        const hear = opts.tellRefusal === false
            ? (refusal: IndexRefusal) => this.index.learnFrom(refusal)
            : (refusal: IndexRefusal) => this.reportRefusal(refusal);
        const asked = new Map<string, SendRow>();
        for (const row of rows) if (!asked.has(row.taskId)) asked.set(row.taskId, row);
        const known = new Map([...asked.keys()].map(id => [id, this.index.getTask(id)]));
        // Every row's writes queued in one order, so two sends of the same
        // rows never wait for each other.
        const ids = [...asked.keys()].sort();
        return this.onRows(ids, async (): Promise<SendWrite> => {
            const planned: { task: ReadCopy; row: SendRow }[] = [];
            for (const id of ids) {
                const copy = await this.planCopy(id, known.get(id), { write: true, hear });
                if ('refused' in copy) return { kind: 'not-done', refused: copy.refused };
                const row = asked.get(id)!;
                if (row.base.length === 0) {
                    logWarn(`[Operations] send: not a row to write: id=${id}`);
                    return { kind: 'not-done', refused: null };
                }
                planned.push({ task: copy.task, row });
            }
            const sent = outermostRows(planned);
            for (const { row } of planned) {
                if (row.draft && !sent.some(one => one.row === row)) {
                    logWarn(`[Operations] send: a draft of a row in another's subtree is not written: id=${row.taskId}`);
                }
            }
            if (to.create && sent.some(({ task }) => task.file === to.path)) {
                logWarn(`[Operations] send: a note to make holds rows already: to=${to.path}`);
                return { kind: 'not-done', refused: null };
            }
            logInfo(`[send] to=${to.path}#${to.section.heading}${to.create ? ' (new)' : ''} rows=${sent.map(({ task }) => task.id).join(',')}`);
            const defs = this.settings.statusDefinitions;
            const outcome = await this.repository.send(sent.map(({ task, row }) => ({
                file: task.file,
                row: {
                    target: { ...plannedOn(task), basis: { text: row.base[0], subtree: row.base } },
                    ...(row.draft ? { draft: row.draft } : {}),
                },
            })), to, {
                completes: (was, now) => completes(was, now, defs),
                fire: (path) => this.commandExecutor.fireOp(path),
            }, { refused: (refusal) => { void hear(refusal); }, landed: opts.landed });
            if (outcome.kind === 'not-sent') return { kind: 'not-done', refused: outcome.refused };
            for (const write of outcome.writes) this.notices.firing(write);
            for (const refusal of outcome.refused) await this.index.learnFrom(refusal);
            logInfo(`[send] landed=${outcome.landed.join(',') || '-'} refused=${outcome.refused.map(one => `${one.file}:${one.reason.kind}`).join(',') || '-'} takenBack=${outcome.takenBack}`);
            return {
                kind: 'done', note: outcome.note, subject: subjectOf(sent[0].task),
                landed: outcome.landed, refused: outcome.refused, takenBack: outcome.takenBack,
            };
        });
    }

    /**
     * The copy of a row an operation is planned from, once it is known to be
     * the row on the disk; else undefined, and the user told why, once
     * (`reportRefusal`).
     *
     * A row the store no longer holds — an earlier write to it took it away,
     * or a scan read the file without it — is refused as `gone`, like any
     * write that finds its row gone. `known` is the copy as the operation was
     * asked for, to say which row it was. So is a copy that names no reading
     * (`ReadCopy`): its line is a coordinate in no content a write can check.
     *
     * A copy the disk no longer reads as (`checkCopy`: a change the index was
     * never told of) is not planned from: it is refused as `stale`, the note
     * is read again, and the user is asked to do it again, from the new
     * reading (structure/layers.md, 読みの鮮度). Every write that plans from a copy
     * comes through here, and so do the drag and the card's menu before the
     * user puts work in (`confirmTask`).
     *
     * `write`: the copy is planned from for a write, and a read-only row
     * (a row of another plugin's form, read but not ours to write) is not
     * written — answered without a word, as the views do not offer it. The
     * one place an operation asks whether a row is read-only.
     */
    private async copyToPlan(taskId: string, known: Task | undefined, opts: { write?: boolean } = {}): Promise<ReadCopy | undefined> {
        const planned = await this.planCopy(taskId, known, opts);
        return 'task' in planned ? planned.task : undefined;
    }

    /**
     * {@link copyToPlan}, with why not when the copy is not the row on the
     * disk: handed to `hear` — told the user and learnt from
     * (`reportRefusal`), or only learnt from, for a caller that shows it in
     * a place of its own (the hub's source mode) — and answered too. A
     * read-only row asked for a write answers `refused: null`, told nobody.
     */
    private async planCopy(
        taskId: string,
        known: Task | undefined,
        opts: { write?: boolean; hear?: (refusal: IndexRefusal) => Promise<void> } = {},
    ): Promise<{ task: ReadCopy; disk: OnDisk } | { refused: IndexRefusal | null }> {
        const hear = opts.hear ?? ((refusal: IndexRefusal) => this.reportRefusal(refusal));
        const task = this.index.getTask(taskId);
        if (!task) {
            logWarn(`[Operations] the index no longer holds the row: id=${taskId}`);
            // A row the caller named but the store never held here: say which
            // note, as a write refused before it read the note does.
            const file = known?.file ?? readName(taskId)?.filePath ?? '';
            const refused: IndexRefusal = { file, reason: { kind: 'gone' }, subject: known ? subjectOf(known) : file };
            await hear(refused);
            return { refused };
        }
        if (!isReadCopy(task)) {
            // A copy no reading of the index made: its line is a coordinate
            // in no content a write can check, so there is no row to write.
            logWarn(`[Operations] the copy names no reading: id=${taskId}`);
            const refused: IndexRefusal = { file: task.file, reason: { kind: 'gone' }, subject: subjectOf(task) };
            await hear(refused);
            return { refused };
        }
        if (opts.write && !isTvInline(task)) {
            logWarn(`[Operations] a read-only row is not written: id=${taskId} parser=${task.parserId}`);
            return { refused: null };
        }
        const checked = await this.index.checkCopy(task);
        if (checked.verdict === 'fresh') return { task, disk: checked.disk };
        const reason = checked.verdict === 'stale' ? { kind: 'stale' as const, disk: checked.disk } : { kind: 'unreadable' as const };
        const refused: IndexRefusal = { file: task.file, reason, subject: subjectOf(task) };
        await hear(refused);
        return { refused };
    }

    /**
     * Whether the index's copy of the row `taskId` is the row on the disk: a
     * drag or a card's menu asks as it opens, so the user does not put work
     * into an operation the write would turn away. When it is not, it has
     * been told and the note read again (`copyToPlan`). The write asks again
     * when it is made.
     */
    async confirmTask(taskId: string): Promise<boolean> {
        if (this.refuseAfterDispose('confirmTask')) return false;
        return (await this.copyToPlan(taskId, undefined)) !== undefined;
    }

    /**
     * The index's copy of the row `taskId`, and all the lines of the note it
     * was read in, as the disk holds them: what an operation that reads more
     * of the note than the row plans from — the send dialog, the values the
     * row inherits (`InheritedValues`). The same check as every write's
     * (`planCopy`), which reads the note for it and keeps what it read.
     *
     * Undefined when the copy is not the row on the disk: told the user and
     * the note read again, as for a write (`stale`, `gone`, `unreadable`).
     * Undefined too, with nothing to tell, for a copy read before our own
     * write the index has not committed, as while its note is dragged
     * (`TaskScanner.hold`): the copy says what the row was, not what these
     * lines say. Waits for the writes already asked of the row
     * (`onRow`), so it reads what they left.
     */
    async rowSnapshot(taskId: string): Promise<RowSnapshot | undefined> {
        if (this.refuseAfterDispose('rowSnapshot')) return undefined;
        const known = this.index.getTask(taskId);
        return this.onRow(taskId, async () => {
            const planned = await this.planCopy(taskId, known);
            if ('refused' in planned) return undefined;
            const { task, disk } = planned;
            if (!disk.read) {
                logWarn(`[Operations] rowSnapshot: the copy was not read in what the disk holds: id=${taskId}`);
                return undefined;
            }
            return { task, lines: disk.lines };
        });
    }

    /**
     * The row `anchor` anchors in `filePath` (`getTaskByAnchor`), looked up in
     * a reading of the note as the disk holds it: a note that changed in a
     * way the index was never told of, or that the index has not read yet,
     * is read first. For a caller that names its row by `^id` — the API's
     * `path#^id`, a timer — whose anchor outlives readings, so it goes on
     * with the row it finds (contract 3), where one that named a reading is
     * asked to try again. Nothing is told the user here: the caller goes on,
     * or says why it does not.
     *
     * While the note is being dragged (`TaskScanner.hold`), the check is
     * against the reading held back, and the row comes from the reading the
     * store has: a change from outside during the drag passes the check here
     * and the write by that row's name is refused by its own check
     * (`WriteSession.row`), as any write to the note is until the drag ends.
     */
    async freshByAnchor(filePath: string, anchor: string): Promise<AnchoredRow> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        // No note there to read: the index answers as it holds it.
        if (file instanceof TFile) {
            const checked = await this.index.checkFile(filePath);
            switch (checked.verdict) {
                case 'fresh':
                    break;
                case 'unread':
                    // Not read yet, as at startup: no change notice was missed.
                    logDebug(`[ReadingCheck] unread file=${filePath} subject=^${anchor}`);
                    await this.index.rescan(file);
                    break;
                case 'stale':
                    await this.index.learnFrom({ file: filePath, reason: { kind: 'stale', disk: checked.disk }, subject: `^${anchor}` });
                    break;
                case 'unreadable':
                    await this.index.learnFrom({ file: filePath, reason: { kind: 'unreadable' }, subject: `^${anchor}` });
                    return { kind: 'unreadable' };
            }
        }
        const task = this.index.getTaskByAnchor(filePath, anchor);
        return task ? { kind: 'row', task } : { kind: 'none' };
    }

    /**
     * Run `op` once every write already asked of this row has finished.
     *
     * A write that names a row is planned from the index's copy of it
     * (`plannedOn`), and the index takes in what a write left only once it has
     * landed (`landed`). A second write asked
     * before then — a checkbox clicked twice, which does not wait for the
     * first — would plan from the copy the first write has already moved on
     * from, and be refused against our own write. In order, each is planned
     * from the copy the one before it left.
     *
     * Per row, not per file: a write to another row plans from that row's
     * copy, which this one does not change. A row is one row across the
     * names our writes give it (`getTask`).
     */
    private onRow<T>(taskId: string, op: () => Promise<T>): Promise<T> {
        const queue = (this.rowWrites ??= new Map<string, Promise<unknown>>());
        // One row, whatever name it was asked by: a name asked before a write
        // of ours is followed to the row's name now (`getTask`), so a write
        // asked by the new name waits for one still under way by the old.
        const row = this.rowNow(taskId);
        const before = [...queue].filter(([name]) => name === taskId || this.rowNow(name) === row).map(([, write]) => write);
        // After the ones before, whether they landed or threw.
        const previous = Promise.all(before.map(write => write.then(() => undefined, () => undefined)));
        const next = previous.then(op);
        queue.set(taskId, next);
        const settled = () => { if (queue.get(taskId) === next) queue.delete(taskId); };
        next.then(settled, settled);
        return next;
    }

    /** The name the row `taskId` names has now, or `taskId` itself when it names none. */
    private rowNow(taskId: string): string {
        return this.index.getTask(taskId)?.id ?? taskId;
    }

    /**
     * {@link onRow} for each of `ids`, nested in their order: `op` runs once
     * every write already asked of any of them has finished, and each write
     * asked of one of them after it waits for it. A caller hands the ids in
     * one order (sorted), so two such operations over the same rows queue
     * one behind the other and never each wait for the other.
     */
    private onRows<T>(ids: readonly string[], op: () => Promise<T>): Promise<T> {
        return ids.reduceRight<() => Promise<T>>((inner, id) => () => this.onRow(id, inner), op)();
    }

    /**
     * What deleting this task would cost its flow command, answered without
     * writing anything. The delete menu asks before it decides what to offer.
     */
    assessFlowDelete(taskId: string): FlowDeleteAssessment {
        const task = this.index.getTask(taskId);
        if (!task) return { outlook: { kind: 'nothing' }, descendantFlows: 0 };
        return this.commandExecutor.assessDeletion(task);
    }

    /**
     * @param options.fireFlow write the command's next instance before
     * removing this one. A fire that cannot be planned stops the delete —
     * see {@link FlowExecutor.fireAndDelete} — so the task can survive this
     * call, with a notice saying why.
     * @returns whether the task is gone. A stopped fire, a read-only task and
     * a delete whose lines could not be resolved in the file all answer no.
     */
    async deleteTask(taskId: string, options: { fireFlow?: boolean } = {}): Promise<boolean> {
        if (this.refuseAfterDispose('deleteTask')) return false;
        const known = this.index.getTask(taskId);
        // The rows it took away are told by the index, once what the write
        // left is read (`IndexReads.onTaskDeleted`).
        return this.onRow(taskId, () => this.writeDelete(taskId, options, known));
    }

    /** {@link deleteTask}, once every write already asked of the row has finished. */
    private async writeDelete(taskId: string, options: { fireFlow?: boolean }, known: Task | undefined): Promise<boolean> {
        const task = await this.copyToPlan(taskId, known, { write: true });
        if (!task) return false;
        logInfo(`[deleteTask] id=${taskId} fireFlow=${options.fireFlow === true}`);

        let removed: boolean;
        if (options.fireFlow && isTvInline(task)) {
            removed = await this.commandExecutor.fireAndDelete(task);
        } else {
            // The row and the subtree the index read (`plannedOn`): a line
            // written into the subtree since is not taken with it.
            removed = (await this.repository.write(task.file, plannedOn(task, { subtree: true }), [{ kind: 'remove' }])).written;
            if (!removed) {
                // Nothing was written, so no rescan follows and the store
                // still holds a task the file also still holds. They agree,
                // and the caller must not report the task gone.
                logWarn(`[Operations] delete was not written: id=${taskId}`);
            }
        }

        return removed;
    }

    /** @returns whether the copy was written. */
    async duplicateTask(taskId: string, options?: DuplicateOptions): Promise<boolean> {
        if (this.refuseAfterDispose('duplicateTask')) return false;
        const known = this.index.getTask(taskId);
        return this.onRow(taskId, async () => {
            const task = await this.copyToPlan(taskId, known, { write: true });
            if (!task) return false;
            return this.writeDuplicateOf(task, taskId, options);
        });
    }

    /** {@link duplicateTask} on the copy the store holds once the row's earlier writes are done. */
    private async writeDuplicateOf(task: ReadCopy, taskId: string, options?: DuplicateOptions): Promise<boolean> {
        const written = await this.writeDuplicate(task, options);
        if (!written) {
            logWarn(`[Operations] duplicate was not written: id=${taskId}`);
        }

        return written;
    }

    /**
     * The copies a duplicate asks for, planned from the index's copy of the
     * row (`planDuplicate`: what they say needs the task's dates, which are
     * resolved at this layer) and put by the write beside the row it names.
     */
    private async writeDuplicate(task: ReadCopy, options?: DuplicateOptions): Promise<boolean> {
        const copies = planDuplicate(task, options, this.settings.startHour);
        return (await this.repository.write(task.file, plannedOn(task), [copies])).written;
    }

    /**
     * @returns the line the task was written on, or null when it was not — a
     * write that was not has told the user why.
     */
    async createTask(filePath: string, taskLine: string, heading?: string): Promise<number | null> {
        if (this.refuseAfterDispose('createTask')) return null;
        logInfo(`[createTask] path=${filePath} heading=${heading ?? '(none)'}`);

        // Under a heading, in a note that is there; at the end, in a note
        // made empty when it is not. The appended text is built with LF;
        // split here, the note's own terminator goes back between every
        // line, and the lines are to read as they read by themselves.
        const outcome = heading
            ? await this.repository.putInNote(filePath, Destination.sectionNamed(heading, this.settings), Block.line(taskLine))
            : await this.repository.putInNote(filePath, 'end', Block.read(splitLines(taskLine).lines), { create: () => '' });
        // What the write left is in the index once it landed (`landed`):
        // the caller finds the row on its line without waiting for a scan.
        return outcome.written ? outcome.line : null;
    }

    /**
     * A line put in beside the row, where `place` says (`TaskOp` `insert`):
     * a child at the head of the row's children, added from a card's menu,
     * the API or the CLI; a timer's first session line or record there, the
     * next session beside the last one, the first session of a continued run
     * past the completed siblings. The one insert beside a row. Planned from
     * the index's copy of the row (`plannedOn`), so written only where the
     * row the name was read in stands, as every write that names a row is
     * (`WriteSession.row`): a timer finds the row by its anchor
     * (`getTaskByAnchor`) and writes by the name that answers. A read-only
     * row (Tasks, Day Planner) is not written: the menu reaches here without
     * the API's guard.
     *
     * `rowId`, when given, rewrites the row's own `^id` in the same write: a
     * string puts it on (the target's anchor, on the first session line), null
     * takes it off (the last session's, once the next one is beside it). Both
     * land or neither does.
     *
     * @returns whether the line was written.
     */
    async insertLine(taskId: string, line: string, place: InsertPlace, rowId?: string | null): Promise<boolean> {
        if (this.refuseAfterDispose('insertLine')) return false;
        return this.onRow(taskId, async () => {
            const task = await this.copyToPlan(taskId, undefined, { write: true });
            if (!task) return false;
            logInfo(`[insertLine] taskId=${taskId} place=${place}${rowId === undefined ? '' : ` rowId=${rowId ?? '(off)'}`}`);
            const ops: TaskOp[] = [];
            if (rowId !== undefined) ops.push({ kind: 'update', text: formatRow({ ...task, blockId: rowId ?? undefined }) });
            ops.push({ kind: 'insert', place, text: line });
            const { written } = await this.repository.write(task.file, plannedOn(task), ops);
            return written;
        });
    }

    /**
     * Apply `ops` to the row at a line the editor pointed at, in the file:
     * the editor menu's write, when the editor it was opened in no longer
     * shows the file (`shows`). A rewrite that completes the line — an
     * `update` whose text `completes` the line the editor showed — fires in
     * the same write, as a card's does (see writeUpdate), its `fire` the last
     * op of the write.
     *
     * @returns whether the line was written.
     */
    async writeLine(filePath: string, at: RowRef, ops: readonly TaskOp[]): Promise<boolean> {
        if (this.refuseAfterDispose('writeLine')) return false;
        const defs = this.settings.statusDefinitions;
        const completing = ops.some(op => op.kind === 'update' && completes(at.basis.text, op.text, defs));
        return this.writeCompleting(
            completing ? filePath : null,
            (fire) => this.repository.write(filePath, at, ops, { fire }));
    }

    /**
     * What the editor's fire needs of these operations (`fireFilter`): the plan,
     * the ops, and the notices of what it did not run, told as a write's here
     * are. After `dispose`, nothing fires.
     */
    editorFireHost(): EditorFireHost {
        return {
            active: () => !this.disposed,
            statusDefinitions: () => this.settings.statusDefinitions,
            fireOp: (path) => this.commandExecutor.fireOp(path),
            applyOps: (draft, session, target, ops) => this.repository.applyOps(draft, session, target, ops),
            told: (outcome) => this.notices.firing(outcome),
        };
    }

    /**
     * What the editor menu's write needs of these operations (`writeEditorLine`):
     * the ops, where its refusals go, and the write to the file once the
     * editor no longer shows the note.
     */
    editorLineHost(): EditorLineHost {
        return {
            applyOps: (draft, session, target, ops) => this.repository.applyOps(draft, session, target, ops),
            refused: (refusal) => { void this.reportRefusal(refusal); },
            writeLine: (path, at, ops) => this.writeLine(path, at, ops),
        };
    }

    // ===== ヘルパー =====

    /**
     * Tell the user an operation was not made, and why, and learn from it
     * (`learnFrom`). Every write that gives up for want of a target comes
     * through here — once per write, from the write layer — and so does an
     * operation the check of its copy gave up (`copyToPlan`), so the callers
     * that learn of it from a `false` do not say it again. Settled once the
     * note is read again, where the reason asks for that.
     */
    private reportRefusal(refusal: IndexRefusal): Promise<void> {
        new Notice(refusalNotice(refusal));
        return this.index.learnFrom(refusal);
    }

    // ===== 行を持たない書き込み =====

    /**
     * Frontmatter keys written into a note (`FrontmatterWriter`): the colour
     * or line style the property view's suggest picked. A note's scope
     * property, not a row: it names no row and plans from no copy.
     *
     * @returns whether the keys were written.
     */
    async setFrontmatterKeys(filePath: string, updates: Record<string, string | null>): Promise<boolean> {
        if (this.refuseAfterDispose('setFrontmatterKeys')) return false;
        return (await this.repository.setFrontmatterKeys(filePath, updates)).written;
    }

    // ===== ノートの書き込み =====

    /**
     * Put `line` under the task section (`Destination.taskSection`) of the
     * daily note of `date` (`YYYY-MM-DD`), the note made of its template with
     * the line in it when it is not there, in one write (`putInPeriodicNote`):
     * a task a view's create dialog makes, a timer's first record.
     *
     * @returns the path of the note written, or null when it was not, the
     * reason told the user once.
     */
    async putInDailyNote(date: string, line: string): Promise<string | null> {
        if (this.refuseAfterDispose('putInDailyNote')) return null;
        return putInPeriodicNote(this.app, dailyNotes(this.app), date, line, Destination.taskSection(this.settings), this.channels);
    }

    /**
     * The periodic note `desc` names for `date` (`YYYY-MM-DD`), made of its
     * template when it is not there (`openPeriodicNote`): what a view opens
     * when a date, a week, a month or a year is clicked. Null when it could
     * not be made, the reason told the user once.
     */
    async openPeriodicNote(desc: PeriodicNote, date: string): Promise<TFile | null> {
        if (this.refuseAfterDispose('openPeriodicNote')) return null;
        return openPeriodicNote(this.app, desc, date, this.channels);
    }

    /**
     * Save `content` as the template note at `path`, over the note there or
     * made (`TemplateNote.saveTemplateNote`): a view's template, an interval
     * timer's. A whole note, not a row: it plans from no copy. `name` is what
     * the note is about, for a refusal.
     *
     * @returns the note, or null when it was not written, the reason told the
     * user once.
     */
    async saveTemplateNote(path: string, name: string, content: string): Promise<TFile | null> {
        if (this.refuseAfterDispose('saveTemplateNote')) return null;
        return saveTemplateNote(this.app, path, this.channels(path), name, content);
    }

    /**
     * Where a write made here outside the repository — a note put together
     * whole — reports what it did. Undefined once these operations are taken
     * down. It does not leave the operations: a consumer asks for the write.
     */
    private readonly channels: WriteChannels = (filePath) => this.repository.channelOf(filePath);
}
