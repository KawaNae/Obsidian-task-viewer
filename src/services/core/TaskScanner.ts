import { App, TFile } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { ChildLineClassifier } from '../../utils/ChildLineClassifier';
import { TaskParser } from '../parsing/TaskParser';
import { FrontmatterTaskBuilder } from '../parsing/file/FrontmatterTaskBuilder';
import { WikiLinkResolver } from './WikiLinkResolver';
import { TaskStore } from './TaskStore';
import { TaskValidator } from './TaskValidator';
import { SyncDetector } from './SyncDetector';
import { TaskCommandExecutor } from '../../commands/TaskCommandExecutor';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import { ImplicitCalendarDateResolver } from '../../utils/ImplicitCalendarDateResolver';
import { PropertyInheritanceResolver } from './PropertyInheritanceResolver';

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

        /**
         * 再帰的にラインからタスクを抽出
         * @param linesToProcess - 処理する行の配列
         * @param baseLineNumber - ファイル内の最初の行の実際の行番号
         * @param parentStartDate - 親タスクのstartDate（継承用）
         * @returns 抽出されたタスクの配列
         */
        const extractTasksFromLines = (
            linesToProcess: string[],
            baseLineNumber: number,
            parentStartDate?: string,
            hasFrontmatterParent?: boolean
        ): Task[] => {
            const extractedTasks: Task[] = [];

            for (let i = 0; i < linesToProcess.length; i++) {
                const line = linesToProcess[i];
                const actualLineNumber = baseLineNumber + i;
                let task = TaskParser.parse(line, file.path, actualLineNumber);
                // 非デイリーノートかつFM/Container親がないファイルで、時刻のみ（日付なし）のタスクはプレーンチェックボックスとして扱う
                if (task && !parentStartDate && !hasFrontmatterParent
                    && !task.startDate && !task.endDate && !task.due
                    && (!task.commands || task.commands.length === 0)) {
                    task = null;
                }

                if (task) {
                    // デイリーノートの日付を継承（startDate/endDate が未指定の場合）
                    if (parentStartDate) {
                        Object.assign(task, ImplicitCalendarDateResolver.resolveDailyNoteDates(task, parentStartDate));
                    }

                    // インデントを設定
                    const taskIndent = line.search(/\S|$/);
                    task.indent = taskIndent;

                    // バリデーション警告を収集
                    if (task.validationWarning) {
                        this.validator.addError({
                            file: file.path,
                            line: actualLineNumber + 1, // 1-indexed表示
                            taskId: task.id,
                            error: task.validationWarning
                        });
                    }

                    // 子配列を初期化
                    task.childIds = [];

                    // 子タスクを先読み（空行はスキップ）
                    const children: string[] = [];
                    let j = i + 1;

                    while (j < linesToProcess.length) {
                        const nextLine = linesToProcess[j];

                        // 空行で停止 - 子ではない
                        if (nextLine.trim() === '') {
                            break;
                        }

                        const nextIndent = nextLine.search(/\S|$/);
                        if (nextIndent > taskIndent) {
                            children.push(nextLine);
                            j++;
                        } else {
                            break;
                        }
                    }

                    // 再帰的に子タスクを抽出（@記法を持つ子）— childLines フィルタより先に実行
                    let childTasks: Task[] = [];
                    if (children.length > 0) {
                        const childLineNumber = actualLineNumber + 1;
                        childTasks = extractTasksFromLines(children, childLineNumber, parentStartDate);

                        // 親子関係を設定
                        for (const childTask of childTasks) {
                            // 直接の子のみparentIdを設定（インデント差が1レベル）
                            // +1: タブ, +2: 2スペース（レガシー互換）, +4: 4スペース
                            if (childTask.indent === taskIndent + 1 || childTask.indent === taskIndent + 2 || childTask.indent === taskIndent + 4) {
                                childTask.parentId = task.id;
                                task.childIds.push(childTask.id);
                            }
                        }
                    }

                    // 子のインデントを正規化 + childLines 設定
                    // 子タスクとその配下行（property行等）をすべて除外（plain checkbox は残す）
                    const childTaskLineSet = new Set<number>();
                    for (const ct of childTasks) {
                        childTaskLineSet.add(ct.line);
                    }

                    const excludeIndices = new Set<number>();
                    for (let k = 0; k < children.length; k++) {
                        const absLine = actualLineNumber + 1 + k;
                        if (!childTaskLineSet.has(absLine)) continue;
                        excludeIndices.add(k);
                        // この子タスクより深いインデントの後続行も除外
                        const ctIndent = children[k].search(/\S|$/);
                        for (let m = k + 1; m < children.length; m++) {
                            const nextLine = children[m];
                            if (nextLine.trim() === '') { excludeIndices.add(m); continue; }
                            if (nextLine.search(/\S|$/) > ctIndent) {
                                excludeIndices.add(m);
                            } else {
                                break;
                            }
                        }
                    }

                    const nonEmptyChildren = children.filter(c => c.trim() !== '');
                    if (nonEmptyChildren.length > 0) {
                        const minIndent = Math.min(...nonEmptyChildren.map(c => c.search(/\S|$/)));
                        const normalized = children.map(c => {
                            if (c.trim() === '') return c;
                            return c.substring(minIndent);
                        });

                        const ownLines: string[] = [];
                        for (let k = 0; k < normalized.length; k++) {
                            if (excludeIndices.has(k)) continue;
                            ownLines.push(normalized[k]);
                        }

                        task.childLines = ChildLineClassifier.classifyLines(ownLines);
                    } else {
                        task.childLines = ChildLineClassifier.classifyLines(children);
                    }
                    task.properties = ChildLineClassifier.collectProperties(task.childLines);

                    extractedTasks.push(task);
                    extractedTasks.push(...childTasks);

                    // 消費した行をスキップ
                    i = j - 1;
                }
            }

            return extractedTasks;
        };

        // --- Frontmatter境界検出 ---
        let bodyStartIndex = 0;
        let frontmatterObj: Record<string, any> | undefined;
        if (lines.length > 0 && lines[0].trim() === '---') {
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim() === '---') { bodyStartIndex = i + 1; break; }
            }
            if (bodyStartIndex > 0) {
                frontmatterObj = this.app.metadataCache.getCache(file.path)?.frontmatter;
            }
        }

        if (this.isIgnoredByFrontmatter(frontmatterObj, lines, bodyStartIndex)) {
            this.store.removeTasksByFile(file.path);
            this.clearProcessedCompletionsForFile(file.path);
            return;
        }

        const bodyLines = lines.slice(bodyStartIndex);
        const fmResult = FrontmatterTaskBuilder.parse(
            file.path,
            frontmatterObj,
            bodyLines,
            bodyStartIndex,
            this.settings.frontmatterTaskKeys,
            this.settings.frontmatterTaskHeader,
            this.settings.frontmatterTaskHeaderLevel
        );

        // デイリーノートのファイル名から日付を抽出（親タスクからの継承は廃止）
        const dailyNoteDate = DailyNoteUtils.parseDateFromFilePath(this.app, file.path);
        const hasFmParent = fmResult !== null;
        const allExtractedTasks = extractTasksFromLines(bodyLines, bodyStartIndex, dailyNoteDate ?? undefined, hasFmParent);

        if (fmResult) {
            const fmTask = fmResult.task;

            // Container の content フォールバック: ファイル名のbasenameを使用
            if (fmTask.isContainer && !fmTask.content) {
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
            const isEmptyContainer = fmTask.isContainer && fmTask.childIds.length === 0 && fmTask.childLines.length === 0;
            if (!isEmptyContainer) {
                newTasks.push(fmTask);
            }
        }
        newTasks.push(...allExtractedTasks);

        // 同一ファイル内の親→子 properties/tags/color/linestyle 継承
        PropertyInheritanceResolver.resolve(newTasks);

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

        console.log(`[🔄SYNC] Scan: ${file.path}, isLocalChange=${isLocalChange}, isFirstScan=${isFirstScan}, isInitializing=${this.isInitializing}`);

        if (!isLocalChange && !isFirstScan && !this.isInitializing) {
            console.log(`[🔄SYNC] ⛔ Sync-driven change detected, skipping command: ${file.path}`);
        }

        for (const task of doneTasks) {
            const sig = this.getTaskSignature(task);
            if (checkedSignatures.has(sig)) continue;
            checkedSignatures.add(sig);

            const currentCount = currentCounts.get(sig) || 0;
            const previousCount = this.processedCompletions.get(sig) || 0;

            console.log(`[🔄SYNC] Task: ${task.content.substring(0, 30)}..., cur=${currentCount}, prev=${previousCount}, local=${isLocalChange}`);

            if (currentCount > previousCount) {
                const diff = currentCount - previousCount;

                // トリガー条件: 初期化中でない、初回スキャンでない、ローカル変更である
                if (!this.isInitializing && !isFirstScan && isLocalChange) {
                    console.log(`[🔄SYNC] ✅ Executing command for: ${task.content.substring(0, 30)}...`);
                    for (let k = 0; k < diff; k++) {
                        tasksToTrigger.push(task);
                    }
                } else {
                    console.log(`[TaskIndex] Skipping command - isInitializing=${this.isInitializing}, isFirstScan=${isFirstScan}, isLocalChange=${isLocalChange}`);
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
        const ignoreKey = this.settings.frontmatterTaskKeys.ignore;
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
