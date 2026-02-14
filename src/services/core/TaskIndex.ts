import { App, TFile, Notice } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { TaskRepository } from '../persistence/TaskRepository';
import { TaskCommandExecutor } from '../../commands/TaskCommandExecutor';
import { WikiLinkResolver } from './WikiLinkResolver';
import { TaskStore } from './TaskStore';
import { TaskScanner } from './TaskScanner';
import { TaskValidator } from './TaskValidator';
import { SyncDetector } from './SyncDetector';
import { EditorObserver } from './EditorObserver';
import { InlineToFrontmatterConversionService } from '../execution/InlineToFrontmatterConversionService';
import { AiIndexService } from '../aiindex/AiIndexService';

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
    private aiIndexService: AiIndexService;
    private settings: TaskViewerSettings;
    private draggingFilePath: string | null = null;  // ドラッグ中のファイルパス
    private notifyDebounceTimer: NodeJS.Timeout | null = null;
    private readonly NOTIFY_DEBOUNCE_MS = 16; // 約1フレーム

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
        this.aiIndexService = new AiIndexService(
            app,
            () => this.store.getTasks(),
            () => this.settings
        );
    }

    async initialize(): Promise<void> {
        // レイアウト準備完了後に初回スキャン
        this.app.workspace.onLayoutReady(async () => {
            await this.scanner.scanVault();
            this.scanner.setInitializing(false);
            await this.aiIndexService.rebuildAll();
        });

        // エディタ監視の開始
        this.editorObserver.setupInteractionListeners();

        // Vault イベントハンドラー
        this.app.vault.on('modify', async (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                const isLocal = this.syncDetector.isLocalEdit(file.path);
                this.syncDetector.clearLocalEditFlag(file.path);

                // ドラッグ中のファイルはスキャンをスキップ（古い値でストアが上書きされるのを防止）
                if (this.draggingFilePath === file.path) {
                    console.log(`[🔄SYNC] ⏸️ Skipping scan during drag: ${file.path}`);
                    return;
                }

                await this.scanner.queueScan(file, isLocal);
                WikiLinkResolver.resolve(this.store.getTasksMap(), this.app, this.settings.excludedPaths);
                this.debouncedNotify();
                this.aiIndexService.schedulePath(file.path);
            }
        });

        this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.store.removeTasksByFile(file.path);
                this.debouncedNotify();
                this.aiIndexService.scheduleDeletePath(file.path);
            }
        });

        this.app.vault.on('create', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.scanner.queueScan(file).then(() => {
                    WikiLinkResolver.resolve(this.store.getTasksMap(), this.app, this.settings.excludedPaths);
                    this.debouncedNotify();
                    this.aiIndexService.schedulePath(file.path);
                });
            }
        });

        this.app.metadataCache.on('changed', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // ドラッグ中のファイルはスキャンをスキップ
                if (this.draggingFilePath === file.path) {
                    return;
                }
                this.scanner.queueScan(file).then(() => {
                    WikiLinkResolver.resolve(this.store.getTasksMap(), this.app, this.settings.excludedPaths);
                    this.debouncedNotify();
                    this.aiIndexService.schedulePath(file.path);
                });
            }
        });
    }

    // ===== 通知制御 =====

    /**
     * notifyListenersをdebounceで呼び出す。
     * 短時間（16ms）の連続呼び出しを統合して不要な再レンダリングを削減。
     */
    private debouncedNotify(): void {
        if (this.notifyDebounceTimer) {
            clearTimeout(this.notifyDebounceTimer);
        }
        this.notifyDebounceTimer = setTimeout(() => {
            this.store.notifyListeners();
            this.notifyDebounceTimer = null;
        }, this.NOTIFY_DEBOUNCE_MS);
    }

    /**
     * 即時通知（debounceなし）。
     * ドラッグ完了後にDOMを即座に更新する必要がある場合に使用。
     * 既存のdebounceタイマーはキャンセルして即座に実行する。
     */
    notifyImmediate(): void {
        if (this.notifyDebounceTimer) {
            clearTimeout(this.notifyDebounceTimer);
            this.notifyDebounceTimer = null;
        }
        this.store.notifyListeners();
    }

    // ===== ドラッグ制御 =====

    /**
     * ドラッグ中のファイルパスを設定する。
     * 指定されたファイルのスキャンをスキップし、ストアの上書きを防止。
     * null設定時に最終的なレンダリングをトリガーする。
     */
    setDraggingFile(filePath: string | null): void {
        this.draggingFilePath = filePath;
        if (filePath === null) {
            // ドラッグ終了時に最終レンダリングをトリガー
            this.debouncedNotify();
        }
    }

    // ===== 設定 =====

    getSettings(): TaskViewerSettings {
        return this.settings;
    }

    updateSettings(settings: TaskViewerSettings): void {
        this.settings = settings;
        this.store.updateSettings(settings);
        this.scanner.updateSettings(settings);
        this.aiIndexService.updateSettings()
            .then(() => this.scanner.scanVault())
            .then(() => this.aiIndexService.rebuildAll())
            .catch((error) => {
                console.error('[TaskIndex] Failed to rescan vault after settings update:', error);
            });
    }

    dispose(): void {
        if (this.notifyDebounceTimer) {
            clearTimeout(this.notifyDebounceTimer);
            this.notifyDebounceTimer = null;
        }
        this.aiIndexService.dispose();
    }

    // ===== データアクセス (TaskStoreへ委譲) =====

    getTasks(): Task[] {
        return this.store.getTasks();
    }

    getTask(taskId: string): Task | undefined {
        return this.store.getTask(taskId);
    }

    getTasksForDate(date: string, startHour?: number): Task[] {
        return this.store.getTasksForDate(date, startHour);
    }

    getTasksForVisualDay(visualDate: string, startHour: number): Task[] {
        return this.store.getTasksForVisualDay(visualDate, startHour);
    }

    getDeadlineTasks(): Task[] {
        return this.store.getDeadlineTasks();
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

    async rebuildAiIndex(): Promise<void> {
        await this.aiIndexService.rebuildAll();
    }

    async openAiIndexFile(): Promise<void> {
        await this.aiIndexService.openIndexFile();
    }

    // ===== CRUD操作 =====

    async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
        console.log(`[TaskIndex] updateTask called for ${taskId}`, updates);

        // スプリットタスク処理（:before, :after）
        if (taskId.includes(':before') || taskId.includes(':after')) {
            // taskId形式: "filepath:lineNumber:before" or "filepath:lineNumber:after"
            // 最後の :before / :after を除去して元のIDを取得
            const originalId = taskId.replace(/:(?:before|after)$/, '');
            const segment = taskId.includes(':before') ? 'before' : 'after';
            const originalTask = this.store.getTask(originalId);

            if (!originalTask) {
                console.warn(`[TaskIndex] Original task ${originalId} not found for split segment`);
                return;
            }

            // セグメント更新を元のタスクフィールドにマッピング
            if (segment === 'before') {
                if (updates.startDate) originalTask.startDate = updates.startDate;
                if (updates.startTime) originalTask.startTime = updates.startTime;
                if (updates.endTime) {
                    const splitTime = DateUtils.compareTimes(updates.endTime, this.settings.startHour) < 0
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
            // 元のupdates（statusChar等）を保持しつつ日付/時刻を追加
            const dateTimeUpdates = {
                startDate: originalTask.startDate, startTime: originalTask.startTime,
                endDate: originalTask.endDate, endTime: originalTask.endTime
            };
            updates = { ...updates, ...dateTimeUpdates };
        }

        const task = this.store.getTask(taskId);
        if (!task) {
            console.warn(`[TaskIndex] Task ${taskId} not found`);
            return;
        }

        this.syncDetector.markLocalEdit(task.file);
        Object.assign(task, updates);
        // ドラッグ中のファイルはnotifyをスキップ（ドラッグ終了時にsetDraggingFile(null)で一括通知）
        if (this.draggingFilePath !== task.file) {
            this.store.notifyListeners(taskId, Object.keys(updates));
        }

        if (task.parserId === 'frontmatter') {
            await this.repository.updateFrontmatterTask(task, updates, this.settings.frontmatterTaskKeys);
        } else {
            await this.repository.updateTaskInFile(task, { ...task, ...updates });
        }
    }

    async deleteTask(taskId: string): Promise<void> {
        const task = this.store.getTask(taskId);
        if (!task) return;

        this.syncDetector.markLocalEdit(task.file);

        if (task.parserId === 'frontmatter') {
            await this.repository.deleteFrontmatterTask(task, this.settings.frontmatterTaskKeys);
        } else {
            await this.repository.deleteTaskFromFile(task);
        }

        await this.scanner.waitForScan(task.file);
    }

    async duplicateTask(taskId: string): Promise<void> {
        const task = this.store.getTask(taskId);
        if (!task) return;

        this.syncDetector.markLocalEdit(task.file);

        if (task.parserId === 'frontmatter') {
            await this.repository.duplicateFrontmatterTask(task);
        } else {
            await this.repository.duplicateTaskInFile(task);
        }

        await this.scanner.waitForScan(task.file);
    }

    /**
     * inline タスクを frontmatter タスクファイルに変換。
     * ソースファイル + 新ファイルの両方を再スキャン。
     */
    async convertToFrontmatterTask(taskId: string): Promise<void> {
        const task = this.store.getTask(taskId);
        if (!task) return;

        // inline タスクのみ変換可能
        if (task.parserId !== 'at-notation') {
            new Notice('Only inline tasks can be converted to frontmatter tasks');
            return;
        }

        this.syncDetector.markLocalEdit(task.file);

        try {
            const newPath = await this.inlineToFrontmatterConversionService.convertInlineTaskToFrontmatter(
                task,
                this.settings.frontmatterTaskHeader,
                this.settings.frontmatterTaskHeaderLevel,
                this.settings.frontmatterTaskKeys
            );

            // ソースファイル再スキャン (wikilink が追加される)
            await this.scanner.waitForScan(task.file);
            await this.scanner.waitForScan(newPath);

            new Notice('Task converted to frontmatter file');
        } catch (error) {
            console.error('[TaskIndex] Failed to convert task:', error);
            new Notice('Failed to convert task: ' + (error as Error).message);
        }
    }

    async duplicateTaskForWeek(taskId: string): Promise<void> {
        const task = this.store.getTask(taskId);
        if (!task) return;

        this.syncDetector.markLocalEdit(task.file);

        if (task.parserId === 'frontmatter') {
            await this.repository.duplicateFrontmatterTaskForWeek(task, this.settings.frontmatterTaskKeys);
        } else {
            await this.repository.duplicateTaskForWeek(task);
        }

        await this.scanner.waitForScan(task.file);
    }

    async updateLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        this.syncDetector.markLocalEdit(filePath);
        await this.repository.updateLine(filePath, lineNumber, newContent);

        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.scanner.waitForScan(filePath);
        }
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

// DateUtilsがないので、一時的なヘルパーを追加（本来はインポートすべき）
const DateUtils = {
    compareTimes(time1: string, time2: string | number): number {
        const [h1, m1] = time1.split(':').map(Number);
        const t2 = typeof time2 === 'number' ? time2 : parseInt(time2.split(':')[0]);
        const minutes1 = h1 * 60 + m1;
        const minutes2 = typeof time2 === 'number' ? t2 * 60 : parseInt(time2.split(':')[1]) + t2 * 60;
        return minutes1 - minutes2;
    }
};
