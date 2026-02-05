import { App, TFile } from 'obsidian';
import type { Task, TaskViewerSettings } from '../types';
import { TaskRepository } from './TaskRepository';
import { TaskCommandExecutor } from './TaskCommandExecutor';
import { WikiLinkResolver } from './WikiLinkResolver';
import { TaskStore } from './task-management/TaskStore';
import { TaskScanner } from './task-management/TaskScanner';
import { TaskValidator } from './task-management/TaskValidator';
import { SyncDetector } from './task-management/SyncDetector';
import { EditorObserver } from './task-management/EditorObserver';

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
    private commandExecutor: TaskCommandExecutor;
    private settings: TaskViewerSettings;

    constructor(private app: App, settings: TaskViewerSettings) {
        this.settings = settings;

        // サービスの初期化
        this.store = new TaskStore(settings);
        this.validator = new TaskValidator();
        this.syncDetector = new SyncDetector();
        this.repository = new TaskRepository(app);
        this.commandExecutor = new TaskCommandExecutor(this.repository, this, app);
        this.editorObserver = new EditorObserver(app, this.syncDetector);
        this.scanner = new TaskScanner(
            app, this.store, this.validator,
            this.syncDetector, this.commandExecutor, settings
        );
    }

    async initialize(): Promise<void> {
        // レイアウト準備完了後に初回スキャン
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

                console.log(`[🔄SYNC] vault.modify: ${file.path}, isLocal=${isLocal}`);

                await this.scanner.queueScan(file, isLocal);
                WikiLinkResolver.resolve(this.store.getTasksMap(), this.app, this.settings.excludedPaths);
                this.store.notifyListeners();
            }
        });

        this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.store.removeTasksByFile(file.path);
                this.store.notifyListeners();
            }
        });

        this.app.vault.on('create', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.scanner.queueScan(file).then(() => {
                    WikiLinkResolver.resolve(this.store.getTasksMap(), this.app, this.settings.excludedPaths);
                    this.store.notifyListeners();
                });
            }
        });

        this.app.metadataCache.on('changed', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.scanner.queueScan(file).then(() => {
                    WikiLinkResolver.resolve(this.store.getTasksMap(), this.app, this.settings.excludedPaths);
                    this.store.notifyListeners();
                });
                // 即時notify: color・habit等の非タスクfrontmatter変更対応
                this.store.notifyListeners();
            }
        });
    }

    // ===== 設定 =====

    getSettings(): TaskViewerSettings {
        return this.settings;
    }

    updateSettings(settings: TaskViewerSettings): void {
        this.settings = settings;
        this.store.updateSettings(settings);
        this.scanner.updateSettings(settings);
        // 除外ルールが変更された可能性があるため再スキャン
        this.scanner.scanVault();
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

    // ===== CRUD操作 =====

    async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
        console.log(`[TaskIndex] updateTask called for ${taskId}`, updates);

        // スプリットタスク処理（:before, :after）
        if (taskId.includes(':before') || taskId.includes(':after')) {
            const originalId = taskId.split(':')[0];
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
            updates = {
                startDate: originalTask.startDate, startTime: originalTask.startTime,
                endDate: originalTask.endDate, endTime: originalTask.endTime
            };
        }

        const task = this.store.getTask(taskId);
        if (!task) {
            console.warn(`[TaskIndex] Task ${taskId} not found`);
            return;
        }

        this.syncDetector.markLocalEdit(task.file);
        Object.assign(task, updates);
        this.store.notifyListeners(taskId, Object.keys(updates));

        if (task.line === -1) {
            await this.repository.updateFrontmatterTask(task, updates);
        } else {
            await this.repository.updateTaskInFile(task, { ...task, ...updates });
        }
    }

    async deleteTask(taskId: string): Promise<void> {
        const task = this.store.getTask(taskId);
        if (!task) return;

        this.syncDetector.markLocalEdit(task.file);

        if (task.line === -1) {
            await this.repository.deleteFrontmatterTask(task);
        } else {
            await this.repository.deleteTaskFromFile(task);
        }

        await this.scanner.waitForScan(task.file);
    }

    async duplicateTask(taskId: string): Promise<void> {
        const task = this.store.getTask(taskId);
        if (!task) return;

        this.syncDetector.markLocalEdit(task.file);

        if (task.line === -1) {
            await this.repository.duplicateFrontmatterTask(task);
        } else {
            await this.repository.duplicateTaskInFile(task);
        }

        await this.scanner.waitForScan(task.file);
    }

    async duplicateTaskForWeek(taskId: string): Promise<void> {
        const task = this.store.getTask(taskId);
        if (!task) return;

        this.syncDetector.markLocalEdit(task.file);

        if (task.line === -1) {
            await this.repository.duplicateFrontmatterTaskForWeek(task);
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
