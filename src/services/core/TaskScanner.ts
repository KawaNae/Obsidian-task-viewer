import { App, TFile, parseYaml } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { isTvFileUnscheduled } from '../../types';
import { TaskParser } from '../parsing/TaskParser';
import { TVFileBuilder } from '../parsing/tv-file/TVFileBuilder';
import { WikiLinkResolver } from './WikiLinkResolver';
import { TaskStore } from './TaskStore';
import { TaskValidator } from './TaskValidator';
import { SyncDetector } from './SyncDetector';
import { TaskCommandExecutor } from '../../commands/TaskCommandExecutor';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import { TaskPropertyResolver } from '../parsing/TaskPropertyResolver';
import { DocumentTreeBuilder } from '../parsing/tree/DocumentTreeBuilder';
import { SectionPropertyResolver } from '../parsing/tree/SectionPropertyResolver';
import { TreeTaskExtractor } from '../parsing/tree/TreeTaskExtractor';

/**
 * タスクスキャナー - ファイルのスキャンとパース処理
 * Vault全体とファイル単位のスキャン、タスクの抽出と管理を担当
 */
export class TaskScanner {
    private scanQueue: Map<string, Promise<void>> = new Map();
    private processedCompletions: Map<string, number> = new Map(); // "file|date|content" -> count
    private visitedFiles = new Set<string>();
    private isInitializing = true;

    constructor(
        private app: App,
        private store: TaskStore,
        private validator: TaskValidator,
        private syncDetector: SyncDetector,
        private commandExecutor: TaskCommandExecutor,
        private settings: TaskViewerSettings
    ) { }

    /**
     * タスクシグネチャ生成（重複検出用）
     */
    private getTaskSignature(task: Task): string {
        const cmdSig = task.commands ? task.commands.map(c => `${c.name}(${c.args.join(',')})`).join('') : '';
        return `${task.file}|${task.startDate || 'no-date'}|${task.content}|${cmdSig}`;
    }

    /**
     * Vault全体をスキャン
     */
    async scanVault(): Promise<void> {
        this.validator.clearErrors();
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            await this.queueScan(file);
        }
        WikiLinkResolver.resolve(this.store.getTasksMap(), this.store.getWikilinkRefsMap(), this.app);
        this.store.notifyListenersStaggered();
        this.isInitializing = false;
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
        // シンプルなキューメカニズム: ファイルパスごとにプロミスをチェーン
        const previousScan = this.scanQueue.get(file.path) || Promise.resolve();

        const currentScan = previousScan.then(async () => {
            try {
                await this.scanFile(file, isLocal);
            } catch (error) {
                console.error(`Error scanning file ${file.path}:`, error);
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
     * ファイルをスキャンしてタスクを抽出
     */
    private async scanFile(file: TFile, isLocalChange: boolean = false): Promise<void> {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n').map(l => l.replace(/\r$/, ''));

        // 1. 新しいタスクをパース（再帰的に子タスクを抽出）
        const newTasks: Task[] = [];

        // --- Frontmatter境界検出 ---
        let bodyStartIndex = 0;
        let frontmatterObj: Record<string, any> | undefined;
        if (lines.length > 0 && lines[0].trim() === '---') {
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim() === '---') { bodyStartIndex = i + 1; break; }
            }
            if (bodyStartIndex > 0) {
                frontmatterObj = this.app.metadataCache.getCache(file.path)?.frontmatter;

                // metadataCache が未更新の場合（vault.modify → metadataCache.changed の間）、
                // raw コンテンツから直接パースしてフォールバック
                if (!frontmatterObj) {
                    try {
                        const yamlContent = lines.slice(1, bodyStartIndex - 1).join('\n');
                        frontmatterObj = parseYaml(yamlContent);
                    } catch {
                        // YAML パースエラー時は無視（metadataCache.changed で再スキャンされる）
                    }
                }
            }
        }

        if (this.isIgnoredByFrontmatter(frontmatterObj, lines, bodyStartIndex)) {
            this.store.removeTasksByFile(file.path);
            this.clearProcessedCompletionsForFile(file.path);
            return;
        }

        const bodyLines = lines.slice(bodyStartIndex);
        const fmResult = TVFileBuilder.parse(
            file.path,
            frontmatterObj,
            bodyLines,
            bodyStartIndex,
            this.settings.tvFileKeys,
            this.settings.tvFileChildHeader,
            this.settings.tvFileChildHeaderLevel
        );

        // デイリーノートのファイル名から日付を抽出（親タスクからの継承は廃止）
        const dailyNoteDate = DailyNoteUtils.parseDateFromFilePath(this.app, file.path);
        const hasFmParent = fmResult !== null;

        // --- ツリーパイプライン ---
        const doc = DocumentTreeBuilder.build(file.path, lines, bodyStartIndex);
        SectionPropertyResolver.resolve(doc, frontmatterObj, this.settings.tvFileKeys);
        const allExtractedTasks = TreeTaskExtractor.extract(doc, {
            filePath: file.path,
            dailyNoteDate: dailyNoteDate ?? undefined,
            hasTvFileParent: hasFmParent,
            tvFileKeys: this.settings.tvFileKeys,
        });

        // バリデーション警告を収集
        for (const task of allExtractedTasks) {
            if (task.validation) {
                this.validator.addError({
                    file: file.path,
                    line: task.line + 1, // 1-indexed表示
                    taskId: task.id,
                    error: task.validation.message,
                });
            }
        }

        if (fmResult) {
            const fmTask = fmResult.task;

            // Container の content フォールバック: ファイル名のbasenameを使用
            if (isTvFileUnscheduled(fmTask) && !fmTask.content) {
                fmTask.content = file.basename;
            }

            // Store wikilink refs separately
            this.store.setWikilinkRefs(fmTask.id, fmResult.wikilinkRefs);

            // 全孤児インラインタスクを FM/Container の子にする
            for (const bt of allExtractedTasks) {
                if (!bt.parentId) {
                    bt.parentId = fmTask.id;
                    fmTask.childIds.push(bt.id);
                }
            }

            // Container は子がなければ作成しない
            const isEmptyContainer = isTvFileUnscheduled(fmTask) && fmTask.childIds.length === 0 && fmTask.childLines.length === 0;
            if (!isEmptyContainer) {
                newTasks.push(fmTask);
            }
        }
        newTasks.push(...allExtractedTasks);

        // Task scope: cross-block parent → child properties/tags BFS
        TaskPropertyResolver.resolve(newTasks);

        // 2. 現在の完了カウント
        const currentCounts = new Map<string, number>();
        const doneTasks: Task[] = [];

        for (const task of newTasks) {
            if (TaskParser.isTriggerableStatus(task) && task.commands && task.commands.length > 0) {
                const sig = this.getTaskSignature(task);
                currentCounts.set(sig, (currentCounts.get(sig) || 0) + 1);
                doneTasks.push(task);
            }
        }

        // 3. 差分検出とトリガー
        const tasksToTrigger: Task[] = [];
        const checkedSignatures = new Set<string>();

        let isFirstScan = false;
        if (!this.visitedFiles.has(file.path)) {
            this.visitedFiles.add(file.path);
            isFirstScan = true;
        }

        if (!isLocalChange && !isFirstScan && !this.isInitializing) {
            // Sync-driven change detected — skip command execution
        }

        for (const task of doneTasks) {
            const sig = this.getTaskSignature(task);
            if (checkedSignatures.has(sig)) continue;
            checkedSignatures.add(sig);

            const currentCount = currentCounts.get(sig) || 0;
            const previousCount = this.processedCompletions.get(sig) || 0;

            if (currentCount > previousCount) {
                const diff = currentCount - previousCount;

                // トリガー条件: 初期化中でない、初回スキャンでない、ローカル変更である
                if (!this.isInitializing && !isFirstScan && isLocalChange) {
                    for (let k = 0; k < diff; k++) {
                        tasksToTrigger.push(task);
                    }
                }
            }
        }

        // 4. メモリを更新
        const prefix = `${file.path}|`;
        for (const key of this.processedCompletions.keys()) {
            if (key.startsWith(prefix)) {
                this.processedCompletions.delete(key);
            }
        }

        for (const [sig, count] of currentCounts) {
            this.processedCompletions.set(sig, count);
        }

        // 5. インデックスを更新
        this.store.removeTasksByFile(file.path);

        for (const task of newTasks) {
            this.store.setTask(task.id, task);
        }

        // 6. トリガーを実行
        if (tasksToTrigger.length > 0) {
            for (const task of tasksToTrigger) {
                await this.commandExecutor.handleTaskCompletion(task);
            }
        }
    }

    /**
     * ファイルリネーム時の内部状態クリーンアップ。
     * oldPath に紐づく scanQueue / processedCompletions / visitedFiles を除去する。
     */
    handleFileRenamed(oldPath: string): void {
        this.scanQueue.delete(oldPath);
        this.clearProcessedCompletionsForFile(oldPath);
        this.visitedFiles.delete(oldPath);
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

    private clearProcessedCompletionsForFile(filePath: string): void {
        const prefix = `${filePath}|`;
        for (const key of this.processedCompletions.keys()) {
            if (key.startsWith(prefix)) {
                this.processedCompletions.delete(key);
            }
        }
    }

    private isIgnoredByFrontmatter(
        frontmatterObj: Record<string, any> | undefined,
        lines: string[],
        bodyStartIndex: number
    ): boolean {
        const ignoreKey = this.settings.tvFileKeys.ignore;
        const fromCache = frontmatterObj?.[ignoreKey];
        if (this.isTruthyIgnoreValue(fromCache)) {
            return true;
        }

        if (bodyStartIndex <= 0) {
            return false;
        }

        const escapedKey = ignoreKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const keyLineRegex = new RegExp(`^${escapedKey}\\s*:\\s*(.*)$`);

        for (let i = 1; i < bodyStartIndex - 1; i++) {
            const line = lines[i];
            const match = line.match(keyLineRegex);
            if (!match) continue;
            return this.isTruthyIgnoreValue(match[1]);
        }

        return false;
    }

    private isTruthyIgnoreValue(value: unknown): boolean {
        if (value === true || value === 1) {
            return true;
        }
        if (typeof value !== 'string') {
            return false;
        }

        const normalized = value
            .trim()
            .replace(/^['"]|['"]$/g, '')
            .replace(/\s+#.*$/, '')
            .toLowerCase();

        return normalized === 'true'
            || normalized === 'yes'
            || normalized === 'on'
            || normalized === '1';
    }
}
