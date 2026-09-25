import type { App, TFile } from 'obsidian';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import type { TaskStore } from './TaskStore';
import type { TaskValidator } from './TaskValidator';
import type { Task, TaskViewerSettings } from '../../types';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import { contentKeyOf, type ContentKey } from './ContentKey';
import { WriteLinks } from './WriteLinks';
import { splitLines, type Landing } from '../../utils/FileLines';
import type { OutlineReading } from '../parsing/utils/Outline';
import { logDebug, logError, logInfo } from '../../log/log';

/**
 * タスクスキャナー — ファイル単位の読みのオーケストレーション。
 * 1 回の読みは 4 相を順に呼ぶだけ:
 *   parse    — FileParsePipeline（ファイル → Task[]、仮 ID。パース順序契約の所有者）
 *   name     — 仮 ID を、この読みの中の名前（パス、内容の鍵、行）に置き換える
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

    /**
     * The key of the content each file's last committed reading read — a
     * scan's, or a write's that landed (`landed`). A reading of the same
     * content parses to what the index holds, so it is not committed again:
     * the one condition under which a read is skipped. Cleared when the vault
     * is read whole (`scanVault`), as it is when the settings change what a
     * parse makes of the same lines.
     */
    private committed = new Map<string, ContentKey>();

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
    landed(path: string, landing: Landing, commit = true): boolean {
        const to = contentKeyOf(landing.lines);
        this.links.wrote(path, contentKeyOf(landing.before), to, landing.before.length, landing.edits);
        // Read already, by the scan the write's own `modify` started.
        if (!commit || this.committed.get(path) === to) return false;
        return this.commitRead(path, [...landing.lines], landing.reading ?? undefined);
    }

    /**
     * The name the row `name` names has now, when a write of ours moved on
     * from the content that name was given in: followed across the writes'
     * reports (`WriteLinks`) to the content the index last read. Null when
     * it names no row now — a write took the row away, or the file changed
     * some other way since.
     */
    follow(name: string): string | null {
        const read = TaskIdGenerator.readName(name);
        if (!read) return null;
        const content = this.committed.get(read.filePath);
        if (content === undefined) return null;
        const line = this.links.follow(read.filePath, read.content, read.line, content);
        return line === null ? null : TaskIdGenerator.nameOf(read.parserId as Task['parserId'], read.filePath, line, content);
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
     * Commit one reading of `path`, `lines`, unless it is of the content the
     * last committed reading read. `reading` is a reading of these lines
     * already made.
     */
    private commitRead(path: string, lines: string[], reading?: OutlineReading): boolean {
        const file = { path };
        const readKey = contentKeyOf(lines);
        if (this.committed.get(path) === readKey) return false;
        this.validator.clearErrorsForFile(file.path);

        // --- parse ---
        const parsed = FileParsePipeline.parse(file.path, lines, this.settings, reading);

        if (parsed.ignored) {
            this.store.removeTasksByFile(file.path);
            this.links.drop(file.path);
            this.committed.set(file.path, readKey);
            return true;
        }

        // --- name ---
        // Right after parse, so nothing downstream — validator included — ever
        // sees a provisional ID.
        nameRows(parsed.tasks, file.path, readKey);

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
            this.committed.set(file.path, readKey);
        } finally {
            this.store.endBatch();
        }
        return true;
    }

    /**
     * ファイルリネーム（md → md）時の内部状態の破棄。名前はパスを含むので、
     * 新パスの読みが新しい名前を付ける。
     */
    handleFileRenamed(oldPath: string, newPath: string): void {
        this.scanQueue.delete(oldPath);
        for (const path of [oldPath, newPath]) {
            this.committed.delete(path);
            this.links.drop(path);
        }
    }

    /**
     * ファイル削除（md → 非 md のリネームを含む）時の内部状態の破棄。
     * scanQueue から path を除去し、読みと書き込みの記録を捨てる。
     */
    handleFileDeleted(path: string): void {
        this.scanQueue.delete(path);
        this.committed.delete(path);
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
function nameRows(tasks: Task[], path: string, content: ContentKey): void {
    const names = new Map<string, string>();
    for (const task of tasks) names.set(task.id, TaskIdGenerator.nameOf(task.parserId, path, task.line, content));
    const rename = (id: string) => names.get(id) ?? id;
    for (const task of tasks) {
        task.id = rename(task.id);
        if (task.parentId !== undefined) task.parentId = rename(task.parentId);
        task.childIds = task.childIds.map(rename);
    }
}
