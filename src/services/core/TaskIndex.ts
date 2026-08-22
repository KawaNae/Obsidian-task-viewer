import { type App, type EventRef, Notice, TFile } from 'obsidian';
import { t } from '../../i18n';
import type { DuplicateOptions, Task, TaskViewerSettings } from '../../types';
import { isTvFile, isTvInline, hasBodyLine } from '../../types';
import { TaskRepository } from '../persistence/TaskRepository';
import { PropertyUpdatePlanner } from '../persistence/PropertyUpdatePlanner';
import { createTempTask } from '../data/createTempTask';
import { FlowExecutor } from '../flow/FlowExecutor';
import type { FlowDeleteAssessment } from '../flow/FlowDeletion';
import { WikiLinkResolver } from './WikiLinkResolver';
import { TaskStore } from './TaskStore';
import { TaskScanner } from './TaskScanner';
import { TaskValidator, type ValidationError } from './TaskValidator';
import { SyncDetector } from './SyncDetector';
import { EditorObserver } from './EditorObserver';
import { TvInlineToTvFileConverter } from './TvInlineToTvFileConverter';
import { PathTtlWindow } from './PathTtlWindow';
import { NotifyCoalescer } from './NotifyCoalescer';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import { TaskParser } from '../parsing/TaskParser';
import type { GenBlock } from '../parsing/gen/GenBlockCollector';
import { FileOperations } from '../persistence/utils/FileOperations';
import { logError, logInfo, logWarn } from '../../log/log';

/**
 * TaskIndex - タスク管理の統括ファサードクラス
 * 各種サービス（Store, Scanner, Validator, SyncDetector, EditorObserver）を統合
 */
export class TaskIndex {
    private store: TaskStore;
    private scanner: TaskScanner;
    private validator: TaskValidator;
    private syncDetector: SyncDetector;
    private editorObserver: EditorObserver;
    private repository: TaskRepository;
    private tvInlineToTvFileConverter: TvInlineToTvFileConverter;
    private commandExecutor: FlowExecutor;
    private settings: TaskViewerSettings;
    private parseFingerprint: string;
    private draggingFilePath: string | null = null;  // ドラッグ中のファイルパス

    // 1 フレーム（16ms）分の通知を 1 回にまとめる。合流規則は NotifyCoalescer 側。
    private readonly notify = new NotifyCoalescer(
        (taskId, changes) => this.store.notifyListeners(taskId, changes),
        16,
    );

    // 自己発信書き込みを覚えておくためのウィンドウ。
    // vault.modify 後にメタデータキャッシュが遅延発火しても、自己書き込み由来であれば
    // 重ねて notify を発火しないようにするため。
    private readonly selfWrites = new PathTtlWindow(1000);

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
        this.syncDetector = new SyncDetector();
        this.repository = new TaskRepository(app);
        this.tvInlineToTvFileConverter = new TvInlineToTvFileConverter(app, this.repository);
        // Settings getter (not a snapshot): updateSettings replaces the
        // settings object, and trigger judgment must always see the latest
        // statusDefinitions.
        this.commandExecutor = new FlowExecutor(this.repository, this, app, () => this.settings);
        this.editorObserver = new EditorObserver(app, this.syncDetector);
        this.scanner = new TaskScanner(
            app, this.store, this.validator,
            this.syncDetector, this.commandExecutor, settings
        );
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
                const isLocal = this.syncDetector.isLocalEdit(file.path);
                this.syncDetector.clearLocalEditFlag(file.path);

                // 自己書き込み: 後続の metadataCache.changed が遅延着弾しても
                // 二重 notify にならないよう短時間だけマーク
                if (isLocal) {
                    this.selfWrites.mark(file.path);
                }

                // ドラッグ中のファイルはスキャンをスキップ（古い値でストアが上書きされるのを防止）
                if (this.draggingFilePath === file.path) {
                    return;
                }

                await this.scanner.queueScan(file, isLocal);
                this.resolveLinks();
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
                this.scanner.handleFileRenamed(file.path);
                this.validator.clearErrorsForFile(file.path);
                this.resolveLinksAndNotify();
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
                // 自己書き込み直後のメタデータキャッシュ更新は完全に無視する。
                // ドラッグ完了後 setDraggingFile(null) と相前後して着弾する遅延イベントが
                // 余分な scan + notify を引き起こすのを防ぐ。
                if (this.selfWrites.has(file.path)) {
                    return;
                }
                void this.rescanAndNotify(file);
            }
        }));

        this.own(this.app.vault, this.app.vault.on('rename', async (file, oldPath) => {
            // md → 非md（拡張子変更）: delete 扱い
            if (!(file instanceof TFile) || file.extension !== 'md') {
                this.store.removeTasksByFile(oldPath);
                this.scanner.handleFileRenamed(oldPath);
                this.validator.clearErrorsForFile(oldPath);
                this.resolveLinksAndNotify();
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
            this.syncDetector.clearLocalEditFlag(oldPath);

            this.store.removeTasksByFile(oldPath);
            this.scanner.handleFileRenamed(oldPath);

            await this.rescanAndNotify(file);
        }));
    }

    /** Remember a subscription so `dispose` can close it. */
    private own(emitter: { offref(ref: EventRef): void }, ref: EventRef): void {
        this.eventRefs.push({ emitter, ref });
    }

    /**
     * Re-point every wikilink at the store as it stands now.
     *
     * Every vault event ends here: a file that changed can have created or
     * broken a link in a file that did not, so the resolution is whole-store
     * rather than per-file.
     */
    private resolveLinks(): void {
        WikiLinkResolver.resolve(this.store.getTasksMap(), this.store.getWikilinkRefsMap(), this.app);
    }

    /** The tail every vault handler shares: resolve links, then notify. */
    private resolveLinksAndNotify(): void {
        this.resolveLinks();
        this.notify.schedule();
    }

    /**
     * Read the file back into the store, then resolve and notify.
     *
     * The three steps are one unit: notifying before the links are resolved
     * paints a frame whose parent/child arrows still point at the old store.
     */
    private async rescanAndNotify(file: TFile, isLocal?: boolean): Promise<void> {
        await this.scanner.queueScan(file, isLocal);
        this.resolveLinksAndNotify();
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
     */
    setDraggingFile(filePath: string | null): void {
        this.draggingFilePath = filePath;
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
        for (const { emitter, ref } of this.eventRefs) emitter.offref(ref);
        this.eventRefs = [];
        this.editorObserver.dispose();

        this.notify.dispose();
        this.selfWrites.dispose();
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
            if (task.file === filePath && hasBodyLine(task)) {
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

    async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
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

        const task = this.store.getTask(taskId);
        if (!task) {
            logWarn(`[TaskIndex] Task ${taskId} not found`);
            return;
        }
        if (task.isReadOnly) return;

        // 非時刻プロパティ（color/tags/custom 等）の書き込み操作を導出。
        // before スナップショット（Object.assign 前）との diff が必要なので
        // ここで評価する。
        const propertyOps = PropertyUpdatePlanner.plan(task, updates, this.settings.tvFileKeys);

        // 更新前の姿。行の探索と、書けなかったときの巻き戻しの両方で要る。
        const before: Task = { ...task };

        this.syncDetector.markLocalEdit(task.file);
        Object.assign(task, updates);
        this.store.bumpRevision();

        // ドラッグ中のファイルはnotifyをスキップ（ドラッグ終了時にsetDraggingFile(null)で一括通知）
        if (this.draggingFilePath !== task.file) {
            this.store.notifyListeners(taskId, Object.keys(updates));
        }

        const written = isTvFile(task)
            // tv-file は書き先がキー名で決まるので、渡すのは更新後の値でよい。
            ? await this.repository.updateTvFile(task, updates, this.settings.tvFileKeys, propertyOps)
            // All inline tasks route through InlineTaskWriter; TaskParser.format
            // dispatches by parserId. TVInlineParser.format() handles both
            // bare-checkbox and @notation-bearing output, so a task gaining or
            // losing date fields just produces the right line — no parserId
            // promotion/demotion needed.
            //
            // 探索は更新前の姿で行う。ファイルに書かれているのは更新前の行なので、
            // 更新後の日付や時刻で探しに行くと、まさにその値を変える更新のときに
            // 空振りする。第 2 引数が書く内容、第 1 引数がどの行かを決める。
            : await this.repository.updateTaskInFile(before, task, propertyOps);

        if (!written) {
            this.revertUnwrittenUpdate(task, taskId, before, updates);
        }
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

        logWarn(`[TaskIndex] update was not written, reverted: id=${taskId} fields=[${Object.keys(updates)}]`);
        new Notice(t('notice.taskWriteFailed'));

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
     * @returns whether the task is gone. Only a stopped fire and a read-only
     * task answer no; every other road here removes it.
     */
    async deleteTask(taskId: string, options: { fireFlow?: boolean } = {}): Promise<boolean> {
        const task = this.store.getTask(taskId);
        if (!task) return false;
        return this.withNotify(task.file, async () => {
            logInfo(`[deleteTask] id=${taskId} fireFlow=${options.fireFlow === true}`);
            if (task.isReadOnly) return false;

            this.syncDetector.markLocalEdit(task.file);

            let removed = true;
            if (options.fireFlow && isTvInline(task)) {
                removed = await this.commandExecutor.fireAndDelete(task);
            } else if (isTvFile(task)) {
                await this.repository.deleteTvFile(task, this.settings.tvFileKeys);
            } else {
                await this.repository.deleteTaskFromFile(task);
            }

            await this.scanner.waitForScan(task.file);
            return removed;
        });
    }

    async duplicateTask(taskId: string, options?: DuplicateOptions): Promise<void> {
        const task = this.store.getTask(taskId);
        if (!task) return;
        return this.withNotify(task.file, async () => {
            if (task.isReadOnly) return;

            this.syncDetector.markLocalEdit(task.file);

            if (isTvFile(task)) {
                await this.repository.duplicateTvFile(task, this.settings.tvFileKeys, options);
            } else {
                await this.repository.duplicateInlineTask(task, options);
            }

            await this.scanner.waitForScan(task.file);
        });
    }

    /**
     * inline タスクを frontmatter タスクファイルに変換。
     * ソースファイル + 新ファイルの両方を再スキャン。
     * @returns 新ファイルのパス
     */
    async convertToTvFile(taskId: string): Promise<string> {
        const task = this.store.getTask(taskId);
        if (!task) throw new Error('Task not found');
        return this.withNotify(task.file, async () => {

            if (!isTvInline(task)) {
                throw new Error('Only tv-inline tasks can be converted to tv-file tasks');
            }

            this.syncDetector.markLocalEdit(task.file);

            const newPath = await this.tvInlineToTvFileConverter.convertTvInlineToTvFile(
                task,
                this.settings.tvFileChildHeader,
                this.settings.tvFileChildHeaderLevel,
                this.settings.tvFileKeys
            );

            await this.scanner.waitForScan(task.file);
            await this.scanner.waitForScan(newPath);

            return newPath;
        });
    }

    async createTask(filePath: string, taskLine: string, heading?: string): Promise<number> {
        let insertedLine = -1;
        await this.withNotify(filePath, async () => {
            logInfo(`[createTask] path=${filePath} heading=${heading ?? '(none)'}`);
            this.syncDetector.markLocalEdit(filePath);

            if (heading) {
                insertedLine = await this.repository.insertLineUnderHeading(filePath, taskLine, heading, 2);
                if (insertedLine < 0) return; // ファイルが無ければ何も書けていない
            } else {
                insertedLine = await this.repository.appendTaskToFile(filePath, taskLine);
            }

            await this.scanner.waitForScan(filePath);
        });
        return insertedLine;
    }

    async insertChildTask(parentTaskId: string, childLine: string): Promise<void> {
        const task = this.store.getTask(parentTaskId);
        if (!task) return;
        // Read-only parsers (Tasks / dayPlanner) must never be written to.
        // TaskApi guards this as well, but the menu path reaches the write
        // service directly and would otherwise bypass it.
        if (task.isReadOnly) return;
        return this.withNotify(task.file, async () => {
            logInfo(`[insertChildTask] parentId=${parentTaskId}`);

            this.syncDetector.markLocalEdit(task.file);

            if (isTvFile(task)) {
                await this.repository.insertLineUnderHeading(
                    task.file, childLine,
                    this.settings.tvFileChildHeader,
                    this.settings.tvFileChildHeaderLevel
                );
            } else {
                // インデントは書き込み層が既存子行から決める（親行だけからは
                // トップレベルのとき 4 スペース固定になり、タブ書きのファイルに
                // スペースが混ざる）。
                await this.repository.insertLineAsFirstChild(task, childLine);
            }

            await this.scanner.waitForScan(task.file);
        });
    }

    /**
     * Append a child at the end of the parent's subtree, in contrast to
     * insertChildTask's head insertion. Session records accumulate over time,
     * so head insertion would print the log backwards.
     */
    async appendChildTask(parentTaskId: string, childLine: string): Promise<void> {
        const task = this.store.getTask(parentTaskId);
        if (!task) return;
        if (task.isReadOnly) return;
        return this.withNotify(task.file, async () => {
            logInfo(`[appendChildTask] parentId=${parentTaskId}`);

            this.syncDetector.markLocalEdit(task.file);

            if (isTvFile(task)) {
                await this.repository.insertLineUnderHeading(
                    task.file, childLine,
                    this.settings.tvFileChildHeader,
                    this.settings.tvFileChildHeaderLevel
                );
            } else {
                await this.repository.insertLineAfterTask(task, childLine);
            }

            await this.scanner.waitForScan(task.file);
        });
    }

    /**
     * Insert a line as the task's next sibling — same indentation, just past
     * its subtree. Session records after the first one live beside the record
     * before them, not under it, so the log stays flat.
     *
     * Inline only. A tv-file task is a whole note and has no siblings to speak
     * of; that case belongs to appendChildTask.
     */
    async insertSiblingAfterTask(
        taskId: string,
        siblingLine: string,
        opts: { afterCompletedRun?: boolean } = {}
    ): Promise<number> {
        const task = this.store.getTask(taskId);
        if (!task) return -1;
        if (task.isReadOnly || isTvFile(task)) return -1;
        return this.withNotify(task.file, async () => {
            logInfo(`[insertSiblingAfterTask] taskId=${taskId}`);

            this.syncDetector.markLocalEdit(task.file);
            const insertedLine = await this.repository.insertSiblingAfterTask(task, siblingLine, opts);
            await this.scanner.waitForScan(task.file);

            return insertedLine;
        });
    }

    async createTvFileFromData(taskData: Partial<Task>): Promise<string> {
        return this.withNotify('', async () => {
            const tempTask = createTempTask({
                id: 'convert-temp',
                content: taskData.content ?? '',
                statusChar: taskData.statusChar ?? ' ',
                startDate: taskData.startDate,
                startTime: taskData.startTime,
                endDate: taskData.endDate,
                endTime: taskData.endTime,
                due: taskData.due,
            });
            return await this.repository.createTvFile(
                tempTask,
                this.settings.tvFileChildHeader,
                this.settings.tvFileChildHeaderLevel,
                undefined,
                undefined,
                this.settings.tvFileKeys
            );
        });
    }

    async updateLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        return this.withNotify(filePath, async () => {
            this.syncDetector.markLocalEdit(filePath);
            await this.repository.updateLine(filePath, lineNumber, newContent);

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.scanner.waitForScan(filePath);
            }
        });
    }

    async insertLineAfterLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        return this.withNotify(filePath, async () => {
            this.syncDetector.markLocalEdit(filePath);
            await this.repository.insertLineAfterLine(filePath, lineNumber, newContent);

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.scanner.waitForScan(filePath);
            }
        });
    }

    async deleteLine(filePath: string, lineNumber: number): Promise<void> {
        return this.withNotify(filePath, async () => {
            this.syncDetector.markLocalEdit(filePath);
            await this.repository.deleteLine(filePath, lineNumber);

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.scanner.waitForScan(filePath);
            }
        });
    }

    // ===== ヘルパー =====

    resolveTask(originalTask: Task): Task | undefined {
        // 1. IDで検索
        let found = this.store.getTask(originalTask.id);
        if (found &&
            found.content === originalTask.content &&
            found.file === originalTask.file &&
            found.line === originalTask.line &&
            found.startDate === originalTask.startDate) {
            return found;
        }

        // 2. シグネチャで検索（File + Content）
        for (const t of this.store.getTasks()) {
            if (t.file === originalTask.file && t.content === originalTask.content) {
                if (t.startDate === originalTask.startDate) {
                    return t;
                }
            }
        }

        return undefined;
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
//   tvFileKeys          — frontmatter field names for tv-start/end/due/status/etc.
//   tvFileChildHeader   — heading name that marks the child-items section
//   tvFileChildHeaderLevel — heading level for the child-items section
//   enableDayPlanner    — toggles DayPlanner parser in the chain
//   enableTasksPlugin   — toggles TasksPlugin parser in the chain
//   tasksPluginMapping  — emoji-to-field mapping for TasksPlugin parser
//   statusDefinitions   — which status chars count as complete (CompletionDetector)
export function computeParseFingerprint(settings: TaskViewerSettings): string {
    return JSON.stringify([
        settings.tvFileKeys,
        settings.tvFileChildHeader,
        settings.tvFileChildHeaderLevel,
        settings.enableDayPlanner,
        settings.enableTasksPlugin,
        settings.tasksPluginMapping,
        settings.statusDefinitions,
    ]);
}
