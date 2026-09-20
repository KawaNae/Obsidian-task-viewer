import type { App, TFile } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import type { TaskStore } from './TaskStore';
import type { TaskValidator } from './TaskValidator';
import type { SyncDetector } from './SyncDetector';
import { CompletionDetector } from './CompletionDetector';
import type { FlowExecutor } from '../flow/FlowExecutor';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import { IdentityLedger, type LedgerEntry } from './identity/IdentityLedger';
import { HintLog, type Hint } from './identity/IdentityHints';
import { matchFile, matchWithoutRepeatedIds } from './identity/IdentityMatcher';
import { WriteClaims, type ClaimResult } from './identity/WriteClaims';
import { applyIdentity, assertDistinctRuntimeIds, assertNoProvisionalIds, assertUniqueProvisionalIds } from './identity/IdentityApplier';
import { splitLines, type WriteSink } from '../../utils/FileLines';
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

    /**
     * What the plugin's own writes left for the next scan of each file.
     *
     * Owned here for the same reason the ledger is: a scan is the only thing
     * that consumes a hint, and the consuming and the ledger's commit have to
     * happen in the same step or a hint could outlive the state it describes.
     */
    private hints = new HintLog();

    /**
     * Turns what a write reports about a file's lines into a claim about its
     * rows. Owned here because it needs both the parser and the ledger, and
     * because its bookkeeping has to be dropped in the same step that commits
     * a scan — see `WriteClaims`.
     */
    private claims = new WriteClaims(
        (path, lines) => {
            // The frontmatter is the cache's, which is the file as it was
            // before the write asking this question — Obsidian updates the
            // cache from the `modify` that has not fired yet. Nothing here can
            // do better from inside `vault.process`. What it costs is a claim
            // made under the old reading of a `tv-ignore` or a notation
            // switch; the scan that follows reads the new one and refuses a
            // claim that does not reproduce what it sees.
            const parsed = FileParsePipeline.parse(
                path, [...lines], this.app.metadataCache.getCache(path)?.frontmatter, this.settings);
            // Not the same answer as a file with no tasks: an ignored file is
            // one this pipeline declines to read, and "it has no rows" would
            // be a claim about it.
            if (parsed.ignored) return null;
            // In the parser's own order, not sorted by line. A claim is
            // weighed against `parsed.tasks` as a scan hands them to
            // `matchFile`, so a claim ordered some other way would pair its
            // rows with different rows than the scan read — invisibly, where
            // two swapped rows read the same.
            return parsed.tasks.map(task => ({
                line: task.line,
                text: task.originalText,
                parserId: task.parserId,
            }));
        },
        // Everything the ledger holds has been read by a scan, so nothing it
        // hands back is a row still waiting to be recorded.
        (path) => this.ledger.snapshotFor(path).map(entry => ({
            runtimeId: entry.runtimeId,
            created: false,
            text: entry.fingerprint.originalText,
            line: entry.line,
        })),
        // The same counter a scan mints from, so a name issued by a write can
        // never collide with one issued by a read.
        (path, parserId) => TaskIdGenerator.mintRuntimeId(
            { parserId, file: path }, () => this.ledger.mint()),
    );

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
            const keys = this.settings.scopeKeys;
            if (keys.start in fm || keys.end in fm || keys.due in fm ||
                keys.color in fm || keys.linestyle in fm || keys.mask in fm ||
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

        // Everything from here to the match below is synchronous, so the claims
        // this scan weighs are, near enough, the ones filed by the time the read
        // resolved. Near enough rather than exactly: another write's callback
        // can slip in between the read settling and this line running, and its
        // claim describes a file this read never saw. Nothing here tries to
        // fence that off, because a position cannot — what keeps such a claim
        // from deciding anything is that it has to be the only one that fits
        // (see resolveHints).
        const content = await this.app.vault.read(file);
        const { lines } = splitLines(content);

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
            // With no rows to match against, a hint has nothing left to claim.
            this.hints.dropFile(file.path);
            this.claims.forget(file.path);
            return;
        }

        // --- identity ---
        // Right after parse, so nothing downstream — validator included — ever
        // sees a provisional ID.
        if (__DEV__) {
            assertUniqueProvisionalIds(parsed.tasks);
        }
        const now = Date.now();
        const previousRows = this.ledger.snapshotFor(file.path);
        const guarded = matchWithoutRepeatedIds(
            claims => matchFile(
                previousRows,
                parsed.tasks,
                task => TaskIdGenerator.mintRuntimeId(task, () => this.ledger.mint()),
                claims,
            ),
            this.hints.pendingFor(file.path, now),
        );
        if (guarded.withoutClaims) {
            // The log said something no file can be: one row on two lines. What
            // it would cost to commit is a task the index cannot see again (see
            // matchWithoutRepeatedIds), so the ladder answered instead and the
            // file's claims go — a log that produced this is not one to weigh
            // the next read against.
            logError(`[TaskScanner] ${file.path}: a claim gave one runtime ID to two rows; matched without the log`);
            this.hints.dropFile(file.path);
        }
        const identity = guarded.result;
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
            assertDistinctRuntimeIds(identity.entries);
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
            this.hints.settle(
                file.path, identity.consumedHints,
                ledgerMoved(previousRows, identity.entries),
            );
            // Whatever this scan decided, it decided: the next write builds on
            // the ledger rather than on what the last write thought it left. A
            // base carried across a scan that answered its own way would hand
            // the next claim identities the ledger does not agree with, and the
            // texts would line up well enough that nothing later would notice.
            this.claims.forget(file.path);
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
        // Hints name runtime IDs, and a rename rewrites those, so carrying the
        // log across would leave claims about rows nothing answers to. They
        // would fail to apply and cost the file its next hint anyway.
        this.hints.dropFile(oldPath);
        this.hints.dropFile(newPath);
        this.claims.forget(oldPath);
        this.claims.forget(newPath);
    }

    /**
     * ファイル削除（md → 非 md のリネームを含む）時の内部状態の破棄。
     * scanQueue / 完了検出メモリ / ledger から path を除去する。
     */
    handleFileDeleted(path: string): void {
        this.scanQueue.delete(path);
        this.completionDetector.forgetFile(path);
        this.ledger.dropFile(path);
        this.hints.dropFile(path);
        this.claims.forget(path);
    }

    /**
     * The identity ledger, for reverse lookups from the console and CLI.
     * @internal Read-only use: only scanFile writes it.
     */
    getLedger(): IdentityLedger {
        return this.ledger;
    }

    /**
     * The hint log, for seeing from the console what the write layer claimed.
     * @internal Read-only use: only scanFile and `addHints` change it.
     */
    getHintLog(): HintLog {
        return this.hints;
    }

    /**
     * File what a write just claimed about a file's rows.
     *
     * The write layer calls this from inside its `vault.process` callback (see
     * `processLines`); the next scan of that file weighs the claim against what
     * it reads.
     *
     * @returns a handle that takes the claim back, for a write that raised it
     *   and then failed.
     */
    addHints(file: string, hints: readonly Hint[]): () => void {
        return this.hints.add(file, hints, Date.now());
    }

    /**
     * Where a write reports what it did to one file's lines.
     *
     * Everything here is inside the writer's `vault.process` callback, so
     * nothing may throw: a report that cannot be turned into a claim is worth
     * a log line, never a lost write. The parse this runs is the one place a
     * write pays for stage 2 — one pass over the file it just wrote.
     */
    writeSink(file: string): WriteSink {
        return (before, after, edits) => {
            let result: ClaimResult;
            try {
                result = this.claims.claim(file, before, after, edits);
            } catch (error) {
                logError(`[TaskScanner] could not read back ${file} after a write: ${(error as Error)?.message ?? error}`);
                // Whatever base this file had is left alone. It describes the
                // file as it was before this write, so it no longer fits, and
                // a base that no longer fits is what stops the next write from
                // building on a ledger that is older still.
                return () => { };
            }
            // Both halves of what a claim leaves behind come back together:
            // the hint the next scan would weigh, and the base the next write
            // to this file would build on.
            if (!result.hint) return result.withdraw;
            const drop = this.hints.add(file, [result.hint], Date.now());
            return () => { drop(); result.withdraw(); };
        };
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

/**
 * Whether a scan changed the file's rows — which lines exist, in what order,
 * carrying which identity.
 *
 * Used to decide what happens to hints this scan did not believe: if the rows
 * moved anyway, something the hints could not account for reached the file, and
 * the ladder has already placed it. See {@link HintLog.settle}.
 */
function ledgerMoved(before: LedgerEntry[], after: LedgerEntry[]): boolean {
    if (before.length !== after.length) return true;
    for (let i = 0; i < before.length; i++) {
        if (before[i].runtimeId !== after[i].runtimeId) return true;
        if (before[i].fingerprint.originalText !== after[i].fingerprint.originalText) return true;
    }
    return false;
}
