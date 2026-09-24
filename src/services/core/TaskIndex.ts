import { type App, type EventRef, Notice, TFile } from 'obsidian';
import { t } from '../../i18n';
import type { DuplicateOptions, Task, TaskViewerSettings } from '../../types';
import { isTvInline } from '../../types';
import { TaskRepository } from '../persistence/TaskRepository';
import { PropertyUpdatePlanner } from '../persistence/PropertyUpdatePlanner';
import { FlowExecutor } from '../flow/FlowExecutor';
import type { FlowDeleteAssessment } from '../flow/FlowDeletion';
import { TaskStore } from './TaskStore';
import { TaskScanner } from './TaskScanner';
import { TaskValidator, type ValidationError } from './TaskValidator';
import { EditorSignal } from './EditorSignal';
import { EditorObserver } from './EditorObserver';
import { PathTtlWindow } from './PathTtlWindow';
import { NotifyCoalescer } from './NotifyCoalescer';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import { TaskParser } from '../parsing/TaskParser';
import { toDisplayTask } from '../display/DisplayTaskConverter';
import { planInPlaceCopies } from '../persistence/DuplicateShift';
import type { GenBlock } from '../parsing/gen/GenBlockCollector';
import { FileOperations } from '../persistence/utils/FileOperations';
import { plannedOn, subjectOf } from '../persistence/TaskRefs';
import { logError, logInfo, logWarn } from '../../log/log';
import type { EditorLine, EditorSubtree, Refusal, RowLines } from '../../utils/FileLines';

/**
 * TaskIndex - タスク管理の統括ファサードクラス
 * 各種サービス（Store, Scanner, Validator, EditorSignal, EditorObserver）を統合
 */
export class TaskIndex {
    private store: TaskStore;
    private scanner: TaskScanner;
    private validator: TaskValidator;
    private editorSignal: EditorSignal;
    private editorObserver: EditorObserver;
    private repository: TaskRepository;
    private commandExecutor: FlowExecutor;
    private settings: TaskViewerSettings;
    private parseFingerprint: string;
    private draggingFilePath: string | null = null;  // ドラッグ中のファイルパス

    /**
     * ドラッグ中に読み飛ばした変更のパス。終了時に読み直すために覚えておく。
     * 常に `draggingFilePath` と同じ。
     */
    private skippedDuringDrag: string | null = null;

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
     * left listening after the plugin unloads keeps its own scanner, its own
     * completion memory and its own flow executor, and the next load adds a
     * second set: one file change is then processed twice, and a completed
     * command generates its next instance once per surviving listener. That is
     * what an update without a restart used to look like.
     */
    private eventRefs: { emitter: { offref(ref: EventRef): void }; ref: EventRef }[] = [];

    constructor(private app: App, settings: TaskViewerSettings) {
        this.settings = settings;
        this.parseFingerprint = computeParseFingerprint(settings);

        // サービスの初期化
        this.store = new TaskStore(settings);
        this.validator = new TaskValidator();
        this.editorSignal = new EditorSignal();
        this.repository = new TaskRepository(app);
        // Settings getter (not a snapshot): updateSettings replaces the
        // settings object, and trigger judgment must always see the latest
        // statusDefinitions.
        this.commandExecutor = new FlowExecutor(this.repository, this, app, () => this.settings);
        this.editorObserver = new EditorObserver(app, this.editorSignal);
        this.scanner = new TaskScanner(
            app, this.store, this.validator,
            this.editorSignal, this.commandExecutor, settings
        );
        // Connected here rather than built into the repository, because the
        // scanner does not exist when the repository does — and cut on dispose,
        // so a write that outlives this index files nothing (see WriteObserver).
        this.repository.getWriteObserver().connect((path, origin) => ({
            sink: this.scanner.writeSink(path, origin),
            locate: (lines, ref) => this.scanner.locate(path, lines, ref),
            onRecord: (lines, ref, line) => this.scanner.onRecord(path, lines, ref, line),
            refused: refusal => this.reportRefusal(refusal),
        }));
    }

    getRepository(): TaskRepository {
        return this.repository;
    }

    async initialize(): Promise<void> {
        this.app.workspace.onLayoutReady(async () => {
            await this.scanner.scanVault();
            this.scanner.setInitializing(false);
        });

        // エディタ監視の開始
        this.editorObserver.setupInteractionListeners();

        // Vault イベントハンドラー
        this.own(this.app.vault, this.app.vault.on('modify', async (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // ドラッグ中のファイルはスキャンをスキップ（古い値でストアが上書きされるのを防止）。
                // 飛ばしたことは覚えておき、ドラッグの終了時に読み直す。忘れると、
                // その間に届いた変更を読む契機がどこにも無くなる。
                if (this.draggingFilePath === file.path) {
                    this.skippedDuringDrag = file.path;
                    return;
                }

                await this.scanner.queueScan(file);
                // Skip notify when an API write (withNotify) is in flight for this
                // file — withNotify's own notifyImmediate is the authoritative notify.
                // Editor direct edits (no withNotify) are unaffected: the API
                // window is only marked during API CRUD operations.
                if (!this.apiWrites.has(file.path)) {
                    this.notify.schedule();
                }
            }
        }));

        this.own(this.app.vault, this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.store.removeTasksByFile(file.path);
                this.scanner.handleFileDeleted(file.path);
                this.validator.clearErrorsForFile(file.path);
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
                // ドラッグ中のファイルはスキャンをスキップ
                if (this.draggingFilePath === file.path) {
                    return;
                }
                // `changed` follows every write, and mostly echoes a change
                // the file's `modify` already had scanned — ours, someone
                // else's, or the drag's own commit read when the drag ended.
                // The scan answers that by content and skips the commit and the
                // notify when there is nothing new (see rescanUnlessRead).
                void this.scanner.rescanUnlessRead(file).then(committed => {
                    if (committed) this.notify.schedule();
                });
            }
        }));

        this.own(this.app.vault, this.app.vault.on('rename', async (file, oldPath) => {
            // md → 非md（拡張子変更）: delete 扱い
            if (!(file instanceof TFile) || file.extension !== 'md') {
                this.store.removeTasksByFile(oldPath);
                this.scanner.handleFileDeleted(oldPath);
                this.validator.clearErrorsForFile(oldPath);
                this.notify.schedule();
                return;
            }

            // 非md → md: create 扱い
            if (!oldPath.endsWith('.md')) {
                await this.rescanAndNotify(file);
                return;
            }

            // md → md（通常のリネーム）
            if (this.draggingFilePath === oldPath) {
                this.draggingFilePath = null;
            }
            this.editorSignal.forget(oldPath);

            this.store.removeTasksByFile(oldPath);
            this.scanner.handleFileRenamed(oldPath, file.path);

            await this.rescanAndNotify(file);
        }));
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
     * ドラッグ中のファイルパスを設定する。
     * 指定されたファイルのスキャンをスキップし、ストアの上書きを防止。
     * 通知は呼び出し元（DragHandler）が notifyImmediate で明示的に行う。
     *
     * 終了時（null）には、その間に飛ばした変更を読み直す。ドラッグ確定の
     * 書き込みもここに含まれる: `DragSession.handleUp` は commit を待ってから
     * rAF でこのフラグを下ろすので、確定の modify は必ず飛ばされる側に入る。
     * 読み直さないと ledger が前回のまま残り、そのタスクを握っていたハブや
     * 選択が、後の無関係な再スキャンで外れる。外から書き換えられた場合は
     * ストアの値自体が古いまま残る。
     */
    setDraggingFile(filePath: string | null): void {
        this.draggingFilePath = filePath;
        if (filePath !== null) return;

        const skipped = this.skippedDuringDrag;
        this.skippedDuringDrag = null;
        if (!skipped) return;

        const file = this.app.vault.getAbstractFileByPath(skipped);
        if (file instanceof TFile) {
            void this.rescanAndNotify(file);
        }
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
     * alive — one that scans, detects completions and fires flow commands
     * against the vault the next load is already working on.
     */
    dispose(): void {
        this.disposed = true;
        this.skippedDuringDrag = null;
        for (const { emitter, ref } of this.eventRefs) emitter.offref(ref);
        this.eventRefs = [];
        this.editorObserver.dispose();
        this.repository.getWriteObserver().disconnect();

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

    getTask(taskId: string): Task | undefined {
        return this.store.getTask(taskId);
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

    getTaskLineNumbersForFile(filePath: string): Set<number> {
        const lines = new Set<number>();
        for (const task of this.getTasks()) {
            if (task.file === filePath) {
                lines.add(task.line);
            }
        }
        return lines;
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

    async waitForScan(filePath: string): Promise<void> {
        return this.scanner.waitForScan(filePath);
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
        const known = this.store.getTask(id);
        return this.onRow(id, () => this.writeUpdate(id, updates, known));
    }

    /** {@link updateTask}, once every write already asked of the row has finished. */
    private async writeUpdate(taskId: string, updates: Partial<Task>, known: Task | undefined): Promise<boolean> {
        const task = this.copyForWrite(taskId, known);
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
        if (this.draggingFilePath !== task.file) {
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
        const outcome = await this.repository.updateTaskInFile(
            plannedOn(before, { subtree: propertyOps.length > 0 }), task, propertyOps);

        if (!outcome.written) {
            this.revertUnwrittenUpdate(task, taskId, before, updates);
            return false;
        }
        this.adoptWrittenRow(task, taskId, before, outcome.rows.get(before.id));
        return true;
    }

    /**
     * The copy of a row a write is planned from, or undefined when the store no
     * longer holds the row — an earlier write to it took it away, or a scan
     * read the file without it — which is told once, as `gone`, like any
     * write that finds its row gone. `known` is the copy as the write was
     * asked for, to say which row it was.
     */
    private copyForWrite(taskId: string, known: Task | undefined): Task | undefined {
        const task = this.store.getTask(taskId);
        if (task) return task;
        logWarn(`[TaskIndex] write to a row the index no longer holds: id=${taskId}`);
        // A row the caller named but the store never held here: say which
        // note, as a write refused before it read the note does.
        const file = known?.file ?? TaskIdGenerator.parse(taskId)?.filePath ?? '';
        this.reportRefusal({
            file,
            reason: { kind: 'gone' },
            subject: known ? subjectOf(known) : file,
        });
        return undefined;
    }

    /**
     * Run `op` once every write already asked of this row has finished.
     *
     * A write that names a row is planned from the index's copy of it
     * (`plannedOn`), and a card's update brings the copy up to what it wrote
     * only when its write is back (`adoptWrittenRow`). A second write asked
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
     * Bring the copy of a row a card's update wrote up to the lines the write
     * left, before any scan reads them.
     *
     * The next write to this row is planned from the copy (`plannedOn`), and
     * the copy's fields already say what the update wrote — `Object.assign`
     * put them there before the line was made from them. Only the line and the
     * subtree, which the scan reads, would still say what was there before, so
     * a second update or a deletion fire in the moment before the scan would
     * be refused against our own write. The write knows what it left.
     *
     * The line always: the update was planned from it, and the write checked
     * the file still read so. The subtree only when the write found it as the
     * copy has it. The update did not plan from the subtree, so a line written
     * into it from outside since the scan was not checked — taken into the
     * copy, it would become part of what the next delete plans from, and go
     * with the row unseen. Otherwise the copy is left with no subtree, and a
     * delete before the scan is refused if the row has any.
     *
     * Only the copy the store still holds: a scan that has already read the
     * write has replaced it with its own reading, which is newer. The ledger is
     * not touched — only a scan writes it.
     */
    private adoptWrittenRow(task: Task, taskId: string, before: Task, lines: RowLines | undefined): void {
        if (!lines || this.store.getTask(taskId) !== task) return;
        task.originalText = lines.left[0];
        const planned = before.subtreeLines;
        const unchanged = planned !== undefined && planned.length === lines.read.length
            && planned.every((line, i) => line === lines.read[i]);
        task.subtreeLines = unchanged ? lines.left : undefined;
    }

    /**
     * 書き込みが 1 バイトも書かなかった更新を取り消す。
     *
     * index を先に書き換える設計なので、書けなかった更新を残すと画面とファイルが
     * 食い違ったまま居座る。しかも何も書かなければ `vault.modify` が発火せず
     * 再スキャンも走らないため、index を正す唯一の経路が、まさに落ちたその書き込み
     * 自身に依存してしまう。値を戻し、再スキャンを促し、これまで警告ログだけで
     * 黙って捨てていた失敗をユーザーにも伝える。
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
        if (this.draggingFilePath !== task.file) {
            this.store.notifyListeners(taskId, Object.keys(updates));
        }

        // The write layer has told the user why (see reportRefusal).
        logWarn(`[TaskIndex] update was not written, reverted: id=${taskId} fields=[${Object.keys(updates)}]`);

        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (file instanceof TFile) {
            void this.scanner.requestScan(file);
        }
    }

    /**
     * What deleting this task would cost its flow command, answered without
     * writing anything. The delete menu asks before it decides what to offer.
     */
    assessFlowDelete(taskId: string): FlowDeleteAssessment {
        const task = this.store.getTask(taskId);
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
        const known = this.store.getTask(taskId);
        return this.onRow(taskId, () => this.writeDelete(taskId, options, known));
    }

    /** {@link deleteTask}, once every write already asked of the row has finished. */
    private async writeDelete(taskId: string, options: { fireFlow?: boolean }, known: Task | undefined): Promise<boolean> {
        const task = this.copyForWrite(taskId, known);
        if (!task) return false;
        return this.withNotify(task.file, async () => {
            logInfo(`[deleteTask] id=${taskId} fireFlow=${options.fireFlow === true}`);
            if (task.isReadOnly) return false;


            let removed: boolean;
            if (options.fireFlow && isTvInline(task)) {
                removed = await this.commandExecutor.fireAndDelete(task);
            } else {
                removed = (await this.repository.deleteTaskFromFile(plannedOn(task, { subtree: true }))).written;
                if (!removed) {
                    // Nothing was written, so no rescan follows and the store
                    // still holds a task the file also still holds. They agree,
                    // and the caller must not report the task gone.
                    logWarn(`[TaskIndex] delete was not written: id=${taskId}`);
                }
            }

            await this.scanner.waitForScan(task.file);
            return removed;
        });
    }

    /** @returns whether the copy was written. */
    async duplicateTask(taskId: string, options?: DuplicateOptions): Promise<boolean> {
        if (this.refuseAfterDispose('duplicateTask')) return false;
        const known = this.store.getTask(taskId);
        return this.onRow(taskId, async () => {
            const task = this.copyForWrite(taskId, known);
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

            await this.scanner.waitForScan(task.file);
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
                : await this.repository.appendTaskToFile(filePath, taskLine, 'user');
            // Nothing written: no modify, so no scan to wait for.
            if (!outcome.written) return null;

            await this.scanner.waitForScan(filePath);
            return outcome.line;
        });
    }

    /** @returns whether the child line was written. */
    async insertChildTask(parentTaskId: string, childLine: string): Promise<boolean> {
        if (this.refuseAfterDispose('insertChildTask')) return false;
        const task = this.copyForWrite(parentTaskId, undefined);
        if (!task) return false;
        // Read-only parsers (Tasks / dayPlanner) must never be written to.
        // TaskApi guards this as well, but the menu path reaches the write
        // service directly and would otherwise bypass it.
        if (task.isReadOnly) return false;
        return this.withNotify(task.file, async () => {
            logInfo(`[insertChildTask] parentId=${parentTaskId}`);


            // インデントは書き込み層が既存子行から決める（親行だけからは
            // トップレベルのとき 4 スペース固定になり、タブ書きのファイルに
            // スペースが混ざる）。
            const { written } = await this.repository.insertLineAsFirstChild(task, childLine);
            if (!written) {
                logWarn(`[TaskIndex] child insert was not written: parentId=${parentTaskId}`);
            }

            await this.scanner.waitForScan(task.file);
            return written;
        });
    }

    /**
     * Append a child at the end of the parent's subtree, in contrast to
     * insertChildTask's head insertion. Session records accumulate over time,
     * so head insertion would print the log backwards.
     */
    /** @returns whether the child line was written. */
    async appendChildTask(parentTaskId: string, childLine: string): Promise<boolean> {
        if (this.refuseAfterDispose('appendChildTask')) return false;
        const task = this.copyForWrite(parentTaskId, undefined);
        if (!task) return false;
        if (task.isReadOnly) return false;
        return this.withNotify(task.file, async () => {
            logInfo(`[appendChildTask] parentId=${parentTaskId}`);


            const { written } = await this.repository.insertLineAfterTask(task, childLine);

            await this.scanner.waitForScan(task.file);
            return written;
        });
    }

    /**
     * Insert a line as the task's next sibling, just past its subtree, spelled
     * as the item next to it. Session records after the first one live beside the record
     * before them, not under it, so the log stays flat.
     */
    async insertSiblingAfterTask(
        taskId: string,
        siblingLine: string,
        opts: { afterCompletedRun?: boolean } = {}
    ): Promise<boolean> {
        if (this.refuseAfterDispose('insertSiblingAfterTask')) return false;
        const task = this.copyForWrite(taskId, undefined);
        if (!task) return false;
        if (task.isReadOnly) return false;
        return this.withNotify(task.file, async () => {
            logInfo(`[insertSiblingAfterTask] taskId=${taskId}`);

            const { written } = await this.repository.insertSiblingAfterTask(task, siblingLine, opts);
            await this.scanner.waitForScan(task.file);

            return written;
        });
    }

    /** @returns whether the line was written. */
    async updateLine(filePath: string, at: EditorLine, newContent: string): Promise<boolean> {
        if (this.refuseAfterDispose('updateLine')) return false;
        return this.withNotify(filePath, async () => {
            const { written } = await this.repository.updateLine(filePath, at, newContent);
            // Nothing written: no modify, so no scan to wait for.
            if (written) await this.scanner.waitForScan(filePath);
            return written;
        });
    }

    /** @returns whether the line was written. */
    async insertLineAfterLine(filePath: string, at: EditorLine, newContent: string): Promise<boolean> {
        if (this.refuseAfterDispose('insertLineAfterLine')) return false;
        return this.withNotify(filePath, async () => {
            const { written } = await this.repository.insertLineAfterLine(filePath, at, newContent);
            // Nothing written: no modify, so no scan to wait for.
            if (written) await this.scanner.waitForScan(filePath);
            return written;
        });
    }

    /** @returns whether the line was written. */
    async deleteLine(filePath: string, at: EditorSubtree): Promise<boolean> {
        if (this.refuseAfterDispose('deleteLine')) return false;
        return this.withNotify(filePath, async () => {
            const { written } = await this.repository.deleteLine(filePath, at);
            // Nothing written: no modify, so no scan to wait for.
            if (written) await this.scanner.waitForScan(filePath);
            return written;
        });
    }

    // ===== ヘルパー =====

    /**
     * Tell the user a write was not made, and why. Every write that gives up
     * for want of a target comes through here — once per write, from the
     * write layer — so the callers that learn of it from a `false` do not
     * say it again.
     */
    private reportRefusal(refusal: Refusal): void {
        const { reason, subject, file } = refusal;
        logWarn(`[TaskIndex] write refused: file=${file} reason=${reason.kind}${reason.kind === 'ambiguous' ? ` count=${reason.count}` : ''} subject=${subject}`);
        switch (reason.kind) {
            case 'ambiguous':
                new Notice(t('notice.writeTargetAmbiguous', { count: String(reason.count), subject }));
                return;
            case 'gone':
                new Notice(t('notice.writeTargetGone', { subject }));
                return;
            case 'changed':
                new Notice(t('notice.writeTargetChanged', { subject }));
                return;
            case 'unplaceable':
                new Notice(t('notice.writeTargetUnplaceable', { subject }));
                return;
            case 'disturbs':
                new Notice(t('notice.writeDisturbs', { subject }));
                return;
            case 'failed':
                new Notice(t('notice.writeFailed', { subject }));
                return;
        }
    }

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
//   statusDefinitions   — which status chars count as complete (CompletionDetector)
export function computeParseFingerprint(settings: TaskViewerSettings): string {
    return JSON.stringify([
        settings.scopeKeys,
        settings.enableDayPlanner,
        settings.enableTasksPlugin,
        settings.tasksPluginMapping,
        settings.statusDefinitions,
    ]);
}
