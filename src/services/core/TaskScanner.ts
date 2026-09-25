import type { App, TFile } from 'obsidian';
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
     * Each file's last committed reading — a scan's, or a write's that landed
     * (`landed`): its number, and the key of the content it read. A reading
     * of the same content parses to what the index holds, so it is not
     * committed again, and takes no number.
     */
    private readings = new Map<string, { n: number; key: ContentKey }>();

    /**
     * The number of each file's last committed reading, kept when the file
     * is renamed or deleted, so that no number is given twice in a session.
     */
    private numbers = new Map<string, number>();

    /**
     * Files to be read again even if their content is the one their last
     * reading read: every file when the vault is read whole (`scanVault`), as
     * it is when the settings change what a parse makes of the same lines,
     * and a file a caller asks for (`requestScan`).
     */
    private stale = new Set<string>();

    /** Our own writes to each file, to follow a name across them (`follow`). */
    private links = new WriteLinks();
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
        for (const path of this.readings.keys()) this.stale.add(path);
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
     * The index's last reading of `path`, as a write is handed the file
     * (`WriteChannel.reading`).
     */
    readingOf(path: string): ReadMark {
        return { n: this.numbers.get(path) ?? 0, key: this.readings.get(path)?.key };
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
     * it. In between, a write planned from the older reading is refused where
     * the file does not read as that reading did.
     */
    landed(path: string, landing: Landing, commit = true): boolean {
        const handed = landing.handed ?? this.readingOf(path);
        this.links.wrote(path, handed, contentKeyOf(landing.before), contentKeyOf(landing.lines), landing.before.length, landing.edits);
        if (!commit) return false;
        return this.commitRead(path, [...landing.lines], landing.reading ?? undefined);
    }

    /**
     * Where line `line` of reading `read` of `path` stands in content `now`:
     * the line itself when `read` is the index's last reading and `now` is
     * its content, the line our own writes from `read` carried it to when
     * `now` is what they left (`WriteLinks.walk`), else null. What a write
     * asks of a row read in some reading (`WriteChannel.follow`).
     */
    followLine(path: string, read: ReadingId, line: number, now: ContentKey): number | null {
        const reading = readReading(read);
        if (!reading || reading.session !== this.session) return null;
        const walked = this.links.walk(path, reading.n, line);
        if (walked) return walked.key === now ? walked.line : null;
        const last = this.readings.get(path);
        return last?.n === reading.n && last.key === now ? line : null;
    }

    /**
     * The name the row `name` names has now, when writes of ours led on from
     * the reading that name was given in to the index's last reading of the
     * file: followed across the writes' reports (`WriteLinks`). Null when it
     * names no row now — a write took the row away, or the file was read
     * some other way since.
     */
    follow(name: string): string | null {
        const read = TaskIdGenerator.readName(name);
        const reading = read ? readReading(read.reading) : null;
        if (!read || !reading || reading.session !== this.session) return null;
        const last = this.readings.get(read.filePath);
        if (last === undefined) return null;
        const walked = this.links.walk(read.filePath, reading.n, read.line);
        if (!walked || walked.n !== last.n || walked.key !== last.key) return null;
        return TaskIdGenerator.nameOf(read.parserId as Task['parserId'], read.filePath, walked.line, readingId(this.session, last.n));
    }

    /**
     * ファイルをスキャンしてタスクを抽出（parse → identity → validate → commit）
     */
    private async scanFile(file: TFile): Promise<boolean> {
        const content = await this.app.vault.read(file);
        const { lines } = splitLines(content);
        return this.commitRead(file.path, lines);
    }

    /**
     * Commit one reading of `path`, `lines`, as the file's next reading,
     * unless it is of the content the last committed reading read. `reading`
     * is a reading of these lines already made.
     *
     * A file to be read again whatever it read (`stale`) that reads as its
     * last reading did is that reading, parsed again: it keeps its number, and
     * its rows their names. No reading came between, so no write of ours did.
     */
    private commitRead(path: string, lines: string[], reading?: OutlineReading): boolean {
        const file = { path };
        const readKey = contentKeyOf(lines);
        const last = this.readings.get(path);
        const again = last?.key === readKey;
        if (again && !this.stale.has(path)) return false;
        const n = again ? last.n : (this.numbers.get(path) ?? 0) + 1;
        this.validator.clearErrorsForFile(file.path);

        // --- parse ---
        const parsed = FileParsePipeline.parse(file.path, lines, this.settings, reading);

        if (parsed.ignored) {
            this.store.removeTasksByFile(file.path);
            this.links.drop(file.path);
            this.readRead(file.path, n, readKey);
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
            this.readRead(file.path, n, readKey);
        } finally {
            this.store.endBatch();
        }
        return true;
    }

    /** Reading `n` of `path`, of content `key`, is committed. */
    private readRead(path: string, n: number, key: ContentKey): void {
        this.readings.set(path, { n, key });
        this.numbers.set(path, n);
        this.stale.delete(path);
    }

    /**
     * ファイルリネーム（md → md）時の内部状態の破棄。名前はパスを含むので、
     * 新パスの読みが新しい名前を付ける。
     */
    handleFileRenamed(oldPath: string, newPath: string): void {
        this.scanQueue.delete(oldPath);
        for (const path of [oldPath, newPath]) {
            this.readings.delete(path);
            this.stale.delete(path);
            this.links.drop(path);
        }
    }

    /**
     * ファイル削除（md → 非 md のリネームを含む）時の内部状態の破棄。
     * scanQueue から path を除去し、読みと書き込みの記録を捨てる。
     */
    handleFileDeleted(path: string): void {
        this.scanQueue.delete(path);
        this.readings.delete(path);
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
