import type { App, TFile } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import type { TaskStore } from './TaskStore';
import type { TaskValidator } from './TaskValidator';
import type { SyncDetector } from './SyncDetector';
import { CompletionDetector } from './CompletionDetector';
import type { FlowExecutor } from '../flow/FlowExecutor';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import { IdentityLedger } from './identity/IdentityLedger';
import { matchFile } from './identity/IdentityMatcher';
import { applyIdentity, assertNoProvisionalIds, assertUniqueProvisionalIds } from './identity/IdentityApplier';
import { logDebug, logError, logInfo } from '../../log/log';

/**
 * タスクスキャナー — ファイル単位のスキャンのオーケストレーション。
 * scanFile は 5 相を順に呼ぶだけ:
 *   parse    — FileParsePipeline（ファイル → Task[]、仮 ID。パース順序契約の所有者）
 *   identity — IdentityLedger との突き合わせで仮 ID を runtime ID に置き換える
 *   validate — バリデーション警告の収集（以降は runtime ID しか見ない）
 *   detect   — CompletionDetector（完了イベントの差分検出、署名メモリの所有者）
 *   commit   — store 更新 + ledger 置換 + フロー発火
 */
export class TaskScanner {
    private scanQueue: Map<string, Promise<void>> = new Map();
    private completionDetector = new CompletionDetector();
    private isInitializing = true;
    /**
     * Written only by scanFile's commit, so the store and the ledger move together.
     *
     * Seeded from the clock so runtime IDs are unique across sessions, not just
     * within one: timers persist task IDs, and a counter restarting at 1 would
     * hand a previous session's number to a different task after a reload —
     * a stale ID must name nothing, never someone else. In microseconds, the
     * next session starts ahead of this one as long as it mints fewer than 1000
     * IDs per millisecond on average; ~1.7e15 stays within safe integers.
     */
    private ledger = new IdentityLedger(Date.now() * 1000);

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
     * ファイルをスキャンしてタスクを抽出（parse → identity → validate → detect → commit）
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
            // Retired for good: lifting tv-ignore later mints fresh IDs.
            this.ledger.dropFile(file.path);
            return;
        }

        // --- identity ---
        // Right after parse, so nothing downstream — validator included — ever
        // sees a provisional ID.
        if (__DEV__) {
            assertUniqueProvisionalIds(parsed.tasks);
        }
        const identity = matchFile(
            this.ledger.snapshotFor(file.path),
            parsed.tasks,
            task => TaskIdGenerator.mintRuntimeId(task, () => this.ledger.mint())
        );
        applyIdentity(parsed, identity.mapping);

        // --- validate ---
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

        // What this scan decided, which is the first question a report of a
        // task generated twice has to answer: two scans of one change that
        // each fired, or one scan that fired twice.
        //
        // A third shape — a pipeline that outlived its index and kept scanning
        // — reads differently in the two places this line goes. The stored log
        // cannot show it: every load of the plugin gets its own copy of this
        // module, and only the live one's manager flushes, so the copies write
        // where nobody reads. The console can: it belongs to the window rather
        // than to a copy, so with verbose on, one change printing this line
        // twice is a surviving pipeline saying so.
        if (!this.isInitializing) {
            logDebug(`[scan] file=${file.path} isLocal=${isLocalChange} fired=${tasksToTrigger.length} minted=${identity.minted.length} retired=${identity.retired.length}`);
        }

        // --- commit (batched: 1 file = 1 revision bump) ---
        // Checked before the batch opens: throwing inside it would have already
        // removed the file's tasks from the store.
        if (__DEV__) {
            assertNoProvisionalIds(parsed.tasks, id => !TaskIdGenerator.isRuntimeId(id));
        }
        this.store.beginBatch();
        try {
            this.store.removeTasksByFile(file.path);

            for (const task of parsed.tasks) {
                this.store.setTask(task.id, task);
            }

            // removeTasksByFile above dropped the previous ones, so this is a
            // replacement, not a merge — the scan owns the file's blocks.
            this.store.setGenBlocks(file.path, parsed.genBlocks);

            // Last, so a store write that throws leaves the ledger on the
            // previous generation too.
            this.ledger.replaceFile(file.path, identity.entries);
        } finally {
            this.store.endBatch();
        }

        // フロー発火
        for (const task of tasksToTrigger) {
            await this.commandExecutor.handleTaskCompletion(task);
        }
    }

    /**
     * ファイルリネーム（md → md）時の内部状態の引き継ぎ。
     * oldPath に紐づく scanQueue / 完了検出メモリを除去し、ledger を newPath へ再キーする。
     *
     * 新パスの再スキャンより前に呼ぶこと。逆順だと空の ledger と突き合わせて
     * 全タスクが新発番になる。再キーは TaskHubPanel / TimerWidget が握る ID を
     * 書き換えるのと同じ renameFile で行い、両者の文字列を一致させる。
     */
    handleFileRenamed(oldPath: string, newPath: string): void {
        this.scanQueue.delete(oldPath);
        this.completionDetector.forgetFile(oldPath);
        this.ledger.rekeyFile(oldPath, newPath, id => TaskIdGenerator.renameFile(id, oldPath, newPath));
    }

    /**
     * ファイル削除（md → 非 md のリネームを含む）時の内部状態の破棄。
     * scanQueue / 完了検出メモリ / ledger から path を除去する。
     */
    handleFileDeleted(path: string): void {
        this.scanQueue.delete(path);
        this.completionDetector.forgetFile(path);
        this.ledger.dropFile(path);
    }

    /**
     * The identity ledger, for reverse lookups from the console and CLI.
     * @internal Read-only use: only scanFile writes it.
     */
    getLedger(): IdentityLedger {
        return this.ledger;
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
