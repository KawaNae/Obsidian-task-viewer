import type { App, TFile } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import { WikiLinkResolver } from './WikiLinkResolver';
import type { TaskStore } from './TaskStore';
import type { TaskValidator } from './TaskValidator';
import type { SyncDetector } from './SyncDetector';
import { CompletionDetector } from './CompletionDetector';
import type { FlowExecutor } from '../flow/FlowExecutor';
import { logDebug, logError, logInfo } from '../../log/log';

/**
 * タスクスキャナー — ファイル単位のスキャンのオーケストレーション。
 * scanFile は 3 相を順に呼ぶだけ:
 *   parse  — FileParsePipeline（ファイル → Task[]、パース順序契約の所有者）
 *   detect — CompletionDetector（完了イベントの差分検出、署名メモリの所有者）
 *   commit — store 更新 + wikilinkRefs 登録 + フロー発火
 */
export class TaskScanner {
    private scanQueue: Map<string, Promise<void>> = new Map();
    private completionDetector = new CompletionDetector();
    private isInitializing = true;

    constructor(
        private app: App,
        private store: TaskStore,
        private validator: TaskValidator,
        private syncDetector: SyncDetector,
        private commandExecutor: FlowExecutor,
        private settings: TaskViewerSettings
    ) { }

    /**
     * Vault全体をスキャン
     */
    async scanVault(): Promise<void> {
        this.validator.clearErrors();
        const allFiles = this.app.vault.getMarkdownFiles();
        const files = allFiles.filter(f => this.mayContainTasks(f));
        logInfo(`[scanVault] total=${allFiles.length} candidates=${files.length} skipped=${allFiles.length - files.length}`);

        for (const file of files) {
            await this.queueScan(file);
        }

        WikiLinkResolver.resolve(this.store.getTasksMap(), this.store.getWikilinkRefsMap(), this.app);
        this.store.notifyListenersStaggered();
        logInfo(`[scanVault:done] tasks=${this.store.getTasks().length}`);
        this.isInitializing = false;
    }

    /**
     * metadataCache による前段フィルタ。
     * frontmatter に tv-* キーも tags もなく、listItems もないファイルをスキップ。
     * 偽陽性 (不要なスキャン) は許容、偽陰性 (タスク見逃し) は禁止。
     * metadataCache が未構築のファイルはスキップしない (安全側)。
     */
    private mayContainTasks(file: TFile): boolean {
        const cache = this.app.metadataCache.getCache(file.path);
        if (!cache) return true;

        const fm = cache.frontmatter;
        if (fm) {
            if ('tags' in fm) return true;
            const keys = this.settings.tvFileKeys;
            if (keys.start in fm || keys.end in fm || keys.due in fm ||
                keys.status in fm || keys.content in fm || keys.color in fm ||
                keys.linestyle in fm || keys.mask in fm || keys.timerTargetId in fm ||
                keys.ignore in fm) return true;
        }

        if (cache.listItems && cache.listItems.length > 0) return true;

        if (cache.tags && cache.tags.length > 0) return true;

        return false;
    }

    /**
     * 外部から呼ばれるスキャンリクエスト
     */
    async requestScan(file: TFile): Promise<void> {
        return this.queueScan(file);
    }

    /**
     * スキャンをキューに追加
     */
    async queueScan(file: TFile, isLocal: boolean = false): Promise<void> {
        if (!this.isInitializing) logDebug(`[queueScan] file=${file.path} isLocal=${isLocal}`);
        // シンプルなキューメカニズム: ファイルパスごとにプロミスをチェーン
        const previousScan = this.scanQueue.get(file.path) || Promise.resolve();

        const currentScan = previousScan.then(async () => {
            try {
                await this.scanFile(file, isLocal);
            } catch (error) {
                logError(`Error scanning file ${file.path}: ${(error as Error)?.message ?? error}`);
            }
        });

        this.scanQueue.set(file.path, currentScan);
        return currentScan;
    }

    /**
     * 指定ファイルのスキャン完了を待機
     */
    async waitForScan(filePath: string): Promise<void> {
        const promise = this.scanQueue.get(filePath);
        if (promise) {
            await promise;
        }
    }

    /**
     * ファイルをスキャンしてタスクを抽出（parse → detect → commit）
     */
    private async scanFile(file: TFile, isLocalChange: boolean = false): Promise<void> {
        this.validator.clearErrorsForFile(file.path);
        const content = await this.app.vault.read(file);
        const lines = content.split('\n').map(l => l.replace(/\r$/, ''));

        // --- parse ---
        const parsed = FileParsePipeline.parse(
            file.path,
            lines,
            this.app.metadataCache.getCache(file.path)?.frontmatter,
            this.settings
        );

        if (parsed.ignored) {
            this.store.removeTasksByFile(file.path);
            this.completionDetector.clearForFile(file.path);
            return;
        }

        // バリデーション警告を収集
        for (const task of parsed.tasks) {
            if (task.validation) {
                this.validator.addError({
                    file: file.path,
                    line: task.line + 1, // 1-indexed表示
                    taskId: task.id,
                    error: task.validation.message,
                });
            }
        }

        // --- detect ---
        const tasksToTrigger = this.completionDetector.detect(file.path, parsed.tasks, {
            isLocalChange,
            isInitializing: this.isInitializing,
            statusDefinitions: this.settings.statusDefinitions,
        });

        // --- commit ---
        // 注: removeTasksByFile は対象ファイルの wikilinkRefs も削除するため、
        // wikilink refs の登録は必ずこの後で行う（前に置くと再スキャンで消える）。
        this.store.removeTasksByFile(file.path);

        for (const task of parsed.tasks) {
            this.store.setTask(task.id, task);
        }

        // wikilink refs を登録（removeTasksByFile の後でなければ消える）
        if (parsed.fmTask) {
            this.store.setWikilinkRefs(parsed.fmTask.id, parsed.wikilinkRefs);
        }

        // フロー発火
        for (const task of tasksToTrigger) {
            await this.commandExecutor.handleTaskCompletion(task);
        }
    }

    /**
     * ファイルリネーム時の内部状態クリーンアップ。
     * oldPath に紐づく scanQueue / 完了検出メモリを除去する。
     */
    handleFileRenamed(oldPath: string): void {
        this.scanQueue.delete(oldPath);
        this.completionDetector.forgetFile(oldPath);
    }

    /**
     * 初期化状態を設定
     */
    setInitializing(value: boolean): void {
        this.isInitializing = value;
    }

    /**
     * 設定を更新
     */
    updateSettings(settings: TaskViewerSettings): void {
        this.settings = settings;
    }
}
