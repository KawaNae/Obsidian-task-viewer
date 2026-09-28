import { type App, type EventRef, Notice, TFile } from 'obsidian';
import { t } from '../../i18n';
import type { DuplicateOptions, Task, TaskViewerSettings } from '../../types';
import { isTvInline } from '../../types';
import { TaskRepository } from '../persistence/TaskRepository';
import { PropertyUpdatePlanner } from '../persistence/PropertyUpdatePlanner';
import { FlowExecutor, type FireOp } from '../flow/FlowExecutor';
import { completes } from '../flow/FlowTrigger';
import type { EditorFireHost } from '../../editor/FlowFireExtension';
import type { FlowDeleteAssessment } from '../flow/FlowDeletion';
import { TaskStore } from './TaskStore';
import { TaskScanner } from './TaskScanner';
import { TaskValidator, type ValidationError } from './TaskValidator';
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
import { readInLine, type EditorLine, type Landing, type WriteOutcome } from '../persistence/FileLines';
import type { InsertPlace, TaskOp } from '../persistence/TaskOps';
import type { ContentKey } from './ContentKey';
import { checkCopy, checkFile, type CheckDeps } from './ReadingCheck';
import { DiskReconciler } from './DiskReconciler';
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
 * TaskIndex - タスク管理の統括ファサードクラス
 * 各種サービス（Store, Scanner, Validator, Repository, FlowExecutor）を統合
 */
export class TaskIndex {
    private store: TaskStore;
    private scanner: TaskScanner;
    private validator: TaskValidator;
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
     * comes (structure.md, 読みの鮮度). None where there is no disk to ask.
     */
    private readonly reconciler: DiskReconciler | null;

    /** What a check of a copy against the disk asks (`ReadingCheck`). */
    private readonly checks: CheckDeps;

    /** @param reconcile how the reconciler meets the host ({@link ReconcileOptions}). */
    constructor(private app: App, settings: TaskViewerSettings, reconcile: ReconcileOptions = {}) {
        this.settings = settings;
        this.parseFingerprint = computeParseFingerprint(settings);

        // サービスの初期化
        this.store = new TaskStore(settings);
        this.validator = new TaskValidator();
        this.repository = new TaskRepository(app);
        // Settings getter (not a snapshot): updateSettings replaces the
        // settings object, and trigger judgment must always see the latest
        // statusDefinitions.
        this.commandExecutor = new FlowExecutor(this.repository, this, app, () => this.settings);
        this.scanner = new TaskScanner(app, this.store, this.validator, settings);
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
     * was read of it, its warnings. A note deleted, renamed to something that
     * is not a note, or found gone from the disk (`DiskReconciler`). The
     * caller notifies.
     */
    private forgetFile(path: string): void {
        this.store.removeTasksByFile(path);
        this.scanner.handleFileDeleted(path);
        this.validator.clearErrorsForFile(path);
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
        this.store.updateSettings(settings);
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

    getValidationErrors(): ValidationError[] {
        return this.validator.getValidationErrors();
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
    private async withNotify<T>(filePath: string, op: () => Promise<T>): Promise<T> {
        this.apiWrites.mark(filePath);
        try {
            const result = await op();
            this.notifyImmediate();
            return result;
        } finally {
            this.apiWrites.clear(filePath);
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
     * write refused with a fire that writes lines is made without it in the
     * same attempt (`CompletionFire.writes`). Once the completion landed, the
     * user is told if its flow was not run: the fire's write was refused, or
     * its plan failed (`FlowExecutor.reportNotRun`).
     */
    private async writeCompleting(
        completingIn: string | null,
        write: (fire?: FireOp) => Promise<WriteOutcome>,
    ): Promise<boolean> {
        if (completingIn === null) return (await write()).written;
        const fire = this.commandExecutor.fireOp(completingIn);
        const outcome = await write(fire);
        if (!outcome.written) return false;
        const planned = fire.planned();
        if (outcome.insteadOf) this.commandExecutor.reportNotRun({ kind: 'refused', refusal: outcome.insteadOf });
        else if (planned?.kind === 'failed') this.commandExecutor.reportNotRun(planned);
        return true;
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
     * reading (structure.md, 読みの鮮度). Every write that plans from a copy
     * comes through here, and so do the drag and the card's menu before the
     * user puts work in (`confirmTask`).
     */
    private async copyToPlan(taskId: string, known: Task | undefined): Promise<Task | undefined> {
        const task = this.getTask(taskId);
        if (!task) {
            logWarn(`[TaskIndex] the index no longer holds the row: id=${taskId}`);
            // A row the caller named but the store never held here: say which
            // note, as a write refused before it read the note does.
            const file = known?.file ?? TaskIdGenerator.parse(taskId)?.filePath ?? '';
            await this.reportRefusal({ file, reason: { kind: 'gone' }, subject: known ? subjectOf(known) : file });
            return undefined;
        }
        const checked = await checkCopy(this.checks, task);
        if (checked.verdict === 'fresh') return task;
        const reason = checked.verdict === 'stale' ? { kind: 'stale' as const, disk: checked.disk } : { kind: 'unreadable' as const };
        await this.reportRefusal({ file: task.file, reason, subject: subjectOf(task) });
        return undefined;
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
                ? await this.repository.insertLineUnderHeading(filePath, taskLine, heading, 2)
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
     * What the editor's fire needs of this index (`flowFireExtension`): the
     * plan, the ops, and where its refusals go. After `dispose`, nothing
     * fires.
     */
    editorFireHost(): EditorFireHost {
        return {
            active: () => !this.disposed,
            statusDefinitions: () => this.settings.statusDefinitions,
            fireOp: (path) => this.commandExecutor.fireOp(path),
            applyOps: (draft, session, target, ops) => this.repository.applyOps(draft, session, target, ops),
            refused: (refusal) => { void this.reportRefusal(refusal); },
            notRun: (why) => this.commandExecutor.reportNotRun(why),
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
     * (structure.md, 読みの鮮度).
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
                // `gone`, `unplaceable`, `disturbs`: the note read as the index read it.
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
