import type { App, TFile } from 'obsidian';
import { Outline } from '../parsing/utils/Outline';
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
import { splitLines, type Located, type TaskRef, type WriteOrigin, type WriteSink } from '../../utils/FileLines';
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
        const allFiles = this.app.vault.getMarkdownFiles();
        const files = allFiles.filter(f => this.mayContainTasks(f));
        logInfo(`[scanVault] total=${allFiles.length} candidates=${files.length} skipped=${allFiles.length - files.length}`);

        // Queued without a line each: the vault's scan says what it did
        // above and below, and a line per file would bury the log.
        for (const file of files) {
            await this.queue(file, false);
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
     * 外部から呼ばれるスキャンリクエスト
     */
    async requestScan(file: TFile): Promise<void> {
        return this.queueScan(file);
    }

    /**
     * スキャンをキューに追加
     */
    async queueScan(file: TFile): Promise<void> {
        logDebug(`[queueScan] file=${file.path}`);
        await this.queue(file, false);
    }

    /**
     * Scan the file unless what it reads is what the last scan read, and say
     * whether it committed.
     *
     * For a change event that may only echo a write the file's own `modify`
     * already had scanned (`metadataCache`'s `changed` comes after every
     * write, ours or not). Content the ledger recorded, with no write of ours
     * on record past it and no claim waiting, parses to what the index holds:
     * the parse reads the content's own frontmatter, not the cache. So the
     * question "was this already read" is the content's to answer, not a
     * window of time after a write.
     */
    async rescanUnlessRead(file: TFile): Promise<boolean> {
        logDebug(`[queueScan] file=${file.path}`);
        return this.queue(file, true);
    }

    private queue(file: TFile, unlessRead: boolean): Promise<boolean> {
        // シンプルなキューメカニズム: ファイルパスごとにプロミスをチェーン
        const previousScan = this.scanQueue.get(file.path) || Promise.resolve();

        const currentScan = previousScan.then(async () => {
            try {
                return await this.scanFile(file, unlessRead);
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
     * ファイルをスキャンしてタスクを抽出（parse → identity → validate → commit）
     */
    private async scanFile(file: TFile, unlessRead: boolean): Promise<boolean> {

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
        const readKey = contentKeyOf(lines);
        if (unlessRead
            && readKey === this.ledger.contentFor(file.path)
            && this.claims.lastWrite(file.path) === undefined
            && this.hints.peekFor(file.path, Date.now()).length === 0) {
            return false;
        }
        this.validator.clearErrorsForFile(file.path);

        // --- parse ---
        const parsed = FileParsePipeline.parse(file.path, lines, this.settings);

        if (parsed.ignored) {
            this.store.removeTasksByFile(file.path);
            // Retired for good: lifting tv-ignore later mints fresh IDs.
            this.ledger.dropFile(file.path);
            // With no rows to match against, a hint has nothing left to claim.
            this.hints.dropFile(file.path);
            this.claims.forget(file.path);
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
     * Where the row a write names stands in the lines that write was handed.
     *
     * The upstream half of identity: the question a scan answers for a whole
     * file, asked for one name and without writing anything down. The ledger
     * and the claim log are read, never changed — only a scan writes them —
     * so asking twice, or asking and then not writing, leaves no trace.
     *
     * A coordinate comes out of three things and nothing else:
     *
     * 1. the row's `^id`, when it names exactly one line outside a fence —
     *    the one piece of evidence that outlives every edit;
     * 2. a content on record (`WriteClaims.stateFor`): the lines read, whole,
     *    as the last write left them or the last scan read them, so the rows
     *    recorded for that content stand where they were recorded — no parse;
     * 3. otherwise the match a scan of these lines would make, as the scan
     *    makes it: the pending claims weighed against the ledger, and with
     *    none adopted, the ladder paired against the newest state known to be
     *    older than these lines (`WriteClaims.ladderFor`). The name has to
     *    come out paired with one line on evidence: a pair the ladder chose by
     *    position among identical rows is `ambiguous`, because writing on a
     *    guess is worse than not writing. Where no partner is safe (the
     *    chain's cap has dropped states), the answer is `outdated`.
     *
     * What never comes out of here is the line a task held when it was last
     * scanned, or the first line that reads like it. Neither says anything
     * about the lines in hand.
     *
     * A name the ledger has not heard of — a row a write made, not yet scanned
     * (the names a write answers as `made`) — is found through 2, or through 3
     * when a pending claim is adopted or when the ladder pairs against the
     * state the write left (lines that changed after it). On lines where the
     * next scan would hand the name to no row it is `gone`, and that is the
     * answer, not a gap: this function answers what that scan would decide.
     * Answering with the one line that reads like the row would part from the
     * scan, and on text alone, the weakest evidence there is: an outside edit
     * that took the made row away and wrote another line in its words would
     * have this write land on that line.
     *
     * Found through 1 or 3, the line may read differently from anything on
     * record for the row — the ladder pairs a row whose text or dates changed,
     * and a `^id` holds across any edit. That is still the row. Whether it
     * still reads as the write planned is the write's question, not this
     * one's (see `WriteSession.row`).
     */
    locate(path: string, lines: readonly string[], ref: TaskRef): Located {
        const byBlockId = lineOfBlockId(lines, ref.blockId);
        if (byBlockId !== null) return { kind: 'at', line: byBlockId };

        const recorded = this.claims.stateFor(path, lines);
        if (recorded !== null) {
            const row = recorded.find(candidate => candidate.runtimeId === ref.runtimeId);
            return row ? { kind: 'at', line: row.line } : { kind: 'gone' };
        }

        const parsed = FileParsePipeline.parse(path, [...lines], this.settings);
        if (parsed.ignored) return { kind: 'gone' };

        const previous = this.ledger.snapshotFor(path);
        const before = this.ledger.contentFor(path);
        const read = contentKeyOf(lines);
        // The partner the next scan of these lines would pair against. None
        // is safe past the chain's cap, and a write would rather not write.
        const ladder = this.claims.ladderFor(path, read, { content: before, rows: previous });
        if (ladder === null) return { kind: 'outdated' };
        // Names for the rows nothing pairs. They leave this function with
        // nothing but a comparison against `ref`, which none of them can equal.
        let unnamed = 0;
        const { result } = matchWithoutRepeatedIds(
            hints => matchFile(previous, parsed.tasks, () => `locate:unnamed:${++unnamed}`, hints, ladder),
            {
                pending: this.hints.peekFor(path, Date.now()),
                before,
                read,
            },
        );

        const among = result.guessed.get(ref.runtimeId);
        if (among !== undefined) return { kind: 'ambiguous', count: among };
        const at = parsed.tasks.find(task => result.mapping.get(task.id) === ref.runtimeId);
        if (!at) return { kind: 'gone' };
        return this.againstLastWrite(path, lines, at.line, ref) ?? { kind: 'at', line: at.line };
    }

    /**
     * Whether the row's line at `line` reads as some text the plugin has on
     * record for the row: as the last scan read it, as the last write left it,
     * or as a pending claim says. The weaker comparison the timer's inserts
     * keep until F9 (`RowBasis.ON_RECORD`).
     */
    onRecord(path: string, lines: readonly string[], ref: TaskRef, line: number): boolean {
        return this.recordedTexts(path, ref.runtimeId).has(Outline.UP_TO_INDENT.key(lines[line]));
    }

    /**
     * A match made while a write of ours has landed that no committed scan
     * has read, checked against what that write left. A scan that read the
     * file before the write and committed after it does not count: its ledger
     * is older than the write all the same (`WriteClaims.lastWrite`).
     *
     * The ladder pairs by the texts the ledger holds, and the ledger is known
     * to be older than our last write (see `WriteClaims.stateFor`). A row that
     * write changed is looked for under the text it no longer has, and one
     * whose text it handed to another row comes out on that row's line. What
     * the write left is the newest record there is, so the line has to read as
     * the target's text there, and as no other row's — else the pairing rests
     * on a text that has since moved, and the answer is `outdated`. A write
     * that could not say what it left leaves nothing to check against, and the
     * answer is `outdated` as well.
     *
     * Null when there is nothing to object to.
     */
    private againstLastWrite(path: string, lines: readonly string[], line: number, ref: TaskRef): Located | null {
        const last = this.claims.lastWrite(path);
        if (last === undefined) return null;
        const holders = last.rows?.filter(row => Outline.UP_TO_INDENT.holds(row.text, lines[line])) ?? [];
        if (!holders.some(row => row.runtimeId === ref.runtimeId)) return { kind: 'outdated' };
        if (holders.length > 1) return { kind: 'ambiguous', count: holders.length };
        return null;
    }

    /**
     * Every text the plugin has on record for one row: as the last scan read
     * it, as the last write left it, and as each pending claim says it reads.
     * Without the indentation, which places the row in the tree and is read
     * off the file by every write that needs it: a row moved under another is
     * not a row whose text changed.
     */
    private recordedTexts(path: string, runtimeId: string): Set<string> {
        const texts = new Set<string>();
        const entry = this.ledger.get(runtimeId);
        if (entry && entry.file === path) texts.add(Outline.UP_TO_INDENT.key(entry.fingerprint.originalText));
        for (const row of this.claims.lastWrite(path)?.rows ?? []) {
            if (row.runtimeId === runtimeId) texts.add(Outline.UP_TO_INDENT.key(row.text));
        }
        for (const pending of this.hints.peekFor(path, Date.now())) {
            for (const row of pending.hint.rows) {
                if (row.runtimeId === runtimeId) texts.add(Outline.UP_TO_INDENT.key(row.text));
            }
        }
        return texts;
    }

    /**
     * 設定を更新
     */
    updateSettings(settings: TaskViewerSettings): void {
        this.settings = settings;
    }
}

/**
 * The one line outside a fence that carries this `^id`, or null when there is
 * none or more than one. A `^id` copied along with its line names two rows,
 * and proves nothing about either — the same rule as the ladder's first rung.
 */
function lineOfBlockId(lines: readonly string[], blockId: string | undefined): number | null {
    const id = blockId?.trim();
    if (!id) return null;

    const pattern = new RegExp(`\\s\\^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
    const outline = Outline.read(lines);
    let found: number | null = null;
    for (let i = 0; i < lines.length; i++) {
        if (outline.inCode(i) || !pattern.test(lines[i])) continue;
        if (found !== null) return null;
        found = i;
    }
    return found;
}
