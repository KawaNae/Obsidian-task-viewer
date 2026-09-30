import { type App, type EventRef, TFile } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { TaskStore } from './TaskStore';
import { TaskScanner } from './TaskScanner';
import type { IndexRefusal } from './RefusalClause';
import { NotifyCoalescer, type ChangeListener } from './NotifyCoalescer';
import { lineParsersFingerprint } from '../parsing/TaskParser';
import type { GenBlock } from '../parsing/gen/GenBlockCollector';
import { logError, logInfo, logWarn } from '../../log/log';
import { readInLine, type Landing, type ReadMark } from '../persistence/FileLines';
import type { ReadCopy } from '../persistence/TaskRefs';
import type { ContentKey } from './ContentKey';
import type { ReadingId } from './Reading';
import { checkCopy, checkFile, type CheckDeps, type Checked, type CopyChecked } from './ReadingCheck';
import { DiskReconciler } from './DiskReconciler';
import { diskProbeOf, type DiskProbe } from './DiskProbe';

/** How the index's reconciler meets the host (`DiskReconciler`). */
export interface ReconcileOptions {
    /** Where the disk is asked: by default the one this app can have (`diskProbeOf`); null for none. */
    probe?: DiskProbe | null;
    /**
     * Whether a view type is one of the plugin's views, whose coming to the
     * front asks for a sweep. The views are the plugin's to name, not the
     * index's; none by default.
     */
    isOwnView?: (viewType: string) => boolean;
}

/**
 * What the read side asks of the index (`PluginContext.getIndex`): the
 * copies of the last readings and how to look them up, when what it holds
 * changed, and holding a note's readings back while it is dragged. No method
 * writes a note: a write is an operation (`Operations`).
 */
export interface IndexReads {
    /** Current store revision number (incremented on every change of what the index holds). */
    getRevision(): number;
    getTasks(): Task[];
    /** The copy of the row `taskId` names, followed across our own writes (`TaskIndex.getTask`). */
    getTask(taskId: string): Task | undefined;
    /** The copy of the row `anchor` anchors in `filePath`'s last reading (`TaskIndex.getTaskByAnchor`). */
    getTaskByAnchor(filePath: string, anchor: string): Task | undefined;
    getGenBlock(filePath: string, name: string): GenBlock | undefined;
    getTaskByFileLine(filePath: string, line: number): Task | undefined;
    /** The task on a line an editor shows, in the content it shows (`TaskIndex.taskAtEditorLine`). */
    taskAtEditorLine(filePath: string, line: number, key: ContentKey): Task | undefined | null;
    onChange(callback: ChangeListener): () => void;
    /** Have the index read `file` now, and wait until it has. */
    requestScan(file: TFile): Promise<void>;
    /** Tell every listener now (`TaskIndex.notifyImmediate`). */
    notifyImmediate(): void;
    /** Hold the dragged note's readings back, or let them in (`TaskIndex.setDraggingFile`). */
    setDraggingFile(filePath: string | null): Promise<void>;
}

/**
 * The index: the copies of the last reading of each note, how to look them
 * up by name and by anchor, whether a copy is still what the disk holds, and
 * the one telling of a change to what it holds (structure/layers.md).
 *
 * The copies are written by the scan and by what a write of ours left
 * (`landed`), nothing else. The operations (`Operations`) read the index and
 * hand it what their writes left; the index knows nothing of them.
 */
export class TaskIndex implements IndexReads {
    private store: TaskStore;
    private scanner: TaskScanner;
    private settings: TaskViewerSettings;
    private parseFingerprint: string;

    /**
     * The index's listeners, and the one way they are told: once a frame
     * (16ms), merged (`NotifyCoalescer`), or at once (`notifyImmediate`).
     * Told only when what the index holds changed.
     */
    private readonly notify = new NotifyCoalescer(16);

    /**
     * Every vault subscription this index opened, with the emitter that closes
     * it.
     *
     * Held because a subscription outlives the object that made it. An index
     * left listening after the plugin unloads keeps its own scanner, and the
     * next load adds a second: one file change is then processed twice. That
     * is what an update without a restart used to look like.
     */
    private eventRefs: { emitter: { offref(ref: EventRef): void }; ref: EventRef }[] = [];

    /**
     * Brings the index's readings to the disk when a change notice never
     * comes (structure/layers.md, 読みの鮮度). None where there is no disk to ask.
     */
    private readonly reconciler: DiskReconciler | null;

    /** What a check of a copy against the disk asks (`ReadingCheck`). */
    private readonly checks: CheckDeps;

    /** @param reconcile how the reconciler meets the host ({@link ReconcileOptions}). */
    constructor(private app: App, settings: TaskViewerSettings, reconcile: ReconcileOptions = {}) {
        this.settings = settings;
        this.parseFingerprint = computeParseFingerprint(settings);

        this.store = new TaskStore();
        this.scanner = new TaskScanner(app, this.store, settings);
        this.checks = {
            read: (path) => {
                const file = app.vault.getAbstractFileByPath(path);
                if (!(file instanceof TFile)) return Promise.reject(new Error(`no note at ${path}`));
                return readInLine(app, file);
            },
            follow: (path, read, line, now) => this.scanner.followLine(path, read, line, now),
            last: (path) => this.scanner.readingOf(path),
        };
        const probe = reconcile.probe === undefined ? diskProbeOf(app) : reconcile.probe;
        this.reconciler = probe && new DiskReconciler({
            files: () => app.vault.getMarkdownFiles(),
            readingOf: (path) => this.scanner.readingOf(path),
            reread: (file) => this.scanner.queueScan(file),
            forget: (path) => this.forgetFile(path),
            changed: () => this.notify.schedule(),
        }, probe, {
            workspace: app.workspace,
            win: typeof window === 'undefined' ? undefined : window,
            isOwnView: reconcile.isOwnView ?? (() => false),
        });
    }

    async initialize(): Promise<void> {
        this.app.workspace.onLayoutReady(async () => {
            await this.readVault();
            // From the vault as read, the disk is checked against it.
            this.reconciler?.start();
        });

        // Vault イベントハンドラー
        this.own(this.app.vault, this.app.vault.on('modify', async (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // Told only when the scan committed: a write of ours was read
                // when it landed (`landed`), so its `modify` reads what the
                // index holds and commits nothing; the file being dragged is
                // read, but its reading is held back from the store until the
                // drag ends (`TaskScanner.hold`).
                if (await this.scanner.queueScan(file)) this.notify.schedule();
            }
        }));

        this.own(this.app.vault, this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.forgetFile(file.path);
                this.notify.schedule();
            }
        }));

        this.own(this.app.vault, this.app.vault.on('create', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                void this.rescanAndNotify(file);
            }
        }));

        this.own(this.app.metadataCache, this.app.metadataCache.on('changed', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                // `changed` follows every write, and mostly echoes a change
                // the file's `modify` already had scanned — ours, someone
                // else's, or the drag's own commit read when the drag ended.
                // The scan answers that by content and skips the commit and the
                // notify when there is nothing new (see TaskScanner.queueScan).
                void this.scanner.queueScan(file).then(committed => {
                    if (committed) this.notify.schedule();
                });
            }
        }));

        this.own(this.app.vault, this.app.vault.on('rename', async (file, oldPath) => {
            // md → 非md（拡張子変更）: delete 扱い
            if (!(file instanceof TFile) || file.extension !== 'md') {
                this.forgetFile(oldPath);
                this.notify.schedule();
                return;
            }

            // 非md → md: create 扱い
            if (!oldPath.endsWith('.md')) {
                await this.rescanAndNotify(file);
                return;
            }

            // md → md（通常のリネーム）。ドラッグ中のファイルなら、保留も外れる。
            this.store.removeTasksByFile(oldPath);
            this.scanner.handleFileRenamed(oldPath, file.path);

            await this.rescanAndNotify(file);
        }));
    }

    /**
     * Take a note that is no longer there out of the index: its rows, what
     * was read of it. A note deleted, renamed to something that
     * is not a note, or found gone from the disk (`DiskReconciler`). The
     * caller notifies.
     */
    private forgetFile(path: string): void {
        this.store.removeTasksByFile(path);
        this.scanner.handleFileDeleted(path);
    }

    /** Remember a subscription so `dispose` can close it. */
    private own(emitter: { offref(ref: EventRef): void }, ref: EventRef): void {
        this.eventRefs.push({ emitter, ref });
    }

    /**
     * A write of ours landed in `path`: the index reads what it left now,
     * rather than when the scan its `modify` starts gets there, so the next
     * operation plans from the file as it is. For the file being dragged the
     * reading is held back like any other of it (`TaskScanner.hold`); the
     * write's report is kept all the same, to follow names across it.
     */
    landed(path: string, landing: Landing): void {
        if (this.scanner.landed(path, landing)) this.notify.schedule();
    }

    /**
     * Where line `line` of reading `read` of `path` stands in content `now`,
     * across our own writes (`TaskScanner.followLine`): what a write asks of
     * the row it was planned on (`WriteChannel.follow`).
     */
    followLine(path: string, read: ReadingId, line: number, now: ContentKey): number | null {
        return this.scanner.followLine(path, read, line, now);
    }

    /** The index's last reading of `path` (`WriteChannel.reading`). */
    readingOf(path: string): ReadMark {
        return this.scanner.readingOf(path);
    }

    /**
     * Read the whole vault, then tell every listener, each in a task of its
     * own (`NotifyCoalescer.schedule`'s `staggered`): at startup, and when the
     * settings change what a parse makes of the same lines.
     */
    private async readVault(): Promise<void> {
        await this.scanner.scanVault();
        this.notify.schedule(undefined, undefined, { staggered: true });
    }

    /** Read the file back into the store, then notify. */
    private async rescanAndNotify(file: TFile): Promise<void> {
        await this.scanner.queueScan(file);
        this.notify.schedule();
    }

    // ===== 通知制御 =====

    /**
     * Tell every listener now that everything may have changed, with what was
     * waiting for the frame: for a view that has to match the index in this
     * frame — the end of a drag, the clock turning a card overdue.
     */
    notifyImmediate(): void {
        this.notify.flushNow();
    }

    // ===== ドラッグ制御 =====

    /**
     * ドラッグ中のファイルパスを設定する。そのファイルの読みは、誰が読んだ
     * ものも store に入れずに保留する（`TaskScanner.hold`）。ドラッグは
     * 始めたときの写しを描いているので、ドラッグ中の読みで描き直さない。
     *
     * 終了時（null）には、保留した読みがあればファイルを読み直して入れ、
     * 通知を頼む。返す Promise はその読みが入ってから解ける。ドラッグ確定の
     * 書き込みもここに含まれる: `DragSession.handleUp` は commit を待ってから
     * これを下ろし、読みが入るのを待ってから描く。
     */
    setDraggingFile(filePath: string | null): Promise<void> {
        return this.scanner.hold(filePath).then(committed => {
            if (committed) this.notify.schedule();
        });
    }

    // ===== 設定 =====

    getSettings(): TaskViewerSettings {
        return this.settings;
    }

    updateSettings(settings: TaskViewerSettings): void {
        const newFingerprint = computeParseFingerprint(settings);
        const needsRescan = newFingerprint !== this.parseFingerprint;
        this.parseFingerprint = newFingerprint;
        this.settings = settings;
        this.scanner.updateSettings(settings);
        if (needsRescan) {
            this.readVault()
                .catch((error) => {
                    logError(`[TaskIndex] Failed to rescan vault: ${(error as Error)?.message ?? error}`);
                });
        } else {
            // What a view draws of the same rows moved: every view draws again.
            this.notify.schedule(undefined, undefined, { staggered: true });
        }
    }

    /**
     * Let go of everything this index is holding the vault by.
     *
     * The subscriptions come first: a timer that fires after unload wastes a
     * frame, while a listener that survives it keeps a whole second pipeline
     * alive — one that scans and writes against the vault the next load is
     * already working on.
     */
    dispose(): void {
        for (const { emitter, ref } of this.eventRefs) emitter.offref(ref);
        this.eventRefs = [];
        this.reconciler?.dispose();

        this.notify.dispose();
    }

    // ===== データアクセス (TaskStoreへ委譲) =====

    /** Current store revision number (incremented on every mutation). */
    getRevision(): number {
        return this.store.getRevision();
    }

    getTasks(): Task[] {
        return this.store.getTasks();
    }

    /**
     * The index's copy of the row `taskId` names, or undefined when it names
     * none now.
     *
     * A name lasts one reading of its file. One given before a write of ours
     * is followed across that write's report to the row's name now
     * (`TaskScanner.follow`), so the copy that comes back may carry another
     * name than the one asked for: whoever holds the name takes the new one
     * from it. A name from before a change that was not ours names nothing.
     * This is the one place a name is followed.
     */
    getTask(taskId: string): Task | undefined {
        const held = this.store.getTask(taskId);
        if (held) return held;
        const now = this.scanner.follow(taskId);
        return now === null ? undefined : this.store.getTask(now);
    }

    /**
     * The index's copy of the row `anchor` anchors in `filePath` now
     * (`Task.anchor`), or undefined when no row of the file's last reading
     * carries that `^id` alone. The one place an anchor is looked up.
     *
     * An anchor outlives readings, a name does not: what comes back is the
     * copy of the last reading, under that reading's name. A write to it goes
     * by that name, and so through the one check every write passes
     * (`WriteSession.row`): a file that changed since the reading refuses it.
     */
    getTaskByAnchor(filePath: string, anchor: string): Task | undefined {
        return this.store.getTaskByAnchor(filePath, anchor);
    }

    /**
     * A generation block by name. Resolution is file-local: a command
     * reaches only the blocks of the file it is written in.
     */
    getGenBlock(filePath: string, name: string): GenBlock | undefined {
        return this.store.getGenBlock(filePath, name);
    }

    getTaskByFileLine(filePath: string, line: number): Task | undefined {
        return this.getTasks().find(t =>
            t.file === filePath && t.line === line
        );
    }

    /**
     * The task on line `line` of content `key`: a line an editor shows, in
     * the content it shows. Looked up only when the index's last reading of
     * the file is that content; null when it is another, since a line number
     * counts in nothing but the content it is in. Undefined when no task
     * stands on the line.
     */
    taskAtEditorLine(filePath: string, line: number, key: ContentKey): Task | undefined | null {
        if (this.scanner.readingOf(filePath).key !== key) return null;
        return this.getTaskByFileLine(filePath, line);
    }

    // ===== イベント管理 (TaskStoreへ委譲) =====

    onChange(callback: ChangeListener): () => void {
        return this.notify.onChange(callback);
    }

    // ===== スキャン関連 (TaskScannerへ委譲) =====

    async requestScan(file: TFile): Promise<void> {
        return this.scanner.requestScan(file);
    }

    // ===== 読みの鮮度（操作が問う） =====

    /**
     * Whether the copy is the row on the disk: the note read, and the copy's
     * line followed to it (`ReadingCheck.checkCopy`). What every operation
     * that plans from a copy asks first (`Operations.planCopy`).
     */
    checkCopy(task: ReadCopy): Promise<CopyChecked> {
        return checkCopy(this.checks, task);
    }

    /** Whether the index's last reading of `path` is what the disk holds (`ReadingCheck.checkFile`). */
    checkFile(path: string): Promise<Checked> {
        return checkFile(this.checks, path);
    }

    /** Read `file` again, and tell the listeners when that changed what the index holds. */
    async rescan(file: TFile): Promise<void> {
        if (await this.scanner.queueScan(file)) this.notify.schedule();
    }

    /**
     * What the index does when an operation found its note other than the
     * index read it, by the reason's kind, in one place: the log line, the
     * reading asked for, and what the reconciler is asked
     * (structure/layers.md, 読みの鮮度).
     *
     * `stale`: the note is read now, so the operation asked again plans from
     * the new reading, and the reconciler sweeps — one change notice missed
     * is evidence that others were too. `changed`, `failed`, `unreadable`: the
     * reconciler reads the note again at a sweep whatever its stat says,
     * since an edit the stat does not show, or a read that failed, is not
     * found by the stat. Not told the user: a row looked up by its anchor
     * (`freshByAnchor`) comes here and goes on.
     */
    async learnFrom({ file, reason, subject }: IndexRefusal): Promise<void> {
        switch (reason.kind) {
            case 'stale': {
                logInfo(`[ReadingCheck] stale file=${file} subject=${subject}`
                    + ` disk=${shortKey(reason.disk)} last=${shortKey(this.scanner.readingOf(file).key)}`);
                const note = this.app.vault.getAbstractFileByPath(file);
                if (note instanceof TFile) await this.rescan(note);
                this.reconciler?.request('stale');
                return;
            }
            case 'unreadable':
                logInfo(`[ReadingCheck] unreadable file=${file} subject=${subject}`);
                break;
            default:
                logWarn(`[TaskIndex] refused: file=${file} reason=${reason.kind} subject=${subject}`);
                // `gone`, `unplaceable`, `disturbs`, `headings`: the note read as the index read it.
                if (reason.kind !== 'changed' && reason.kind !== 'failed') return;
        }
        this.reconciler?.request('refusal', file);
    }

}

/** A content key as a log line gives it: the line count and the length, the hash cut short. */
function shortKey(key: ContentKey | undefined): string {
    if (!key) return '-';
    const cut = key.lastIndexOf(':');
    return `${key.slice(0, cut + 1)}${key.slice(cut + 1, cut + 7)}…`;
}

// ── Parse-affecting settings fingerprint ──
// These keys control how files are parsed into tasks. Changing any of them
// requires a full vault re-scan. All other settings (startHour, UI toggles,
// timer durations, etc.) are display-only and need only a notify.
//
// Uses a JSON fingerprint because the caller may pass the same object reference
// (plugin.settings is mutated in place, then updateSettings(this.settings) is
// called with the same ref). Field-by-field prev/next comparison would always
// see them as equal.
//
//   scopeKeys           — frontmatter field names for tv-start/end/due/etc.
//   lineParsersFingerprint — what the parser chain reads (which parsers are
//                         on, the Tasks emoji mapping); see lineParsers
//
// Not statusDefinitions: which status chars count as complete is read where a
// completion is answered and where a view draws, never by the parse, so a
// change to it needs only the notify.
export function computeParseFingerprint(settings: TaskViewerSettings): string {
    return JSON.stringify([settings.scopeKeys, lineParsersFingerprint(settings)]);
}
