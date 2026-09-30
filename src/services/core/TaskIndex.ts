import { type App, type EventRef, Notice, TFile } from 'obsidian';
import { t } from '../../i18n';
import type { DuplicateOptions, Task, TaskViewerSettings } from '../../types';
import { isTvInline } from '../../types';
import { TaskRepository } from '../persistence/TaskRepository';
import { PropertyUpdatePlanner } from '../persistence/PropertyUpdatePlanner';
import { FlowExecutor, type FireOp, notRunOf } from '../flow/FlowExecutor';
import { completes } from '../flow/FlowTrigger';
import type { EditorFireHost } from '../../editor/FlowFireExtension';
import type { EditorLineHost } from '../../editor/EditorWrite';
import type { FlowDeleteAssessment } from '../flow/FlowDeletion';
import { TaskStore } from './TaskStore';
import { TaskScanner } from './TaskScanner';
import { PathTtlWindow } from './PathTtlWindow';
import { refusalNotice, type IndexRefusal } from './RefusalClause';
import { NotifyCoalescer } from './NotifyCoalescer';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import { TaskParser } from '../parsing/TaskParser';
import { toDisplayTask } from '../display/DisplayTaskConverter';
import { planInPlaceCopies } from '../persistence/DuplicateShift';
import type { GenBlock } from '../parsing/gen/GenBlockCollector';
import { plannedOn, subjectOf } from '../persistence/TaskRefs';
import { logDebug, logError, logInfo, logWarn } from '../../log/log';
import { readInLine, type EditorLine, type Landing, type Refusal } from '../persistence/FileLines';
import type { FiringOutcome, InsertPlace, SubtreeReplacement, TaskOp } from '../persistence/TaskOps';
import { Destination, type Section } from '../persistence/Destination';
import type { SendTo } from '../persistence/writers/SendWriter';
import type { ContentKey } from './ContentKey';
import { checkCopy, checkFile, type CheckDeps, type OnDisk } from './ReadingCheck';
import { DiskReconciler } from './DiskReconciler';
import { outermostRows } from '../persistence/writers/SendRows';
import { diskProbeOf, type DiskProbe } from './DiskProbe';

/**
 * A row looked up by its anchor in a reading of the note as the disk holds it
 * (`TaskIndex.freshByAnchor`): the row, no row carrying the anchor, or a note
 * that could not be read — which says nothing of whether the row is there.
 */
export type AnchoredRow =
    | { kind: 'row'; task: Task }
    | { kind: 'none' }
    | { kind: 'unreadable' };

/** How the index's reconciler meets the host (`DiskReconciler`). */
export interface ReconcileOptions {
    /** Where the disk is asked: by default the one this app can have (`diskProbeOf`); null for none. */
    probe?: DiskProbe | null;
    /**
     * Whether a view type is one of the plugin's views, whose coming to the
     * front asks for a sweep. The views are the plugin's to name, not the
     * index's; none by default.
     */
    isOwnView?: (viewType: string) => boolean;
}

/**
 * A row a send takes (`TaskIndex.send`): its id, the row and its subtree as
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
 * What came of a send (`TaskIndex.send`): the note written, what the send
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

/** A row as the index read it, and the note's lines it was read in (`TaskIndex.rowSnapshot`). */
export interface RowSnapshot {
    task: Task;
    lines: readonly string[];
}

/**
 * TaskIndex - タスク管理の統括ファサードクラス
 * 各種サービス（Store, Scanner, Validator, Repository, FlowExecutor）を統合
 */
export class TaskIndex {
    private store: TaskStore;
    private scanner: TaskScanner;
    private repository: TaskRepository;
    private commandExecutor: FlowExecutor;
    private settings: TaskViewerSettings;
    private parseFingerprint: string;

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

    // 1 フレーム（16ms）分の通知を 1 回にまとめる。合流規則は NotifyCoalescer 側。
    private readonly notify = new NotifyCoalescer(
        (taskId, changes) => this.store.notifyListeners(taskId, changes),
        16,
    );

    // API CRUD (withNotify) の実行中を覚えておくためのウィンドウ。
    private readonly apiWrites = new PathTtlWindow(2000);

    /**
     * Every vault subscription this index opened, with the emitter that closes
     * it.
     *
     * Held because a subscription outlives the object that made it. An index
     * left listening after the plugin unloads keeps its own scanner and its own
     * flow executor, and the next load adds a second set: one file change is
     * then processed twice, and, while completions were read off the scans, a
     * completed command generated its next instance once per surviving
     * listener. That is what an update without a restart used to look like.
     */
    private eventRefs: { emitter: { offref(ref: EventRef): void }; ref: EventRef }[] = [];

    /**
     * Brings the index's readings to the disk when a change notice never
     * comes (structure/layers.md, 読みの鮮度). None where there is no disk to ask.
     */
    private readonly reconciler: DiskReconciler | null;

    /** What a check of a copy against the disk asks (`ReadingCheck`). */
    private readonly checks: CheckDeps;

    /** @param reconcile how the reconciler meets the host ({@link ReconcileOptions}). */
    constructor(private app: App, settings: TaskViewerSettings, reconcile: ReconcileOptions = {}) {
        this.settings = settings;
        this.parseFingerprint = computeParseFingerprint(settings);

        // サービスの初期化
        this.store = new TaskStore();
        this.repository = new TaskRepository(app);
        // Settings getter (not a snapshot): updateSettings replaces the
        // settings object, and trigger judgment must always see the latest
        // statusDefinitions.
        this.commandExecutor = new FlowExecutor(this.repository, this, app, () => this.settings);
        this.scanner = new TaskScanner(app, this.store, settings);
        // Connected here rather than built into the repository, because the
        // scanner does not exist when the repository does — and cut on dispose,
        // so a write that outlives this index lands nothing in it (see WriteChannels).
        this.repository.connect((path) => ({
            landed: landing => this.landed(path, landing),
            refused: refusal => { void this.reportRefusal(refusal); },
            follow: (read, line, now) => this.scanner.followLine(path, read, line, now),
            reading: () => this.scanner.readingOf(path),
        }));
        this.checks = {
            read: (path) => {
                const file = app.vault.getAbstractFileByPath(path);
                if (!(file instanceof TFile)) return Promise.reject(new Error(`no note at ${path}`));
                return readInLine(app, file);
            },
            follow: (path, read, line, now) => this.scanner.followLine(path, read, line, now),
            last: (path) => this.scanner.readingOf(path),
        };
        const probe = reconcile.probe === undefined ? diskProbeOf(app) : reconcile.probe;
        this.reconciler = probe && new DiskReconciler({
            files: () => app.vault.getMarkdownFiles(),
            readingOf: (path) => this.scanner.readingOf(path),
            reread: (file) => this.scanner.queueScan(file),
            forget: (path) => this.forgetFile(path),
            changed: () => this.notify.schedule(),
        }, probe, {
            workspace: app.workspace,
            win: typeof window === 'undefined' ? undefined : window,
            isOwnView: reconcile.isOwnView ?? (() => false),
        });
    }

    getRepository(): TaskRepository {
        return this.repository;
    }

    async initialize(): Promise<void> {
        this.app.workspace.onLayoutReady(async () => {
            await this.scanner.scanVault();
            // From the vault as read, the disk is checked against it.
            this.reconciler?.start();
        });

        // Vault イベントハンドラー
        this.own(this.app.vault, this.app.vault.on('modify', async (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // The file being dragged is read, but its reading is held back
                // from the store until the drag ends (`TaskScanner.hold`).
                await this.scanner.queueScan(file);
                // Skip notify when an API write (withNotify) is in flight for this
                // file — withNotify's own notifyImmediate is the authoritative notify.
                // Editor direct edits (no withNotify) are unaffected: the API
                // window is only marked during API CRUD operations. Nor for the
                // file being dragged: the drag draws it, and its end notifies.
                if (!this.apiWrites.has(file.path) && !this.scanner.holds(file.path)) {
                    this.notify.schedule();
                }
            }
        }));

        this.own(this.app.vault, this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.forgetFile(file.path);
                this.notify.schedule();
            }
        }));

        this.own(this.app.vault, this.app.vault.on('create', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                void this.rescanAndNotify(file);
            }
        }));

        this.own(this.app.metadataCache, this.app.metadataCache.on('changed', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // `changed` follows every write, and mostly echoes a change
                // the file's `modify` already had scanned — ours, someone
                // else's, or the drag's own commit read when the drag ended.
                // The scan answers that by content and skips the commit and the
                // notify when there is nothing new (see TaskScanner.queueScan).
                void this.scanner.queueScan(file).then(committed => {
                    if (committed) this.notify.schedule();
                });
            }
        }));

        this.own(this.app.vault, this.app.vault.on('rename', async (file, oldPath) => {
            // md → 非md（拡張子変更）: delete 扱い
            if (!(file instanceof TFile) || file.extension !== 'md') {
                this.forgetFile(oldPath);
                this.notify.schedule();
                return;
            }

            // 非md → md: create 扱い
            if (!oldPath.endsWith('.md')) {
                await this.rescanAndNotify(file);
                return;
            }

            // md → md（通常のリネーム）。ドラッグ中のファイルなら、保留も外れる。
            this.store.removeTasksByFile(oldPath);
            this.scanner.handleFileRenamed(oldPath, file.path);

            await this.rescanAndNotify(file);
        }));
    }

    /**
     * Take a note that is no longer there out of the index: its rows, what
     * was read of it. A note deleted, renamed to something that
     * is not a note, or found gone from the disk (`DiskReconciler`). The
     * caller notifies.
     */
    private forgetFile(path: string): void {
        this.store.removeTasksByFile(path);
        this.scanner.handleFileDeleted(path);
    }

    /** Remember a subscription so `dispose` can close it. */
    private own(emitter: { offref(ref: EventRef): void }, ref: EventRef): void {
        this.eventRefs.push({ emitter, ref });
    }

    /**
     * 閉じたあとの書き込みを断る。
     *
     * 購読を切っても、既にこの index の参照を持っている相手（reload 前から
     * 開いているハブ、走行中のタイマー）からの呼び出しは止まらない。断った
     * ことはログに残す — 黙って捨てると、書いたつもりの側が気づけない。
     */
    private refuseAfterDispose(operation: string): boolean {
        if (!this.disposed) return false;
        logWarn(`[TaskIndex] refused after dispose: ${operation}`);
        return true;
    }

    /**
     * A write of ours landed in `path`: the index reads what it left now,
     * rather than when the scan its `modify` starts gets there, so the next
     * operation plans from the file as it is. For the file being dragged the
     * reading is held back like any other of it (`TaskScanner.hold`); the
     * write's report is kept all the same, to follow names across it.
     */
    private landed(path: string, landing: Landing): void {
        if (this.scanner.landed(path, landing)) this.notify.schedule();
    }

    /** Read the file back into the store, then notify. */
    private async rescanAndNotify(file: TFile): Promise<void> {
        await this.scanner.queueScan(file);
        this.notify.schedule();
    }

    // ===== 通知制御 =====

    /**
     * 即時通知（debounceなし）。
     * ドラッグ完了後にDOMを即座に更新する必要がある場合に使用。
     * 引数あり: taskId / changes をリスナーに伝える。なし: 全体無効化。
     * 既存のdebounceタイマーはキャンセルして即座に実行する。
     */
    notifyImmediate(taskId?: string, changes?: string[]): void {
        this.notify.flushNow(taskId, changes);
    }

    // ===== ドラッグ制御 =====

    /**
     * ドラッグ中のファイルパスを設定する。そのファイルの読みは、誰が読んだ
     * ものも store に入れずに保留する（`TaskScanner.hold`）。ドラッグは
     * store の写しを描いているので、古い値で上書きしない。
     * 通知は呼び出し元（DragHandler）が notifyImmediate で明示的に行う。
     *
     * 終了時（null）には、保留した読みがあればファイルを読み直して入れ、
     * 通知する。ドラッグ確定の書き込みもここに含まれる: `DragSession.handleUp`
     * は commit を待ってからこれを下ろすので、確定の書き込みの読みは必ず
     * 保留される側に入る。
     */
    setDraggingFile(filePath: string | null): void {
        void this.scanner.hold(filePath).then(committed => {
            if (committed) this.notify.schedule();
        });
    }

    // ===== 設定 =====

    getSettings(): TaskViewerSettings {
        return this.settings;
    }

    updateSettings(settings: TaskViewerSettings): void {
        const newFingerprint = computeParseFingerprint(settings);
        const needsRescan = newFingerprint !== this.parseFingerprint;
        this.parseFingerprint = newFingerprint;
        this.settings = settings;
        TaskParser.rebuildChain(settings);
        this.scanner.updateSettings(settings);
        if (needsRescan) {
            this.scanner.scanVault()
                .catch((error) => {
                    logError(`[TaskIndex] Failed to rescan vault: ${(error as Error)?.message ?? error}`);
                });
        } else {
            this.store.notifyListenersStaggered();
        }
    }

    /**
     * Let go of everything this index is holding the vault by.
     *
     * The subscriptions come first: a timer that fires after unload wastes a
     * frame, while a listener that survives it keeps a whole second pipeline
     * alive — one that scans and writes against the vault the next load is
     * already working on.
     */
    dispose(): void {
        this.disposed = true;
        for (const { emitter, ref } of this.eventRefs) emitter.offref(ref);
        this.eventRefs = [];
        this.repository.disconnect();
        this.reconciler?.dispose();

        this.notify.dispose();
        this.apiWrites.dispose();
    }

    // ===== データアクセス (TaskStoreへ委譲) =====

    /** Current store revision number (incremented on every mutation). */
    getRevision(): number {
        return this.store.getRevision();
    }

    getTasks(): Task[] {
        return this.store.getTasks();
    }

    /**
     * The index's copy of the row `taskId` names, or undefined when it names
     * none now.
     *
     * A name lasts one reading of its file. One given before a write of ours
     * is followed across that write's report to the row's name now
     * (`TaskScanner.follow`), so the copy that comes back may carry another
     * name than the one asked for: whoever holds the name takes the new one
     * from it. A name from before a change that was not ours names nothing.
     * This is the one place a name is followed.
     */
    getTask(taskId: string): Task | undefined {
        const held = this.store.getTask(taskId);
        if (held) return held;
        const now = this.scanner.follow(taskId);
        return now === null ? undefined : this.store.getTask(now);
    }

    /**
     * The index's copy of the row `anchor` anchors in `filePath` now
     * (`Task.anchor`), or undefined when no row of the file's last reading
     * carries that `^id` alone. The one place an anchor is looked up.
     *
     * An anchor outlives readings, a name does not: what comes back is the
     * copy of the last reading, under that reading's name. A write to it goes
     * by that name, and so through the one check every write passes
     * (`WriteSession.row`): a file that changed since the reading refuses it.
     */
    getTaskByAnchor(filePath: string, anchor: string): Task | undefined {
        return this.getTasks().find(t => t.file === filePath && t.anchor === anchor);
    }

    /**
     * A generation block by name. Resolution is file-local: a command
     * reaches only the blocks of the file it is written in.
     */
    getGenBlock(filePath: string, name: string): GenBlock | undefined {
        return this.store.getGenBlock(filePath, name);
    }

    getTaskByFileLine(filePath: string, line: number): Task | undefined {
        return this.getTasks().find(t =>
            t.file === filePath && t.line === line
        );
    }

    /**
     * The task on line `line` of content `key`: a line an editor shows, in
     * the content it shows. Looked up only when the index's last reading of
     * the file is that content; null when it is another, since a line number
     * counts in nothing but the content it is in. Undefined when no task
     * stands on the line.
     */
    taskAtEditorLine(filePath: string, line: number, key: ContentKey): Task | undefined | null {
        if (this.scanner.readingOf(filePath).key !== key) return null;
        return this.getTaskByFileLine(filePath, line);
    }

    // ===== イベント管理 (TaskStoreへ委譲) =====

    onChange(callback: (taskId?: string, changes?: string[]) => void): () => void {
        return this.store.onChange(callback);
    }

    // ===== スキャン関連 (TaskScannerへ委譲) =====

    async requestScan(file: TFile): Promise<void> {
        return this.scanner.requestScan(file);
    }

    // ===== CRUD操作 =====

    /**
     * Wrap a write operation so that any successful completion is followed by
     * an immediate full notify. This guarantees that every TaskIndex write
     * triggers a UI refresh, regardless of whether the underlying file event
     * pipeline fires a debounced notify (e.g. local writes are intentionally
     * skipped in the vault.modify handler).
     *
     * Note: notifyImmediate() is called with no args → full invalidation.
     */
    private async withNotify<T>(filePath: string | readonly string[], op: () => Promise<T>): Promise<T> {
        const paths = typeof filePath === 'string' ? [filePath] : filePath;
        for (const path of paths) this.apiWrites.mark(path);
        try {
            const result = await op();
            this.notifyImmediate();
            return result;
        } finally {
            for (const path of paths) this.apiWrites.clear(path);
        }
    }

    /**
     * @returns whether the file was written. A `false` means the update was
     * reverted (see {@link revertUnwrittenUpdate}) — the index and the file
     * agree again, and nothing changed.
     */
    async updateTask(taskId: string, updates: Partial<Task>): Promise<boolean> {
        if (this.refuseAfterDispose('updateTask')) return false;
        logInfo(`[updateTask] id=${taskId} fields=[${Object.keys(updates)}]`);

        // 合成セグメント ID (##seg:YYYY-MM-DD) は TaskWriteService が原タスクへ
        // 解決してから渡す契約（3cd26e96 で consumer の規約から write 境界の構造的
        // 保証へ移した）。ここに届くのはその境界を迂回した呼び出しなので、書き込みは
        // baseId で通したうえで声を上げる。落として黙るより、再発を見つけられる方がよい。
        const segmentInfo = TaskIdGenerator.parseSegmentId(taskId);
        if (segmentInfo) {
            logWarn(`[TaskIndex] segment id reached updateTask, resolving to base: ${taskId}`);
            taskId = segmentInfo.baseId;
        }

        const id = taskId;
        const known = this.getTask(id);
        return this.onRow(id, () => this.writeUpdate(id, updates, known));
    }

    /** {@link updateTask}, once every write already asked of the row has finished. */
    private async writeUpdate(taskId: string, updates: Partial<Task>, known: Task | undefined): Promise<boolean> {
        const task = await this.copyToPlan(taskId, known);
        if (!task) return false;
        if (task.isReadOnly) return false;

        // 非時刻プロパティ（color/tags/custom 等）の書き込み操作を導出。
        // before スナップショット（Object.assign 前）との diff が必要なので
        // ここで評価する。
        const propertyOps = PropertyUpdatePlanner.plan(task, updates, this.settings.scopeKeys);

        // 更新前の姿。行の探索と、書けなかったときの巻き戻しの両方で要る。
        const before: Task = { ...task };

        Object.assign(task, updates);
        this.store.bumpRevision();

        // ドラッグ中のファイルはnotifyをスキップ（ドラッグ終了時にsetDraggingFile(null)で一括通知）
        if (!this.scanner.holds(task.file)) {
            this.store.notifyListeners(taskId, Object.keys(updates));
        }

        // All inline tasks route through InlineTaskWriter; TaskParser.format
        // dispatches by parserId. TVInlineParser.format() handles both
        // bare-checkbox and @notation-bearing output, so a task gaining or
        // losing date fields just produces the right line — no parserId
        // promotion/demotion needed.
        //
        // 探索は更新前の姿で行う。ファイルに書かれているのは更新前の行なので、
        // 更新後の日付や時刻で探しに行くと、まさにその値を変える更新のときに
        // 空振りする。第 2 引数が書く内容、第 1 引数がどの行かを決める。
        // 子のプロパティ行も写しの値から作るので、書き換えるときは部分木も
        // 計画が読んだものになる。外から足したタグの上に写しのタグを書かない。
        //
        // 行を完了させる書き換えは、同じ書き込みでフローを発火させる。完了か
        // どうかは、書き込みが照合する土台の行と書く行の対で答える
        // （`completes`）。発火の計画は書き込みの中で、書く行から立てる。
        const target = plannedOn(before, { subtree: propertyOps.length > 0 });
        const written = await this.writeCompleting(
            completes(before.originalText, TaskParser.format(task), this.settings.statusDefinitions) ? task.file : null,
            (fire) => this.repository.updateTaskInFile(target, task, propertyOps, fire));

        if (!written) {
            this.revertUnwrittenUpdate(task, taskId, before, updates);
            return false;
        }
        return true;
    }

    /**
     * A write that may complete a row (`completingIn`, its file; null when it
     * does not), made with the row's fire in it: whether it was written. A
     * write refused with the fire in it is made without it in the same
     * attempt (`InlineTaskWriter.writeFiring`), and the user told
     * ({@link tellNotRun}).
     */
    private async writeCompleting(
        completingIn: string | null,
        write: (fire?: FireOp) => Promise<FiringOutcome<FireOp>>,
    ): Promise<boolean> {
        const outcome = await write(completingIn === null ? undefined : this.commandExecutor.fireOp(completingIn));
        this.tellNotRun(outcome);
        return outcome.written;
    }

    /**
     * Once a write that completed rows landed, tell the user of each row
     * whose flow was not run, once: its fire was set aside, the write with it
     * refused, or its plan failed, or it fired without its move
     * (`FlowExecutor.reportNotRun`). The one word of it for every write of
     * the index that completes rows.
     */
    private tellNotRun(outcome: FiringOutcome<FireOp>): void {
        if (!outcome.written) return;
        for (const { fire, setAside } of outcome.fires) {
            const notRun = setAside ? { kind: 'refused' as const, refusal: setAside } : notRunOf(fire.planned());
            if (notRun) this.commandExecutor.reportNotRun(notRun);
        }
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
        const known = this.getTask(taskId);
        const hear = opts.tellRefusal === false
            ? (refusal: IndexRefusal) => this.learnFrom(refusal)
            : (refusal: IndexRefusal) => this.reportRefusal(refusal);
        return this.onRow(taskId, async () => {
            const planned = await this.planCopy(taskId, known, hear);
            if ('refused' in planned) return { written: false, refused: planned.refused };
            const { task } = planned;
            if (task.isReadOnly || base.length === 0) {
                logWarn(`[TaskIndex] replaceSubtree: not a row to write: id=${taskId}`);
                return { written: false, refused: null };
            }
            return this.withNotify(task.file, async () => {
                logInfo(`[replaceSubtree] id=${taskId} lines=${base.length}->${replacement.children.length + 1}`);
                const target = { ...plannedOn(task), basis: { text: base[0], subtree: base } };
                const defs = this.settings.statusDefinitions;
                const outcome = await this.repository.replaceSubtreeInFile(target, replacement, {
                    completes: (was, now) => completes(was, now, defs),
                    fire: () => this.commandExecutor.fireOp(task.file),
                }, { refused: (refusal) => { void hear(refusal); } });
                this.tellNotRun(outcome);
                return outcome.written ? { written: true } : { written: false, refused: outcome.refused };
            });
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
            ? (refusal: IndexRefusal) => this.learnFrom(refusal)
            : (refusal: IndexRefusal) => this.reportRefusal(refusal);
        const asked = new Map<string, SendRow>();
        for (const row of rows) if (!asked.has(row.taskId)) asked.set(row.taskId, row);
        const known = new Map([...asked.keys()].map(id => [id, this.getTask(id)]));
        // Every row's writes queued in one order, so two sends of the same
        // rows never wait for each other.
        const ids = [...asked.keys()].sort();
        return this.onRows(ids, async (): Promise<SendWrite> => {
            const planned: { task: Task; row: SendRow }[] = [];
            for (const id of ids) {
                const copy = await this.planCopy(id, known.get(id), hear);
                if ('refused' in copy) return { kind: 'not-done', refused: copy.refused };
                const row = asked.get(id)!;
                if (copy.task.isReadOnly || row.base.length === 0) {
                    logWarn(`[TaskIndex] send: not a row to write: id=${id}`);
                    return { kind: 'not-done', refused: null };
                }
                planned.push({ task: copy.task, row });
            }
            const sent = outermostRows(planned);
            for (const { row } of planned) {
                if (row.draft && !sent.some(one => one.row === row)) {
                    logWarn(`[TaskIndex] send: a draft of a row in another's subtree is not written: id=${row.taskId}`);
                }
            }
            if (to.create && sent.some(({ task }) => task.file === to.path)) {
                logWarn(`[TaskIndex] send: a note to make holds rows already: to=${to.path}`);
                return { kind: 'not-done', refused: null };
            }
            const paths = [...new Set([to.path, ...sent.map(({ task }) => task.file)])];
            return this.withNotify(paths, async (): Promise<SendWrite> => {
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
                for (const write of outcome.writes) this.tellNotRun(write);
                for (const refusal of outcome.refused) await this.learnFrom(refusal);
                logInfo(`[send] landed=${outcome.landed.join(',') || '-'} refused=${outcome.refused.map(one => `${one.file}:${one.reason.kind}`).join(',') || '-'} takenBack=${outcome.takenBack}`);
                return {
                    kind: 'done', note: outcome.note, subject: subjectOf(sent[0].task),
                    landed: outcome.landed, refused: outcome.refused, takenBack: outcome.takenBack,
                };
            });
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
     * asked for, to say which row it was.
     *
     * A copy the disk no longer reads as (`checkCopy`: a change the index was
     * never told of) is not planned from: it is refused as `stale`, the note
     * is read again, and the user is asked to do it again, from the new
     * reading (structure/layers.md, 読みの鮮度). Every write that plans from a copy
     * comes through here, and so do the drag and the card's menu before the
     * user puts work in (`confirmTask`).
     */
    private async copyToPlan(taskId: string, known: Task | undefined): Promise<Task | undefined> {
        const planned = await this.planCopy(taskId, known);
        return 'task' in planned ? planned.task : undefined;
    }

    /**
     * {@link copyToPlan}, with why not when the copy is not the row on the
     * disk: handed to `hear` — told the user and learnt from
     * (`reportRefusal`), or only learnt from, for a caller that shows it in
     * a place of its own (the hub's source mode) — and answered too.
     */
    private async planCopy(
        taskId: string,
        known: Task | undefined,
        hear: (refusal: IndexRefusal) => Promise<void> = (refusal) => this.reportRefusal(refusal),
    ): Promise<{ task: Task; disk: OnDisk | null } | { refused: IndexRefusal }> {
        const task = this.getTask(taskId);
        if (!task) {
            logWarn(`[TaskIndex] the index no longer holds the row: id=${taskId}`);
            // A row the caller named but the store never held here: say which
            // note, as a write refused before it read the note does.
            const file = known?.file ?? TaskIdGenerator.parse(taskId)?.filePath ?? '';
            const refused: IndexRefusal = { file, reason: { kind: 'gone' }, subject: known ? subjectOf(known) : file };
            await hear(refused);
            return { refused };
        }
        const checked = await checkCopy(this.checks, task);
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
        const known = this.getTask(taskId);
        return this.onRow(taskId, async () => {
            const planned = await this.planCopy(taskId, known);
            if ('refused' in planned) return undefined;
            const { task, disk } = planned;
            if (!disk?.read) {
                logWarn(`[TaskIndex] rowSnapshot: the copy was not read in what the disk holds: id=${taskId}`);
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
            const checked = await checkFile(this.checks, filePath);
            switch (checked.verdict) {
                case 'fresh':
                    break;
                case 'unread':
                    // Not read yet, as at startup: no change notice was missed.
                    logDebug(`[ReadingCheck] unread file=${filePath} subject=^${anchor}`);
                    if (await this.scanner.queueScan(file)) this.notify.schedule();
                    break;
                case 'stale':
                    await this.learnFrom({ file: filePath, reason: { kind: 'stale', disk: checked.disk }, subject: `^${anchor}` });
                    break;
                case 'unreadable':
                    await this.learnFrom({ file: filePath, reason: { kind: 'unreadable' }, subject: `^${anchor}` });
                    return { kind: 'unreadable' };
            }
        }
        const task = this.getTaskByAnchor(filePath, anchor);
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
     * copy, which this one does not change.
     */
    private onRow<T>(taskId: string, op: () => Promise<T>): Promise<T> {
        const queue = (this.rowWrites ??= new Map<string, Promise<unknown>>());
        const previous = queue.get(taskId) ?? Promise.resolve();
        // After the one before, whether it landed or threw.
        const next = previous.then(op, op);
        queue.set(taskId, next);
        const settled = () => { if (queue.get(taskId) === next) queue.delete(taskId); };
        next.then(settled, settled);
        return next;
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
     * 書き込みが 1 バイトも書かなかった更新を取り消す。
     *
     * index を先に書き換える設計なので、書けなかった更新を残すと画面とファイルが
     * 食い違ったまま居座る。値を戻す。拒否の理由は書き込みの層が伝え、拒否された
     * ノートの読み直しは拒否の1か所（`reportRefusal`）が頼む。
     */
    private revertUnwrittenUpdate(
        task: Task,
        taskId: string,
        before: Task,
        updates: Partial<Task>,
    ): void {
        // 触ったキーだけを戻す。更新で新たに生えたキーは、スナップショットに
        // undefined として写っているので同じ手順で消える。
        const source = before as unknown as Record<string, unknown>;
        const target = task as unknown as Record<string, unknown>;
        for (const key of Object.keys(updates)) {
            target[key] = source[key];
        }
        this.store.bumpRevision();
        if (!this.scanner.holds(task.file)) {
            this.store.notifyListeners(taskId, Object.keys(updates));
        }

        // The write layer has told the user why (see reportRefusal).
        logWarn(`[TaskIndex] update was not written, reverted: id=${taskId} fields=[${Object.keys(updates)}]`);
    }

    /**
     * What deleting this task would cost its flow command, answered without
     * writing anything. The delete menu asks before it decides what to offer.
     */
    assessFlowDelete(taskId: string): FlowDeleteAssessment {
        const task = this.getTask(taskId);
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
        const known = this.getTask(taskId);
        return this.onRow(taskId, () => this.writeDelete(taskId, options, known));
    }

    /** {@link deleteTask}, once every write already asked of the row has finished. */
    private async writeDelete(taskId: string, options: { fireFlow?: boolean }, known: Task | undefined): Promise<boolean> {
        const task = await this.copyToPlan(taskId, known);
        if (!task) return false;
        return this.withNotify(task.file, async () => {
            logInfo(`[deleteTask] id=${taskId} fireFlow=${options.fireFlow === true}`);
            if (task.isReadOnly) return false;


            let removed: boolean;
            if (options.fireFlow && isTvInline(task)) {
                removed = await this.commandExecutor.fireAndDelete(task);
            } else {
                // The row and the subtree the index read (`plannedOn`): a line
                // written into the subtree since is not taken with it.
                removed = (await this.repository.applyToTask(plannedOn(task, { subtree: true }), [{ kind: 'remove' }])).written;
                if (!removed) {
                    // Nothing was written, so no rescan follows and the store
                    // still holds a task the file also still holds. They agree,
                    // and the caller must not report the task gone.
                    logWarn(`[TaskIndex] delete was not written: id=${taskId}`);
                }
            }

            return removed;
        });
    }

    /** @returns whether the copy was written. */
    async duplicateTask(taskId: string, options?: DuplicateOptions): Promise<boolean> {
        if (this.refuseAfterDispose('duplicateTask')) return false;
        const known = this.getTask(taskId);
        return this.onRow(taskId, async () => {
            const task = await this.copyToPlan(taskId, known);
            if (!task) return false;
            return this.writeDuplicateOf(task, taskId, options);
        });
    }

    /** {@link duplicateTask} on the copy the store holds once the row's earlier writes are done. */
    private async writeDuplicateOf(task: Task, taskId: string, options?: DuplicateOptions): Promise<boolean> {
        return this.withNotify(task.file, async () => {
            if (task.isReadOnly) return false;


            const written = await this.writeDuplicate(task, options);
            if (!written) {
                logWarn(`[TaskIndex] duplicate was not written: id=${taskId}`);
            }

            return written;
        });
    }

    /**
     * Route a duplicate to the axis its options ask for.
     *
     * `dayOffset` picks the axis and `count` says how many copies: without an
     * offset the copies run along the clock, each starting where the one
     * before it ends, and with one they run along the calendar as they always
     * have. The in-place copies are composed here rather than in the writer,
     * because deciding where they sit needs the effective dates — the hour a
     * task was given implicitly is as much its end as a written one — and
     * those are resolved at this layer. The writer is handed finished lines,
     * the same division the recurrence path uses.
     */
    private async writeDuplicate(task: Task, options?: DuplicateOptions): Promise<boolean> {
        const { dayOffset = 0, count = 1 } = options ?? {};
        if (dayOffset !== 0) {
            return (await this.repository.duplicateInlineTask(plannedOn(task), options)).written;
        }

        const display = toDisplayTask(task, this.settings.startHour, (id) => this.store.getTask(id));
        const copies = planInPlaceCopies(task, display, count);
        const outcome = await this.repository.duplicateInlineTaskInPlace(
            plannedOn(task),
            copies.kind === 'verbatim'
                ? copies
                : { kind: 'lines', lines: copies.tasks.map(copy => TaskParser.format(copy)) },
        );
        return outcome.written;
    }

    /**
     * @returns the line the task was written on, or null when it was not — a
     * write that was not has told the user why.
     */
    async createTask(filePath: string, taskLine: string, heading?: string): Promise<number | null> {
        if (this.refuseAfterDispose('createTask')) return null;
        return this.withNotify(filePath, async () => {
            logInfo(`[createTask] path=${filePath} heading=${heading ?? '(none)'}`);

            const outcome = heading
                ? await this.repository.insertLineUnderHeading(filePath, taskLine, Destination.sectionNamed(heading, this.settings))
                : await this.repository.appendTaskToFile(filePath, taskLine);
            // What the write left is in the index once it landed (`landed`):
            // the caller finds the row on its line without waiting for a scan.
            return outcome.written ? outcome.line : null;
        });
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
            const task = await this.copyToPlan(taskId, undefined);
            if (!task) return false;
            if (task.isReadOnly) return false;
            return this.withNotify(task.file, async () => {
                logInfo(`[insertLine] taskId=${taskId} place=${place}${rowId === undefined ? '' : ` rowId=${rowId ?? '(off)'}`}`);
                const ops: TaskOp[] = [];
                if (rowId !== undefined) ops.push({ kind: 'update', text: TaskParser.format({ ...task, blockId: rowId ?? undefined }) });
                ops.push({ kind: 'insert', place, text: line });
                const { written } = await this.repository.applyToTask(plannedOn(task), ops);
                return written;
            });
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
    async writeLine(filePath: string, at: EditorLine, ops: readonly TaskOp[]): Promise<boolean> {
        if (this.refuseAfterDispose('writeLine')) return false;
        return this.withNotify(filePath, async () => {
            const defs = this.settings.statusDefinitions;
            const completing = ops.some(op => op.kind === 'update' && completes(at.text, op.text, defs));
            return this.writeCompleting(
                completing ? filePath : null,
                (fire) => this.repository.applyToLine(filePath, at, ops, { fire }));
        });
    }

    /**
     * What the editor's fire needs of this index (`fireFilter`): the plan,
     * the ops, and where its not-run goes. After `dispose`, nothing fires.
     */
    editorFireHost(): EditorFireHost {
        return {
            active: () => !this.disposed,
            statusDefinitions: () => this.settings.statusDefinitions,
            fireOp: (path) => this.commandExecutor.fireOp(path),
            applyOps: (draft, session, target, ops) => this.repository.applyOps(draft, session, target, ops),
            notRun: (why) => this.commandExecutor.reportNotRun(why),
        };
    }

    /**
     * What the editor menu's write needs of this index (`writeEditorLine`):
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
        return this.learnFrom(refusal);
    }

    /**
     * What the index does when an operation found its note other than the
     * index read it, by the reason's kind, in one place: the log line, the
     * reading asked for, and what the reconciler is asked
     * (structure/layers.md, 読みの鮮度).
     *
     * `stale`: the note is read now, so the operation asked again plans from
     * the new reading, and the reconciler sweeps — one change notice missed
     * is evidence that others were too. `changed`, `failed`, `unreadable`: the
     * reconciler reads the note again at a sweep whatever its stat says,
     * since an edit the stat does not show, or a read that failed, is not
     * found by the stat. Not told the user: a row looked up by its anchor
     * (`freshByAnchor`) comes here and goes on.
     */
    private async learnFrom({ file, reason, subject }: IndexRefusal): Promise<void> {
        switch (reason.kind) {
            case 'stale': {
                logInfo(`[ReadingCheck] stale file=${file} subject=${subject}`
                    + ` disk=${shortKey(reason.disk)} last=${shortKey(this.scanner.readingOf(file).key)}`);
                const note = this.app.vault.getAbstractFileByPath(file);
                if (note instanceof TFile && await this.scanner.queueScan(note)) this.notify.schedule();
                this.reconciler?.request('stale');
                return;
            }
            case 'unreadable':
                logInfo(`[ReadingCheck] unreadable file=${file} subject=${subject}`);
                break;
            default:
                logWarn(`[TaskIndex] refused: file=${file} reason=${reason.kind} subject=${subject}`);
                // `gone`, `unplaceable`, `disturbs`, `headings`: the note read as the index read it.
                if (reason.kind !== 'changed' && reason.kind !== 'failed') return;
        }
        this.reconciler?.request('refusal', file);
    }

}

/** A content key as a log line gives it: the line count and the length, the hash cut short. */
function shortKey(key: ContentKey | undefined): string {
    if (!key) return '-';
    const cut = key.lastIndexOf(':');
    return `${key.slice(0, cut + 1)}${key.slice(cut + 1, cut + 7)}…`;
}

// ── Parse-affecting settings fingerprint ──
// These keys control how files are parsed into tasks. Changing any of them
// requires a full vault re-scan. All other settings (startHour, UI toggles,
// timer durations, etc.) are display-only and need only a notify.
//
// Uses a JSON fingerprint because the caller may pass the same object reference
// (plugin.settings is mutated in place, then updateSettings(this.settings) is
// called with the same ref). Field-by-field prev/next comparison would always
// see them as equal.
//
//   scopeKeys          — frontmatter field names for tv-start/end/due/etc.
//   enableDayPlanner    — toggles DayPlanner parser in the chain
//   enableTasksPlugin   — toggles TasksPlugin parser in the chain
//   tasksPluginMapping  — emoji-to-field mapping for TasksPlugin parser
//
// Not statusDefinitions: which status chars count as complete is read where a
// completion is answered and where a view draws, never by the parse, so a
// change to it needs only the notify.
export function computeParseFingerprint(settings: TaskViewerSettings): string {
    return JSON.stringify([
        settings.scopeKeys,
        settings.enableDayPlanner,
        settings.enableTasksPlugin,
        settings.tasksPluginMapping,
    ]);
}
