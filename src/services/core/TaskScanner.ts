import type { App, TFile } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import type { TaskStore } from './TaskStore';
import type { TaskValidator } from './TaskValidator';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import { IdentityLedger, type LedgerEntry } from './identity/IdentityLedger';
import { HintLog } from './identity/IdentityHints';
import { matchFile, matchWithoutRepeatedIds } from './identity/IdentityMatcher';
import { WriteClaims, type ClaimResult } from './identity/WriteClaims';
import { contentKeyOf } from './ContentKey';
import { applyIdentity, assertDistinctRuntimeIds, assertNoProvisionalIds, assertUniqueProvisionalIds } from './identity/IdentityApplier';
import { splitLines, type Landing, type WriteOrigin, type WriteSink } from '../../utils/FileLines';
import type { OutlineReading } from '../parsing/utils/Outline';
import type { ContentKey } from './ContentKey';
import { logDebug, logError, logInfo } from '../../log/log';

/**
 * タスクスキャナー — ファイル単位のスキャンのオーケストレーション。
 * scanFile は 4 相を順に呼ぶだけ:
 *   parse    — FileParsePipeline（ファイル → Task[]、仮 ID。パース順序契約の所有者）
 *   identity — IdentityLedger との突き合わせで仮 ID を runtime ID に置き換える
 *   validate — バリデーション警告の収集（以降は runtime ID しか見ない）
 *   commit   — store 更新 + ledger 置換
 *
 * スキャンは読むだけで、フローを発火させない。発火は完了させた操作が起こす
 * （エディタのトランザクションと、プラグイン自身の書き込み。structure.md の
 * 「発火の可否」）。
 */
export class TaskScanner {
    private scanQueue: Map<string, Promise<unknown>> = new Map();

    /**
     * The key of the content each file's last committed reading read — a
     * scan's, or a write's that landed (`landed`). A reading of the same
     * content parses to what the index holds, so it is not committed again:
     * the one condition under which a read is skipped. Dropped when the
     * settings change what a parse makes of the same lines (`forgetReads`).
     */
    private committed = new Map<string, ContentKey>();
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
            // The frontmatter is the one these lines hold, as the scan that
            // follows reads it (see `FileParsePipeline.parse`).
            const parsed = FileParsePipeline.parse(path, [...lines], this.settings);
            // Not the same answer as a file with no tasks: an ignored file is
            // one this pipeline declines to read, and "it has no rows" would
            // be a claim about it.
            if (parsed.ignored) return null;
            // In the parser's own order, not sorted by line. A claim is
            // weighed against `parsed.tasks` as a scan hands them to
            // `matchFile`, so a claim ordered some other way would pair its
            // rows with different rows than the scan read — invisibly, where
            // two swapped rows read the same.
            return parsed.tasks;
        },
        // Everything the ledger holds has been read by a scan, so nothing it
        // hands back is a row still waiting to be recorded.
        (path) => ({
            rows: this.ledger.snapshotFor(path).map(entry => ({
                runtimeId: entry.runtimeId,
                created: false,
                text: entry.fingerprint.originalText,
                line: entry.line,
                parserId: entry.fingerprint.parserId,
            })),
            content: this.ledger.contentFor(path),
        }),
        // The same counter a scan mints from, so a name issued by a write can
        // never collide with one issued by a read.
        (path, parserId) => TaskIdGenerator.mintRuntimeId(
            { parserId, file: path }, () => this.ledger.mint()),
    );

    constructor(
        private app: App,
        private store: TaskStore,
        private validator: TaskValidator,
        private settings: TaskViewerSettings
    ) { }

    /**
     * Vault全体をスキャン
     */
    async scanVault(): Promise<void> {
        this.validator.clearErrors();
        // Every file is read again from here on, whatever it read last.
        this.committed.clear();
        const allFiles = this.app.vault.getMarkdownFiles();
        const files = allFiles.filter(f => this.mayContainTasks(f));
        logInfo(`[scanVault] total=${allFiles.length} candidates=${files.length} skipped=${allFiles.length - files.length}`);

        // Queued without a line each: the vault's scan says what it did
        // above and below, and a line per file would bury the log.
        for (const file of files) {
            await this.queue(file);
        }

        this.store.notifyListenersStaggered();
        logInfo(`[scanVault:done] tasks=${this.store.getTasks().length}`);
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
     * Read the file again, whatever it read last: for a caller that has
     * reason to think the index parts from the file (an update that was not
     * written and put its values back).
     */
    async requestScan(file: TFile): Promise<void> {
        this.committed.delete(file.path);
        await this.queueScan(file);
    }

    /**
     * Scan the file unless what it reads is what the last reading committed
     * read, and say whether it committed.
     *
     * Every change event comes here: a `modify`, and the `metadataCache`
     * `changed` after it, ours or not. Most echo a content the index already
     * holds — the one a write of ours landed (`landed`), or the one the
     * `modify` before it read — and the parse reads the content's own
     * frontmatter, not the cache. So "was this already read" is the content's
     * to answer, not a window of time after a write.
     */
    queueScan(file: TFile): Promise<boolean> {
        logDebug(`[queueScan] file=${file.path}`);
        return this.queue(file);
    }

    private queue(file: TFile): Promise<boolean> {
        // シンプルなキューメカニズム: ファイルパスごとにプロミスをチェーン
        const previousScan = this.scanQueue.get(file.path) || Promise.resolve();

        const currentScan = previousScan.then(async () => {
            try {
                return await this.scanFile(file);
            } catch (error) {
                logError(`Error scanning file ${file.path}: ${(error as Error)?.message ?? error}`);
                return false;
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
     * A write of ours landed in `path`, leaving `landing.lines`: take them in
     * as the file's next reading, now, without waiting for the scan its
     * `modify` starts — which then reads the same content and commits
     * nothing. Whether it committed.
     *
     * The lines are what the file holds: `processOrFail` answered that the
     * write landed, and nothing is read that the write did not leave. A scan
     * that read the file before this write and commits after it puts an older
     * reading back; the `modify` this write caused reads the file again after
     * it, and commits this content once more. In between, a write planned
     * from the older copy is checked against the file and refused where it
     * reads otherwise, never written on the wrong line.
     */
    landed(path: string, landing: Landing): boolean {
        return this.commitRead(path, [...landing.lines], this.claims.readMark(), landing.reading ?? undefined);
    }

    /**
     * ファイルをスキャンしてタスクを抽出（parse → identity → validate → commit）
     */
    private async scanFile(file: TFile): Promise<boolean> {

        // Everything from here to the match below is synchronous, so the claims
        // this scan weighs are, near enough, the ones filed by the time the read
        // resolved. Near enough rather than exactly: another write's callback
        // can slip in between the read settling and this line running, and its
        // claim describes a file this read never saw. Nothing here tries to
        // fence that off, because a position cannot — what keeps such a claim
        // from deciding anything is that it has to be the only one that fits
        // (see resolveHints).
        const readMark = this.claims.readMark();
        const content = await this.app.vault.read(file);
        const { lines } = splitLines(content);
        return this.commitRead(file.path, lines, readMark);
    }

    /**
     * Commit one reading of `path`, `lines`, unless it is of the content the
     * last committed reading read. `readMark` is the claims' mark taken before
     * the lines were read; `reading` a reading of these lines already made.
     */
    private commitRead(path: string, lines: string[], readMark: number, reading?: OutlineReading): boolean {
        const file = { path };
        const readKey = contentKeyOf(lines);
        if (this.committed.get(path) === readKey) return false;
        this.validator.clearErrorsForFile(file.path);

        // --- parse ---
        const parsed = FileParsePipeline.parse(file.path, lines, this.settings, reading);

        if (parsed.ignored) {
            this.store.removeTasksByFile(file.path);
            // Retired for good: lifting tv-ignore later mints fresh IDs.
            this.ledger.dropFile(file.path);
            // With no rows to match against, a hint has nothing left to claim.
            this.hints.dropFile(file.path);
            this.claims.forget(file.path);
            this.committed.set(file.path, readKey);
            return true;
        }

        // --- identity ---
        // Right after parse, so nothing downstream — validator included — ever
        // sees a provisional ID.
        if (__DEV__) {
            assertUniqueProvisionalIds(parsed.tasks);
        }
        const now = Date.now();
        const previousRows = this.ledger.snapshotFor(file.path);
        const before = this.ledger.contentFor(file.path);
        // With no claim adopted, the ladder pairs against the newest state
        // known to be older than this read — the ledger, unless a write of
        // ours is known to have landed after it (`WriteClaims.ladderFor`).
        const ladder = this.claims.ladderFor(file.path, readKey, { content: before, rows: previousRows });
        const guarded = matchWithoutRepeatedIds(
            hints => matchFile(
                previousRows,
                parsed.tasks,
                task => TaskIdGenerator.mintRuntimeId(task, () => this.ledger.mint()),
                hints,
                ladder ?? [],
            ),
            {
                pending: this.hints.pendingFor(file.path, now),
                before,
                read: readKey,
            },
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

        // What this scan decided about identity. Two scans of one change,
        // or a pipeline that outlived its index and kept scanning, print this
        // line twice: the console belongs to the window rather than to a copy
        // of the module, so with verbose on it shows either.
        logDebug(`[scan] file=${file.path} minted=${identity.minted.length} retired=${identity.retired.length}`);

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
            this.ledger.replaceFile(file.path, identity.entries, readKey);
            this.hints.settle(file.path, identity.consumedHints);
            // Whatever this scan decided, it decided: the next write builds on
            // the ledger rather than on what the last write thought it left. A
            // base carried across a scan that answered its own way would hand
            // the next claim identities the ledger does not agree with, and the
            // texts would line up well enough that nothing later would notice.
            // A write this read may not have seen is still kept, for `locate` to
            // know the ledger is older than it (`WriteClaims.lastWrite`).
            this.claims.forget(file.path, { readMark, read: readKey, ledger: before });
            this.committed.set(file.path, readKey);
        } finally {
            this.store.endBatch();
        }
        return true;
    }

    /**
     * ファイルリネーム（md → md）時の内部状態の引き継ぎ。
     * oldPath に紐づく scanQueue を除去し、ledger を newPath へ再キーする。
     *
     * 新パスの再スキャンより前に呼ぶこと。逆順だと空の ledger と突き合わせて
     * 全タスクが新発番になる。再キーは TaskHubPanel / TimerWidget が握る ID を
     * 書き換えるのと同じ renameFile で行い、両者の文字列を一致させる。
     */
    handleFileRenamed(oldPath: string, newPath: string): void {
        this.scanQueue.delete(oldPath);
        this.committed.delete(oldPath);
        this.committed.delete(newPath);
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
     * scanQueue / ledger から path を除去する。
     */
    handleFileDeleted(path: string): void {
        this.scanQueue.delete(path);
        this.committed.delete(path);
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
     * @internal Read-only use: only scanFile changes it.
     */
    getHintLog(): HintLog {
        return this.hints;
    }

    /**
     * Where a write reports what it did to one file's lines.
     *
     * Everything here is inside the writer's `vault.process` callback, so
     * nothing may throw: a report that cannot be turned into a claim is worth
     * a log line, never a lost write. The parse this runs is the one place a
     * write pays for stage 2 — one pass over the file it just wrote.
     */
    writeSink(file: string, origin: WriteOrigin): WriteSink {
        return (before, after, edits, named) => {
            let result: ClaimResult;
            try {
                result = this.claims.claim(file, before, after, edits, origin, named);
            } catch (error) {
                logError(`[TaskScanner] could not read back ${file} after a write: ${(error as Error)?.message ?? error}`);
                // The write changed the file all the same, and nothing on
                // record describes it now. Left unmarked, a record from before
                // it would look like the last one there is.
                return { withdraw: this.claims.silence(file, origin, named), made: [] };
            }
            // Both halves of what a claim leaves behind come back together:
            // the hint the next scan would weigh, and the base the next write
            // to this file would build on.
            if (!result.hint) return { withdraw: result.withdraw, made: [] };
            const drop = this.hints.add(file, [result.hint], Date.now());
            return { withdraw: () => { drop(); result.withdraw(); }, made: result.made };
        };
    }

    /**
     * 設定を更新
     */
    updateSettings(settings: TaskViewerSettings): void {
        this.settings = settings;
    }
}
