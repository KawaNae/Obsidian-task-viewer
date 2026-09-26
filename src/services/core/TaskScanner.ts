import { type App, TFile } from 'obsidian';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import type { TaskStore } from './TaskStore';
import type { TaskValidator } from './TaskValidator';
import type { Task, TaskViewerSettings } from '../../types';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import { contentKeyOf, type ContentKey } from './ContentKey';
import { WriteLinks } from './WriteLinks';
import { newSession, readReading, readingId, type ReadingId } from './Reading';
import { splitLines, type Landing, type ReadMark } from '../../utils/FileLines';
import type { OutlineReading } from '../parsing/utils/Outline';
import { TaskLineClassifier } from '../parsing/utils/TaskLineClassifier';
import { logDebug, logError, logInfo } from '../../log/log';

/**
 * タスクスキャナー — ファイル単位の読みのオーケストレーション。
 * 1 回の読みは 4 相を順に呼ぶだけ:
 *   parse    — FileParsePipeline（ファイル → Task[]、仮 ID。パース順序契約の所有者）
 *   name     — 仮 ID を、この読みの中の名前（パス、読みの番号、行）に置き換える
 *   validate — バリデーション警告の収集（以降は名前しか見ない）
 *   commit   — store 更新
 *
 * 前回の読みと突き合わせない。名前は 1 回の読みの中だけで意味を持ち、読み
 * 直しをまたぐ同一性は `^id` だけが担う（structure.md の「名前」）。自分の
 * 書き込みをまたぐ名前は、書き込みの報告で写す（`WriteLinks`）。
 *
 * スキャンは読むだけで、フローを発火させない。発火は完了させた操作が起こす
 * （エディタのトランザクションと、プラグイン自身の書き込み。structure.md の
 * 「発火の可否」）。
 */
export class TaskScanner {
    private scanQueue: Map<string, Promise<unknown>> = new Map();

    /** This index's readings, apart from any other's (`ReadingId`). */
    private readonly session = newSession();

    /**
     * The last number given to a reading of each file, and the key of that
     * reading's content: a scan's reading, or what a write of ours left
     * (`landed`), committed or not — a write to the file being dragged gives
     * its number all the same. A content read again that the reading with the
     * last number read takes no new number.
     *
     * The number is kept when the file is renamed or deleted, and the key is
     * not, so that no number is given twice in a session and a content read
     * after is a new reading. A reading is committed only if no number after
     * the one it started from is given: one that read the file before is
     * late, and what it read is older than what the index holds.
     */
    private numbers = new Map<string, ReadMark>();

    /** The number of each file's last committed reading: the one the store holds. */
    private committed = new Map<string, number>();

    /**
     * Files to be read again even if their content is the one their last
     * reading read: every file when the vault is read whole (`scanVault`), as
     * it is when the settings change what a parse makes of the same lines,
     * and a file a caller asks for (`requestScan`).
     */
    private stale = new Set<string>();

    /** Our own writes to each file, to follow a name across them (`follow`). */
    private links = new WriteLinks();

    /**
     * The file whose readings are not taken into the store now (`hold`), and
     * whether one was held back since: the file being dragged, whose store
     * copy the drag draws from until it ends.
     */
    private holding: { path: string; held: boolean } | null = null;
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
        for (const path of this.committed.keys()) this.stale.add(path);
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
        this.stale.add(file.path);
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
     * The last reading of `path` a number was given to, as a write is handed
     * the file (`WriteChannel.reading`).
     */
    readingOf(path: string): ReadMark {
        return this.numbers.get(path) ?? { n: 0, key: undefined };
    }

    /**
     * A write of ours landed in `path`, leaving `landing.lines`: take them in
     * as the file's next reading, now, without waiting for the scan its
     * `modify` starts — which then reads the same content and commits
     * nothing. Whether it committed.
     *
     * The lines are what the file holds: `processOrFail` answered that the
     * write landed, and nothing is read that the write did not leave. The
     * write left the reading after the one it was handed with its lines
     * (`Landing.handed`): writes to one file run one at a time, each told
     * here before the next is handed its lines (`processOrFail`), so a write
     * handed a content that reading is not was handed a change nobody
     * reported, and what came before is not followed across it. What it left
     * is a number given, committed or not (`commit`: the file held is not),
     * and it is late like any other reading: a scan that read the file after
     * the write got its number first.
     *
     * The write left reading `n` only if reading `n` is its lines: the number
     * is given here, or the late scan that took it read what the write left.
     * A scan that read an edit from outside took the number for other lines,
     * and a row the write carried to a line of its own lines is not the row on
     * that line of the scan's: nothing is followed across the write.
     */
    landed(path: string, landing: Landing): boolean {
        const { handed } = landing;
        const last = this.readingOf(path);
        const from = contentKeyOf(landing.before);
        const to = contentKeyOf(landing.lines);
        const n = handed.n + 1;
        const left = n > last.n || (n === last.n && last.key === to);
        const start = left && handed.key === from ? handed.n : null;
        this.links.wrote(path, start, from, to, landing.before.length, landing.edits);
        if (n <= last.n) return false;
        this.numbers.set(path, { n, key: to });
        return this.commit(path, [...landing.lines], n, to, landing.reading ?? undefined);
    }

    /**
     * Where line `line` of reading `n` of `path` stands in the reading the
     * last number was given to: the line itself when that is reading `n`,
     * the line our own writes from `n` carried it to when that reading is the
     * one they left (`WriteLinks.walk`), else null.
     */
    private carry(path: string, n: number, line: number): number | null {
        const last = this.numbers.get(path);
        if (last === undefined) return null;
        if (n === last.n) return line;
        const walked = this.links.walk(path, n, line);
        return walked?.n === last.n ? walked.line : null;
    }

    /**
     * Where line `line` of reading `read` of `path` stands in content `now`,
     * when `now` is the content of the reading the last number was given to
     * (`carry`), else null. What a write asks of a row read in some reading
     * (`WriteChannel.follow`).
     */
    followLine(path: string, read: ReadingId, line: number, now: ContentKey): number | null {
        const reading = readReading(read);
        if (!reading || reading.session !== this.session) return null;
        return this.numbers.get(path)?.key === now ? this.carry(path, reading.n, line) : null;
    }

    /**
     * The name the row `name` names has now, when the store holds the reading
     * the last number was given to and the row stands in it (`carry`). Null
     * when it names no row now — a write took the row away, the file was read
     * some other way since, or what our writes left is not committed yet.
     */
    follow(name: string): string | null {
        const read = TaskIdGenerator.readName(name);
        const reading = read ? readReading(read.reading) : null;
        if (!read || !reading || reading.session !== this.session) return null;
        const last = this.numbers.get(read.filePath);
        if (last === undefined || this.committed.get(read.filePath) !== last.n) return null;
        const line = this.carry(read.filePath, reading.n, read.line);
        if (line === null) return null;
        return TaskIdGenerator.nameOf(read.parserId as Task['parserId'], read.filePath, line, readingId(this.session, last.n));
    }

    /**
     * ファイルをスキャンしてタスクを抽出（parse → identity → validate → commit）
     */
    private async scanFile(file: TFile): Promise<boolean> {
        // Before the read: a number given while it is under way may be of a
        // content after the one it gets.
        const after = this.readingOf(file.path).n;
        const content = await this.app.vault.read(file);
        const { lines } = splitLines(content);
        return this.scanned(file.path, lines, after);
    }

    /**
     * A scan read `lines` of `path`, begun when `after` was the last number
     * given: commit it as the reading after that. Not committed when it is
     * late — a number after `after` is given already, to the file as it was
     * then or later.
     *
     * A content the reading with the last number read is that reading: it
     * takes no new number, and is committed only when the store does not hold
     * it — a reading of the file held, or of a write to it — or the file is
     * to be read again whatever it read (`stale`). Parsed again, its rows
     * keep their names.
     */
    private scanned(path: string, lines: string[], after: number): boolean {
        const last = this.readingOf(path);
        if (last.n > after) return false;
        const key = contentKeyOf(lines);
        if (last.key !== key) {
            this.numbers.set(path, { n: after + 1, key });
            return this.commit(path, lines, after + 1, key);
        }
        if (this.committed.get(path) === last.n && !this.stale.has(path)) return false;
        return this.commit(path, lines, last.n, key);
    }

    /**
     * Hold back every reading of `path` from the store from now on, or of no
     * file (null), and let go of the file held before: the file being
     * dragged. When a reading of that file was held back, it is read again
     * and committed then (`scanned`: its last reading is not the committed
     * one). Whether that committed.
     *
     * The one place that answers whether a file's reading may go in the
     * store now is `commit`, whoever read it: a change from outside, the
     * `changed` after it, a write of ours landing, or a caller asking for
     * the file again (`requestScan`).
     */
    hold(path: string | null): Promise<boolean> {
        const released = this.holding;
        this.holding = path === null ? null : { path, held: false };
        if (!released?.held) return Promise.resolve(false);
        const file = this.app.vault.getAbstractFileByPath(released.path);
        return file instanceof TFile ? this.queue(file) : Promise.resolve(false);
    }

    /** Whether readings of `path` are held back now (`hold`). */
    holds(path: string): boolean {
        return this.holding?.path === path;
    }

    /**
     * Put reading `n` of `path`, `lines` of content `key`, in the store, unless
     * the file is held (`hold`). `reading` is a reading of these lines already
     * made. Whether it went in.
     */
    private commit(path: string, lines: string[], n: number, key: ContentKey, reading?: OutlineReading): boolean {
        if (this.holding?.path === path) {
            this.holding.held = true;
            return false;
        }
        const file = { path };
        this.validator.clearErrorsForFile(file.path);

        // --- parse ---
        const parsed = FileParsePipeline.parse(file.path, lines, this.settings, reading);

        if (parsed.ignored) {
            this.store.removeTasksByFile(file.path);
            this.links.drop(file.path);
            this.readRead(file.path, n);
            return true;
        }

        // --- name ---
        // Right after parse, so nothing downstream — validator included — ever
        // sees a provisional ID.
        nameRows(parsed.tasks, file.path, readingId(this.session, n));
        anchorRows(parsed.tasks, lines);

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

        // Two readings of one change, or a pipeline that outlived its index
        // and kept scanning, print this line twice: the console belongs to the
        // window rather than to a copy of the module.
        logDebug(`[scan] file=${file.path} tasks=${parsed.tasks.length}`);

        // --- commit (batched: 1 file = 1 revision bump) ---
        this.store.beginBatch();
        try {
            this.store.removeTasksByFile(file.path);

            for (const task of parsed.tasks) {
                this.store.setTask(task.id, task);
            }

            // removeTasksByFile above dropped the previous ones, so this is a
            // replacement, not a merge — the scan owns the file's blocks.
            this.store.setGenBlocks(file.path, parsed.genBlocks);

            // Last, so a store write that throws leaves the file to be read again.
            this.readRead(file.path, n);
        } finally {
            this.store.endBatch();
        }
        return true;
    }

    /** Reading `n` of `path` is committed. */
    private readRead(path: string, n: number): void {
        this.committed.set(path, n);
        this.stale.delete(path);
    }

    /**
     * ファイルリネーム（md → md）時の内部状態の破棄。名前はパスを含むので、
     * 新パスの読みが新しい名前を付ける。
     */
    handleFileRenamed(oldPath: string, newPath: string): void {
        this.scanQueue.delete(oldPath);
        for (const path of [oldPath, newPath]) this.forget(path);
    }

    /**
     * ファイル削除（md → 非 md のリネームを含む）時の内部状態の破棄。
     * scanQueue から path を除去し、読みと書き込みの記録を捨てる。
     */
    handleFileDeleted(path: string): void {
        this.scanQueue.delete(path);
        this.forget(path);
    }

    /**
     * Let go of what was read of `path`, but the last number given, and of
     * holding it: a file renamed or deleted is not the one being dragged.
     */
    private forget(path: string): void {
        if (this.holding?.path === path) this.holding = null;
        const last = this.numbers.get(path);
        if (last !== undefined) this.numbers.set(path, { n: last.n, key: undefined });
        this.committed.delete(path);
        this.stale.delete(path);
        this.links.drop(path);
    }

    /**
     * 設定を更新
     */
    updateSettings(settings: TaskViewerSettings): void {
        this.settings = settings;
    }
}

/**
 * Give every row of one reading its name, in place of the provisional ID the
 * parser gave it: `parentId` and `childIds` too, which the parser has
 * already written with the provisional ones. A provisional ID is the row's
 * line, and so is a name, so one reading's names are as distinct as its
 * lines.
 */
function nameRows(tasks: Task[], path: string, reading: ReadingId): void {
    const names = new Map<string, string>();
    for (const task of tasks) names.set(task.id, TaskIdGenerator.nameOf(task.parserId, path, task.line, reading));
    const rename = (id: string) => names.get(id) ?? id;
    for (const task of tasks) {
        task.id = rename(task.id);
        if (task.parentId !== undefined) task.parentId = rename(task.parentId);
        task.childIds = task.childIds.map(rename);
    }
}

/**
 * Give a row its anchor (`Task.anchor`): the `^id` on its line, when no other
 * line of the reading carries that `^id`. Every line is counted, a task's or
 * not and whichever parser reads it, so an `^id` Obsidian would resolve to
 * two places anchors neither.
 */
function anchorRows(tasks: Task[], lines: readonly string[]): void {
    const count = new Map<string, number>();
    const ids = lines.map(line => TaskLineClassifier.extractLineBlockId(line).blockId);
    for (const id of ids) if (id !== undefined) count.set(id, (count.get(id) ?? 0) + 1);
    for (const task of tasks) {
        const id = ids[task.line];
        if (id !== undefined && count.get(id) === 1) task.anchor = id;
    }
}
