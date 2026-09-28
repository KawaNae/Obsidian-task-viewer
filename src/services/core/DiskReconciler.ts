import type { EventRef, TFile, WorkspaceLeaf } from 'obsidian';
import type { ReadMark } from '../persistence/FileLines';
import type { DiskProbe, DiskStat } from './DiskProbe';
import { logDebug, logError, logInfo } from '../../log/log';

/**
 * What makes the reconciler look at the disk (structure.md, 読みの鮮度): the
 * index read the vault (`start`), the window came back (`focus`, `visible`),
 * a view of the plugin came to the front (`view`), a minute went by
 * (`interval`), a write was refused as `changed` or `failed` (`refusal`), a
 * check found a reading stale (`stale`). The last two are evidence that a
 * change notice went missing, and do not wait.
 */
export type Trigger = 'start' | 'focus' | 'visible' | 'view' | 'interval' | 'refusal' | 'stale';

/** The triggers that wait until {@link QUIET_MS} after the last sweep started. */
const PATIENT: ReadonlySet<Trigger> = new Set<Trigger>(['focus', 'visible', 'view', 'interval']);

/** How long a patient trigger waits after the last sweep started. */
export const QUIET_MS = 2000;

/** How often the vault is swept while the window shows, where the whole vault is swept. */
export const INTERVAL_MS = 60_000;

/**
 * How long a divergence has been found, sweep after sweep, before it is told:
 * well past the time a change notice takes to come (seen up to 17 s late
 * under load on a Mac). Two sweeps a moment apart — a refusal's, right after
 * a focus's — would otherwise tell a notice still on its way. Short of the
 * interval, so the interval's next sweep tells it even when its timer fires a
 * little early (seen 59.995 s on Windows).
 */
export const LASTING_MS = INTERVAL_MS / 2;

/** How many divergences one sweep tells line by line; the rest are counted. */
const TOLD_PER_SWEEP = 20;

/** What the reconciler asks of the index. */
export interface ReconcileHost {
    /** Every markdown file Obsidian knows of (`vault.getMarkdownFiles`). */
    files(): TFile[];
    /** The index's last reading of the file (`TaskScanner.readingOf`): whether it has read it. */
    readingOf(path: string): ReadMark;
    /** Read the file again (`TaskScanner.queueScan`): whether that committed. */
    reread(file: TFile): Promise<boolean>;
    /** Take the file out of the index (`TaskIndex.forgetFile`). */
    forget(path: string): void;
    /** Tell the views the index changed, once for the sweep. */
    changed(): void;
}

/**
 * Where the reconciler hears its triggers: the workspace, the main window, and
 * which views are the plugin's — the plugin's to say, not the index's.
 */
export interface ReconcileEnv {
    workspace: {
        on(name: 'active-leaf-change', callback: (leaf: WorkspaceLeaf | null) => unknown): EventRef;
        on(name: 'window-open', callback: (win: unknown, window: Window) => unknown): EventRef;
        on(name: 'window-close', callback: (win: unknown, window: Window) => unknown): EventRef;
        offref(ref: EventRef): void;
    };
    /** The main window, when there is one (none in the unit tests). */
    win?: Window;
    /** Whether a view type is one of the plugin's views, whose coming to the front asks for a sweep. */
    isOwnView(viewType: string): boolean;
}

/**
 * Where Obsidian's model of a file and the disk part (`kind`): the disk's
 * stat differs from `TFile.stat` (`modified`), the file is gone from the disk
 * while Obsidian still holds it (`deleted`), a markdown file is on disk that
 * Obsidian does not know (`created`). Counted each sweep, told once it has
 * lasted {@link LASTING_MS}, never mended: Obsidian's model is Obsidian's.
 */
export interface Divergence {
    path: string;
    kind: 'modified' | 'deleted' | 'created';
    disk: DiskStat | null;
    obsidian: DiskStat | null;
}

/**
 * What the reconciler last made sure of for a file: the disk's stat, or that
 * the disk had no file there (`absent`), so a file that comes back is read
 * again even with the stat it had.
 */
type Recorded = DiskStat | 'absent';

/** What one sweep measured: the divergences, and what the index is to be mended by. */
interface Measured {
    divergences: Divergence[];
    reread: { file: TFile; stat: DiskStat }[];
    gone: string[];
}

/**
 * The index's reading of each file converges on the disk (structure.md,
 * 読みの鮮度): the one place that answers when a change notice never comes.
 *
 * At each trigger it stats the files on disk and compares each with what it
 * last made sure of (its record): a file whose stat moved, or that comes back
 * after it was gone, is read again through the one door every reading comes
 * in by (`queueScan`), so the commit and the hold of the file being dragged
 * answer as they do for any reading. A file gone from the disk is taken out
 * of the index. Nothing here decides what a reading is.
 *
 * The comparison is with its own record, not with `TFile.stat`: when
 * Obsidian drops a change notice, `TFile.stat` is as stale as the index. A
 * file it has no record of starts from `TFile.stat`, which is wrong only
 * where Obsidian missed a change — and then the disk's stat differs from it.
 * A reading the index moved on to by an event or a write of ours needs no
 * record: either moved the disk's stat too.
 *
 * One sweep runs at a time. A trigger during one asks for one more after
 * it; a patient trigger within {@link QUIET_MS} of the last start waits
 * that out.
 */
export class DiskReconciler {
    private record = new Map<string, Recorded>();
    private started = false;
    private disposed = false;
    private running = false;
    /** The trigger of the sweep asked for while one runs. */
    private again: Trigger | null = null;
    private lastStart = Number.NEGATIVE_INFINITY;
    private deferred: { timer: ReturnType<typeof setTimeout>; trigger: Trigger } | null = null;
    /** Files a trigger named, read again at the next sweep whatever their stat says. */
    private named = new Set<string>();
    /** Each divergence found by every sweep since it was first, and when it was first found. */
    private seen = new Map<string, number>();
    /** The lasting divergences told already, so each is told once. */
    private told = new Set<string>();
    private undo: (() => void)[] = [];

    constructor(
        private readonly host: ReconcileHost,
        private readonly probe: DiskProbe,
        private readonly env: ReconcileEnv,
    ) { }

    /** Whether the whole vault is swept: where the disk is cheap to ask (the desktop app). */
    private get whole(): boolean {
        return this.probe.list !== undefined;
    }

    /** Begin: once the index has read the vault. Sweeps once, then listens. */
    start(): void {
        if (this.started || this.disposed) return;
        this.started = true;
        this.listen();
        this.request('start');
    }

    /** Stop listening, and let a sweep under way end without mending anything more. */
    dispose(): void {
        this.disposed = true;
        for (const undo of this.undo) undo();
        this.undo = [];
        if (this.deferred) clearTimeout(this.deferred.timer);
        this.deferred = null;
    }

    /**
     * Ask for a sweep. `path`, when given, is read again at that sweep
     * whatever its stat says: the file a write was refused in, or whose
     * reading a check found stale. Before `start` and after `dispose`,
     * nothing is swept.
     */
    request(trigger: Trigger, path?: string): void {
        if (path !== undefined) this.named.add(path);
        if (!this.started || this.disposed) return;
        if (this.running) {
            if (this.again === null || !PATIENT.has(trigger)) this.again = trigger;
            return;
        }
        const wait = PATIENT.has(trigger) ? this.lastStart + QUIET_MS - Date.now() : 0;
        if (wait > 0) {
            this.deferred ??= { timer: setTimeout(() => this.fireDeferred(), wait), trigger };
            return;
        }
        void this.run(trigger);
    }

    private fireDeferred(): void {
        const trigger = this.deferred?.trigger;
        this.deferred = null;
        if (trigger) this.request(trigger);
    }

    private async run(trigger: Trigger): Promise<void> {
        if (this.deferred) clearTimeout(this.deferred.timer);
        this.deferred = null;
        this.running = true;
        this.lastStart = Date.now();
        try {
            await this.sweep(trigger);
        } catch (error) {
            logError(`[Reconcile] trigger=${trigger} failed: ${(error as Error)?.message ?? error}`, { notice: false });
        } finally {
            this.running = false;
            const again = this.again;
            this.again = null;
            if (again !== null) this.request(again);
        }
    }

    /** One sweep: measure, mend the index, tell. */
    private async sweep(trigger: Trigger): Promise<void> {
        const files = this.host.files();
        const scope = this.whole ? files : files.filter(file => this.host.readingOf(file.path).n > 0);
        const named = this.named;
        this.named = new Set();

        let started = performance.now();
        const disk = await this.statAll(scope.map(file => file.path));
        const statMs = Math.round(performance.now() - started);
        let unknown: Map<string, DiskStat | null> | null = null;
        let listMs = 0;
        if (this.probe.list) {
            started = performance.now();
            const listed = await this.probe.list();
            listMs = Math.round(performance.now() - started);
            // What Obsidian does not know, stated as the disk has it.
            const known = new Set(files.map(file => file.path));
            unknown = await this.statAll(listed.filter(path => !known.has(path)));
        }
        if (this.disposed) return;

        const measured = this.measure(files, scope, disk, unknown, named);
        const committed = await this.mend(measured);
        if (committed === null) return;

        const count = (kind: Divergence['kind']) => measured.divergences.filter(d => d.kind === kind).length;
        const summary = `[Reconcile] trigger=${trigger} scope=${scope.length} stat=${statMs}ms${unknown ? ` list=${listMs}ms` : ''}`
            + ` reread=${measured.reread.length} committed=${committed} dropped=${measured.gone.length}`
            + ` obsidian:modified=${count('modified')} deleted=${count('deleted')} created=${count('created')}`;
        // Only a divergence that lasts is told, and once; while it only
        // lasts, the summary drops to debug, or Obsidian's model, stale until
        // a reload, would fill the log a line a minute.
        const unseen = this.newlyLasting(measured.divergences, Date.now());
        if (unseen.length > 0 || committed > 0 || measured.gone.length > 0) logInfo(summary);
        else logDebug(summary);
        this.tell(unseen);
    }

    /** The disk's stat of each path, asked a batch at a time, control given back between. */
    private async statAll(paths: readonly string[]): Promise<Map<string, DiskStat | null>> {
        const all = new Map<string, DiskStat | null>();
        for (let i = 0; i < paths.length; i += this.probe.batch) {
            if (i > 0) await new Promise(resolve => setTimeout(resolve, 0));
            if (this.disposed) break;
            for (const [path, stat] of await this.probe.stat(paths.slice(i, i + this.probe.batch))) all.set(path, stat);
        }
        return all;
    }

    /**
     * Compare what the disk answered with the record, and with Obsidian's
     * model: which files to read again, which to take out of the index, and
     * where Obsidian's model parts from the disk. The record is made anew
     * from the files swept, so a file out of scope leaves it. A file gone
     * from the disk is recorded as `absent` while Obsidian still holds it:
     * the index forgot it, so when it comes back it is read, whatever its
     * stat.
     */
    private measure(
        files: readonly TFile[],
        scope: readonly TFile[],
        disk: ReadonlyMap<string, DiskStat | null>,
        unknown: ReadonlyMap<string, DiskStat | null> | null,
        named: ReadonlySet<string>,
    ): Measured {
        const measured: Measured = { divergences: [], reread: [], gone: [] };
        const next = new Map<string, Recorded>();
        for (const file of scope) {
            const stat = disk.get(file.path);
            const before = this.record.get(file.path);
            // Not answered for: nothing is known of it this time.
            if (stat === undefined) {
                if (before) next.set(file.path, before);
                continue;
            }
            const obsidian = { mtime: file.stat.mtime, size: file.stat.size };
            if (stat === null) {
                measured.divergences.push({ path: file.path, kind: 'deleted', disk: null, obsidian });
                // Taken out once: a file the index holds nothing of is not taken out again.
                if (this.host.readingOf(file.path).key !== undefined) measured.gone.push(file.path);
                next.set(file.path, 'absent');
                continue;
            }
            if (!sameStat(stat, obsidian)) measured.divergences.push({ path: file.path, kind: 'modified', disk: stat, obsidian });
            const made = before ?? obsidian;
            if (made === 'absent' || !sameStat(stat, made) || named.has(file.path)) {
                measured.reread.push({ file, stat });
            } else {
                next.set(file.path, stat);
            }
        }
        // A file named outside the scope (one the index has not read, off
        // the desktop app) is read all the same.
        const inScope = new Set(scope.map(file => file.path));
        for (const file of files) {
            if (named.has(file.path) && !inScope.has(file.path)) {
                measured.reread.push({ file, stat: { mtime: file.stat.mtime, size: file.stat.size } });
            }
        }
        for (const [path, stat] of unknown ?? []) {
            // Gone again since it was listed: nothing to count.
            if (stat) measured.divergences.push({ path, kind: 'created', disk: stat, obsidian: null });
        }
        this.record = next;
        return measured;
    }

    /**
     * Mend the index: read again what moved, take out what is gone, and tell
     * the views once. How many readings committed; null when the reconciler
     * was disposed on the way.
     *
     * The stat is recorded as measured, before the reading: a write from
     * outside between the two leaves the record behind the disk, and the
     * next sweep reads the file once more rather than missing it.
     */
    private async mend(measured: Measured): Promise<number | null> {
        let committed = 0;
        for (const { file, stat } of measured.reread) {
            if (this.disposed) return null;
            if (await this.host.reread(file)) committed++;
            this.record.set(file.path, stat);
        }
        if (this.disposed) return null;
        for (const path of measured.gone) this.host.forget(path);
        if (committed > 0 || measured.gone.length > 0) this.host.changed();
        return committed;
    }

    /**
     * The divergences found by every sweep for {@link LASTING_MS} and not
     * told yet. One found for a moment may be a change whose notice is still
     * on its way: a sweep that runs between a write and its `modify` finds
     * Obsidian's stat behind the disk. A notice Obsidian dropped leaves the
     * divergence until a reload, so it lasts. By time, not by sweeps: a
     * refusal's sweep does not wait for the quiet time, and can come a moment
     * after the sweep before. Told by path, kind and disk stat: one that ends
     * and comes back is new again.
     */
    private newlyLasting(divergences: readonly Divergence[], now: number): Divergence[] {
        const seen = new Map<string, number>();
        const told = new Set<string>();
        const unseen: Divergence[] = [];
        for (const divergence of divergences) {
            const id = `${divergence.kind}|${divergence.path}|${statText(divergence.disk)}`;
            const since = this.seen.get(id) ?? now;
            seen.set(id, since);
            if (now - since < LASTING_MS) continue;
            told.add(id);
            if (!this.told.has(id)) unseen.push(divergence);
        }
        this.seen = seen;
        this.told = told;
        return unseen;
    }

    /** Log each divergence, up to {@link TOLD_PER_SWEEP} lines a sweep, the rest counted in one. */
    private tell(divergences: readonly Divergence[]): void {
        for (const divergence of divergences.slice(0, TOLD_PER_SWEEP)) {
            const disk = divergence.kind === 'deleted' ? '' : ` disk=${statText(divergence.disk)}`;
            const obsidian = divergence.kind === 'created' ? '' : ` obsidian=${statText(divergence.obsidian)}`;
            logInfo(`[Reconcile:diverge] kind=${divergence.kind} path=${divergence.path}${disk}${obsidian}`);
        }
        const untold = divergences.length - TOLD_PER_SWEEP;
        if (untold > 0) logInfo(`[Reconcile:diverge] ${untold} more not listed`);
    }

    /** Subscribe to every trigger but the ones asked for by the index. */
    private listen(): void {
        const { workspace, win } = this.env;
        const own = (ref: EventRef) => this.undo.push(() => workspace.offref(ref));
        const onFocus = () => this.request('focus');
        const focusOf = new Map<Window, () => void>();
        const watch = (target: Window) => {
            if (focusOf.has(target)) return;
            target.addEventListener('focus', onFocus);
            focusOf.set(target, () => target.removeEventListener('focus', onFocus));
        };
        this.undo.push(() => {
            for (const unwatch of focusOf.values()) unwatch();
            focusOf.clear();
        });
        if (win) {
            watch(win);
            const doc = win.document;
            const onVisible = () => {
                if (doc.visibilityState === 'visible') this.request('visible');
            };
            doc.addEventListener('visibilitychange', onVisible);
            this.undo.push(() => doc.removeEventListener('visibilitychange', onVisible));
        }
        own(workspace.on('window-open', (_popout, popoutWin) => watch(popoutWin)));
        own(workspace.on('window-close', (_popout, popoutWin) => {
            focusOf.get(popoutWin)?.();
            focusOf.delete(popoutWin);
        }));
        own(workspace.on('active-leaf-change', (leaf) => {
            if (leaf && this.env.isOwnView(leaf.view.getViewType())) this.request('view');
        }));
        if (this.whole) {
            const timer = setInterval(() => {
                if (!win || win.document.visibilityState === 'visible') this.request('interval');
            }, INTERVAL_MS);
            this.undo.push(() => clearInterval(timer));
        }
    }
}

function sameStat(a: DiskStat, b: DiskStat): boolean {
    return a.mtime === b.mtime && a.size === b.size;
}

function statText(stat: DiskStat | null): string {
    return stat ? `${stat.mtime}/${stat.size}` : '-';
}
