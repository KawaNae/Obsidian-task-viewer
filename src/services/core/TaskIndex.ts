import { App, TFile } from 'obsidian';
import type { DuplicateOptions, Task, TaskViewerSettings } from '../../types';
import { isFrontmatterTask, isTaskViewerInlineTask, hasBodyLine } from '../../types';
import { TaskRepository } from '../persistence/TaskRepository';
import { TaskCommandExecutor } from '../../commands/TaskCommandExecutor';
import { WikiLinkResolver } from './WikiLinkResolver';
import { TaskStore } from './TaskStore';
import { TaskScanner } from './TaskScanner';
import { TaskValidator } from './TaskValidator';
import { SyncDetector } from './SyncDetector';
import { EditorObserver } from './EditorObserver';
import { InlineToFrontmatterConversionService } from './InlineToFrontmatterConversionService';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import { DateUtils as CoreDateUtils } from '../../utils/DateUtils';
import { toDisplayTask } from '../display/DisplayTaskConverter';
import { getTaskDateRange } from '../display/VisualDateRange';
import { TaskParser } from '../parsing/TaskParser';
import { HeadingInserter } from '../../utils/HeadingInserter';
import { FileOperations } from '../persistence/utils/FileOperations';

export interface ValidationError {
    file: string;
    line: number;
    taskId: string;
    error: string;
}

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
    private inlineToFrontmatterConversionService: InlineToFrontmatterConversionService;
    private commandExecutor: TaskCommandExecutor;
    private settings: TaskViewerSettings;
    private draggingFilePath: string | null = null;  // ドラッグ中のファイルパス
    private notifyDebounceTimer: NodeJS.Timeout | null = null;
    private readonly NOTIFY_DEBOUNCE_MS = 16; // 約1フレーム

    // 通知の coalesce バッファ。
    // - null: 保留中なし
    // - 'full': taskId 不明 or 複数 taskId の混在 → 全体無効化
    // - { taskId, changes }: 単一 taskId への変更スパン（changes はマージされる）
    private pendingNotify: { taskId: string; changes: Set<string> } | 'full' | null = null;

    // 自己発信書き込みを覚えておくための TTL マップ（path → 解除 timer）。
    // vault.modify 後にメタデータキャッシュが遅延発火しても、自己書き込み由来であれば
    // 重ねて notify を発火しないようにするためのウィンドウ。
    private recentSelfWriteTimers: Map<string, NodeJS.Timeout> = new Map();
    private readonly SELF_WRITE_SUPPRESSION_MS = 1000;

    constructor(private app: App, settings: TaskViewerSettings) {
        this.settings = settings;

        // サービスの初期化
        this.store = new TaskStore(settings);
        this.validator = new TaskValidator();
        this.syncDetector = new SyncDetector();
        this.repository = new TaskRepository(app);
        this.inlineToFrontmatterConversionService = new InlineToFrontmatterConversionService(app, this.repository);
        this.commandExecutor = new TaskCommandExecutor(this.repository, this, app);
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
        this.app.vault.on('modify', async (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                const isLocal = this.syncDetector.isLocalEdit(file.path);
                this.syncDetector.clearLocalEditFlag(file.path);

                // 自己書き込み: 後続の metadataCache.changed が遅延着弾しても
                // 二重 notify にならないよう短時間だけマーク
                if (isLocal) {
                    this.markRecentSelfWrite(file.path);
                }

                // ドラッグ中のファイルはスキャンをスキップ（古い値でストアが上書きされるのを防止）
                if (this.draggingFilePath === file.path) {
                    return;
                }

                await this.scanner.queueScan(file, isLocal);
                WikiLinkResolver.resolve(this.store.getTasksMap(), this.store.getWikilinkRefsMap(), this.app);
                // Always emit notify here. UI write methods (via withNotify) emit their own
                // notifyImmediate after waitForScan, but editor user edits (typing, checkbox
                // click via mousedown) are also flagged isLocal=true by EditorObserver and
                // would otherwise have no notify path at all. Duplicate notifies between
                // withNotify and this handler are coalesced by pendingNotify + the 16ms
                // debounce. metadataCache.changed remains skipped via recentSelfWrite to
                // avoid a third redundant scan+notify.
                this.debouncedNotify();
            }
        });

        this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.store.removeTasksByFile(file.path);
                this.debouncedNotify();
            }
        });

        this.app.vault.on('create', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.scanner.queueScan(file).then(() => {
                    WikiLinkResolver.resolve(this.store.getTasksMap(), this.store.getWikilinkRefsMap(), this.app);
                    this.debouncedNotify();
                    });
            }
        });

        this.app.metadataCache.on('changed', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // ドラッグ中のファイルはスキャンをスキップ
                if (this.draggingFilePath === file.path) {
                    return;
                }
                // 自己書き込み直後のメタデータキャッシュ更新は完全に無視する。
                // ドラッグ完了後 setDraggingFile(null) と相前後して着弾する遅延イベントが
                // 余分な scan + notify を引き起こすのを防ぐ。
                if (this.isRecentSelfWrite(file.path)) {
                    return;
                }
                this.scanner.queueScan(file).then(() => {
                    WikiLinkResolver.resolve(this.store.getTasksMap(), this.store.getWikilinkRefsMap(), this.app);
                    this.debouncedNotify();
                    });
            }
        });

        this.app.vault.on('rename', async (file, oldPath) => {
            // md → 非md（拡張子変更）: delete 扱い
            if (!(file instanceof TFile) || file.extension !== 'md') {
                this.store.removeTasksByFile(oldPath);
                this.scanner.handleFileRenamed(oldPath);
                this.debouncedNotify();
                return;
            }

            // 非md → md: create 扱い
            if (!oldPath.endsWith('.md')) {
                await this.scanner.queueScan(file);
                WikiLinkResolver.resolve(this.store.getTasksMap(), this.store.getWikilinkRefsMap(), this.app);
                this.debouncedNotify();
                return;
            }

            // md → md（通常のリネーム）
            if (this.draggingFilePath === oldPath) {
                this.draggingFilePath = null;
            }
            this.syncDetector.clearLocalEditFlag(oldPath);

            this.store.removeTasksByFile(oldPath);
            this.scanner.handleFileRenamed(oldPath);

            await this.scanner.queueScan(file);
            WikiLinkResolver.resolve(this.store.getTasksMap(), this.store.getWikilinkRefsMap(), this.app);
            this.debouncedNotify();
        });
    }

    // ===== 通知制御 =====

    /**
     * 保留中の通知バッファに新しい通知を取り込む。
     * 同一 taskId への通知は changes をマージし、taskId 不明 / 複数 taskId が混ざる場合は
     * 全体無効化（'full'）に降格する。
     */
    private mergeNotify(taskId?: string, changes?: string[]): void {
        if (!taskId || !changes) {
            this.pendingNotify = 'full';
            return;
        }
        if (this.pendingNotify === null) {
            this.pendingNotify = { taskId, changes: new Set(changes) };
            return;
        }
        if (this.pendingNotify === 'full') return;
        if (this.pendingNotify.taskId === taskId) {
            for (const k of changes) this.pendingNotify.changes.add(k);
        } else {
            this.pendingNotify = 'full';
        }
    }

    /** 保留中の通知を即時にリスナーへ流し、バッファをクリアする */
    private flushPending(): void {
        const pending = this.pendingNotify;
        this.pendingNotify = null;
        if (pending === null) return;
        if (pending === 'full') {
            this.store.notifyListeners();
        } else {
            this.store.notifyListeners(pending.taskId, [...pending.changes]);
        }
    }

    /**
     * notifyListenersをdebounceで呼び出す。
     * 短時間（16ms）の連続呼び出しを統合して不要な再レンダリングを削減。
     * 引数を渡すと changes スパンをマージしてリスナーに伝搬する。
     */
    private debouncedNotify(taskId?: string, changes?: string[]): void {
        this.mergeNotify(taskId, changes);
        if (this.notifyDebounceTimer) {
            clearTimeout(this.notifyDebounceTimer);
        }
        this.notifyDebounceTimer = setTimeout(() => {
            this.notifyDebounceTimer = null;
            this.flushPending();
        }, this.NOTIFY_DEBOUNCE_MS);
    }

    /**
     * 即時通知（debounceなし）。
     * ドラッグ完了後にDOMを即座に更新する必要がある場合に使用。
     * 引数あり: taskId / changes をリスナーに伝える。なし: 全体無効化。
     * 既存のdebounceタイマーはキャンセルして即座に実行する。
     */
    notifyImmediate(taskId?: string, changes?: string[]): void {
        this.mergeNotify(taskId, changes);
        if (this.notifyDebounceTimer) {
            clearTimeout(this.notifyDebounceTimer);
            this.notifyDebounceTimer = null;
        }
        this.flushPending();
    }

    /** 自己書き込みを短時間記憶する（metadataCache.changed の遅延着弾を抑止するため） */
    private markRecentSelfWrite(filePath: string): void {
        const existing = this.recentSelfWriteTimers.get(filePath);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            this.recentSelfWriteTimers.delete(filePath);
        }, this.SELF_WRITE_SUPPRESSION_MS);
        this.recentSelfWriteTimers.set(filePath, timer);
    }

    private isRecentSelfWrite(filePath: string): boolean {
        return this.recentSelfWriteTimers.has(filePath);
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
        this.settings = settings;
        TaskParser.rebuildChain(settings);
        this.store.updateSettings(settings);
        this.scanner.updateSettings(settings);
        this.scanner.scanVault()
            .catch((error) => {
                console.error('[TaskIndex] Failed to rescan vault after settings update:', error);
            });
    }

    dispose(): void {
        if (this.notifyDebounceTimer) {
            clearTimeout(this.notifyDebounceTimer);
            this.notifyDebounceTimer = null;
        }
        for (const timer of this.recentSelfWriteTimers.values()) {
            clearTimeout(timer);
        }
        this.recentSelfWriteTimers.clear();
        this.pendingNotify = null;
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
     * pipeline fires a debouncedNotify (e.g. local writes are intentionally
     * skipped in the vault.modify handler).
     *
     * Note: notifyImmediate() is called with no args → full invalidation.
     */
    private async withNotify<T>(op: () => Promise<T>): Promise<T> {
        const result = await op();
        this.notifyImmediate();
        return result;
    }

    async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {

        // スプリットタスク処理（##seg:YYYY-MM-DD）
        const segmentInfo = TaskIdGenerator.parseSegmentId(taskId);
        if (segmentInfo) {
            const originalId = segmentInfo.baseId;
            const originalTask = this.store.getTask(originalId);

            if (!originalTask) {
                console.warn(`[TaskIndex] Original task ${originalId} not found for split segment`);
                return;
            }

            // Resolve effective dates to match splitDisplayTaskAtBoundary's logic
            const dt = toDisplayTask(originalTask, this.settings.startHour);
            if (!dt.effectiveStartDate) {
                console.warn(`[TaskIndex] Original task ${originalId} has no effective start date`);
                return;
            }

            const range = getTaskDateRange(dt, this.settings.startHour);
            const originalVisualStartDate = range.effectiveStart || dt.effectiveStartDate;

            // Compute afterSegmentDate the same way splitDisplayTaskAtBoundary does
            let afterSegmentDate = originalVisualStartDate;
            if (dt.effectiveStartDate && dt.effectiveEndDate) {
                let boundaryCalendarDate: string;
                if (dt.effectiveStartDate === dt.effectiveEndDate) {
                    boundaryCalendarDate = dt.effectiveStartDate;
                } else {
                    boundaryCalendarDate = CoreDateUtils.addDays(dt.effectiveStartDate, 1);
                }
                const boundaryTime = `${this.settings.startHour.toString().padStart(2, '0')}:00`;
                afterSegmentDate = CoreDateUtils.toVisualDate(
                    boundaryCalendarDate, boundaryTime, this.settings.startHour
                );
            }

            let segment: 'before' | 'after' | null = null;
            if (segmentInfo.segmentDate === originalVisualStartDate) {
                segment = 'before';
            } else if (segmentInfo.segmentDate === afterSegmentDate) {
                segment = 'after';
            } else {
                console.warn(`[TaskIndex] Unsupported split segment date: ${segmentInfo.segmentDate} for task ${originalId}`);
                return;
            }

            // セグメント更新を元のタスクフィールドにマッピング
            if (segment === 'before') {
                if (updates.startDate) originalTask.startDate = updates.startDate;
                if (updates.startTime) originalTask.startTime = updates.startTime;
                if (updates.endTime) {
                    const splitTime = TimeUtils.compareTimes(updates.endTime, this.settings.startHour) < 0
                        ? updates.endTime
                        : `23:59`;
                    originalTask.startTime = originalTask.startTime || '00:00';
                    originalTask.endTime = splitTime;
                }
            } else { // 'after'
                if (updates.endDate) {
                    originalTask.endDate = updates.endDate;
                    if (!originalTask.endTime) originalTask.endTime = '23:59';
                }
                if (updates.endTime) originalTask.endTime = updates.endTime;
            }

            taskId = originalId;
            // date/time 更新がある場合のみ、元タスクの全 date/time フィールドをマージ
            if (updates.startDate || updates.startTime || updates.endDate || updates.endTime) {
                const dateTimeUpdates = {
                    startDate: originalTask.startDate, startTime: originalTask.startTime,
                    endDate: originalTask.endDate, endTime: originalTask.endTime
                };
                updates = { ...updates, ...dateTimeUpdates };
            }
        }

        const task = this.store.getTask(taskId);
        if (!task) {
            console.warn(`[TaskIndex] Task ${taskId} not found`);
            return;
        }
        if (task.isReadOnly) return;

        this.syncDetector.markLocalEdit(task.file);
        Object.assign(task, updates);
        this.store.bumpRevision();

        // startDate が明示的に更新された → 継承フラグをクリア
        // (undefined = Propertiesモーダル未変更 → フラグ維持)
        if ('startDate' in updates && updates.startDate !== undefined) {
            task.startDateInherited = false;
        }

        // ドラッグ中のファイルはnotifyをスキップ（ドラッグ終了時にsetDraggingFile(null)で一括通知）
        if (this.draggingFilePath !== task.file) {
            this.store.notifyListeners(taskId, Object.keys(updates));
        }

        if (isFrontmatterTask(task)) {
            await this.repository.updateFrontmatterTask(task, updates, this.settings.frontmatterTaskKeys);
        } else {
            // All inline tasks route through InlineTaskWriter; TaskParser.format
            // dispatches by parserId. TVInlineParser.format() handles both
            // bare-checkbox and @notation-bearing output, so a task gaining or
            // losing date fields just produces the right line — no parserId
            // promotion/demotion needed.
            await this.repository.updateTaskInFile(task, { ...task, ...updates });
        }
    }

    async deleteTask(taskId: string): Promise<void> {
        return this.withNotify(async () => {
            const task = this.store.getTask(taskId);
            if (!task) return;
            if (task.isReadOnly) return;

            this.syncDetector.markLocalEdit(task.file);

            if (isFrontmatterTask(task)) {
                await this.repository.deleteFrontmatterTask(task, this.settings.frontmatterTaskKeys);
            } else {
                await this.repository.deleteTaskFromFile(task);
            }

            await this.scanner.waitForScan(task.file);
        });
    }

    async duplicateTask(taskId: string, options?: DuplicateOptions): Promise<void> {
        return this.withNotify(async () => {
            const task = this.store.getTask(taskId);
            if (!task) return;
            if (task.isReadOnly) return;

            this.syncDetector.markLocalEdit(task.file);

            if (isFrontmatterTask(task)) {
                await this.repository.duplicateFrontmatterTask(task, this.settings.frontmatterTaskKeys, options);
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
    async convertToFrontmatterTask(taskId: string): Promise<string> {
        return this.withNotify(async () => {
            const task = this.store.getTask(taskId);
            if (!task) throw new Error('Task not found');

            if (!isTaskViewerInlineTask(task)) {
                throw new Error('Only inline tasks can be converted to frontmatter tasks');
            }

            this.syncDetector.markLocalEdit(task.file);

            const newPath = await this.inlineToFrontmatterConversionService.convertInlineTaskToFrontmatter(
                task,
                this.settings.frontmatterTaskHeader,
                this.settings.frontmatterTaskHeaderLevel,
                this.settings.frontmatterTaskKeys
            );

            await this.scanner.waitForScan(task.file);
            await this.scanner.waitForScan(newPath);

            return newPath;
        });
    }

    async createTask(filePath: string, taskLine: string, heading?: string): Promise<void> {
        return this.withNotify(async () => {
            this.syncDetector.markLocalEdit(filePath);

            if (heading) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (!(file instanceof TFile)) return;
                await this.app.vault.process(file, (content) =>
                    HeadingInserter.insertUnderHeading(content, taskLine, heading, 2)
                );
            } else {
                await this.repository.appendTaskToFile(filePath, taskLine);
            }

            await this.scanner.waitForScan(filePath);
        });
    }

    async insertChildTask(parentTaskId: string, childLine: string): Promise<void> {
        return this.withNotify(async () => {
            const task = this.store.getTask(parentTaskId);
            if (!task) return;

            this.syncDetector.markLocalEdit(task.file);

            if (isFrontmatterTask(task)) {
                await this.repository.insertLineAfterFrontmatter(
                    task.file, childLine,
                    this.settings.frontmatterTaskHeader,
                    this.settings.frontmatterTaskHeaderLevel
                );
            } else {
                const childIndent = FileOperations.getChildIndent(task.originalText);
                await this.repository.insertLineAsFirstChild(task, childIndent + childLine);
            }

            await this.scanner.waitForScan(task.file);
        });
    }

    async createFrontmatterTaskFromData(taskData: Partial<Task>): Promise<string> {
        return this.withNotify(async () => {
            const tempTask: Task = {
                id: 'convert-temp',
                file: '',
                line: 0,
                indent: 0,
                content: taskData.content ?? '',
                statusChar: taskData.statusChar ?? ' ',
                childIds: [],
                childLines: [],
                startDate: taskData.startDate,
                startTime: taskData.startTime,
                endDate: taskData.endDate,
                endTime: taskData.endTime,
                due: taskData.due,
                commands: [],
                originalText: '',
                childLineBodyOffsets: [],
                tags: [],
                parserId: 'tv-inline',
                properties: {},
            };
            return await this.repository.createFrontmatterTaskFile(
                tempTask,
                this.settings.frontmatterTaskHeader,
                this.settings.frontmatterTaskHeaderLevel,
                undefined,
                undefined,
                this.settings.frontmatterTaskKeys
            );
        });
    }

    async updateLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        return this.withNotify(async () => {
            this.syncDetector.markLocalEdit(filePath);
            await this.repository.updateLine(filePath, lineNumber, newContent);

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.scanner.waitForScan(filePath);
            }
        });
    }

    async insertLineAfterLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        return this.withNotify(async () => {
            this.syncDetector.markLocalEdit(filePath);
            await this.repository.insertLineAfterLine(filePath, lineNumber, newContent);

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.scanner.waitForScan(filePath);
            }
        });
    }

    async deleteLine(filePath: string, lineNumber: number): Promise<void> {
        return this.withNotify(async () => {
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

// 時刻比較専用ヘルパー
const TimeUtils = {
    compareTimes(time1: string, time2: string | number): number {
        const [h1, m1] = time1.split(':').map(Number);
        const t2 = typeof time2 === 'number' ? time2 : parseInt(time2.split(':')[0]);
        const minutes1 = h1 * 60 + m1;
        const minutes2 = typeof time2 === 'number' ? t2 * 60 : parseInt(time2.split(':')[1]) + t2 * 60;
        return minutes1 - minutes2;
    }
};
