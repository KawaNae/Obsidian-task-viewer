import { type App, type DataAdapter, FileSystemAdapter } from 'obsidian';
import { nodeFs, type NodeFs } from '../../utils/hostEnv';

/**
 * A file's size and last change as the disk has them now, in the units
 * Obsidian keeps them in (`TFile.stat`), so the two compare directly.
 */
export interface DiskStat {
    mtime: number;
    size: number;
}

/**
 * What the reconciler asks of the disk (`DiskReconciler`). Every question
 * goes to the disk itself, never to Obsidian's model of it: when Obsidian
 * drops a change notice, its model is as stale as the index.
 */
export interface DiskProbe {
    /** How many paths one `stat` is handed: the sweep gives control back between them. */
    readonly batch: number;
    /**
     * Each path's stat, or null when there is no file there. A path the disk
     * could not answer for (an error other than its absence) is left out:
     * it is not known to be gone.
     */
    stat(paths: readonly string[]): Promise<Map<string, DiskStat | null>>;
    /**
     * Every markdown file on disk, as vault paths, folders whose name opens
     * with a dot left out as Obsidian leaves them out. Only where the whole
     * vault is cheap to walk (the desktop app), and that is also where the
     * reconciler sweeps the whole vault.
     */
    list?(): Promise<string[]>;
}

/**
 * The probe this app can have: Node's `fs` on the desktop app, the vault's
 * adapter elsewhere, none when there is no adapter to ask.
 */
export function diskProbeOf(app: App): DiskProbe | null {
    const adapter = app.vault.adapter as DataAdapter | undefined;
    if (!adapter) return null;
    if (adapter instanceof FileSystemAdapter) {
        const fs = nodeFs();
        if (fs) return new NodeDiskProbe(adapter, fs);
    }
    return new AdapterDiskProbe(adapter);
}

/**
 * Obsidian's `mtime` from Node's `mtimeMs`: Node's is fractional, Obsidian's
 * is the whole millisecond nearest to it.
 */
export function wholeMs(mtimeMs: number): number {
    return Math.round(mtimeMs);
}

/**
 * The desktop probe: Node's `fs` straight to the disk. Not the adapter's
 * `stat`, which queues behind every other file operation of the adapter, so
 * a sweep of the vault would hold them all up.
 */
export class NodeDiskProbe implements DiskProbe {
    readonly batch = 256;

    constructor(private readonly adapter: FileSystemAdapter, private readonly fs: NodeFs) { }

    async stat(paths: readonly string[]): Promise<Map<string, DiskStat | null>> {
        const stats = await Promise.all(paths.map(async (path): Promise<DiskStat | null | undefined> => {
            try {
                const stat = await this.fs.promises.stat(this.adapter.getFullPath(path));
                return { mtime: wholeMs(stat.mtimeMs), size: stat.size };
            } catch (error) {
                const code = (error as { code?: string } | null)?.code;
                return code === 'ENOENT' || code === 'ENOTDIR' ? null : undefined;
            }
        }));
        return answered(paths, stats);
    }

    async list(): Promise<string[]> {
        const base = this.adapter.getBasePath();
        const found: string[] = [];
        const walk = async (folder: string): Promise<void> => {
            let entries;
            try {
                entries = await this.fs.promises.readdir(folder === '' ? base : `${base}/${folder}`, { withFileTypes: true });
            } catch {
                return;
            }
            const below: Promise<void>[] = [];
            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue;
                const path = folder === '' ? entry.name : `${folder}/${entry.name}`;
                if (entry.isDirectory()) below.push(walk(path));
                else if (entry.isFile() && entry.name.endsWith('.md')) found.push(path);
            }
            await Promise.all(below);
        };
        await walk('');
        return found;
    }
}

/**
 * The probe off the desktop app: the adapter's own `stat`, a round trip to
 * the host each, so the sweep asks it of few files at a time and never
 * walks the vault.
 */
export class AdapterDiskProbe implements DiskProbe {
    readonly batch = 32;

    constructor(private readonly adapter: DataAdapter) { }

    async stat(paths: readonly string[]): Promise<Map<string, DiskStat | null>> {
        const stats = await Promise.all(paths.map(async (path): Promise<DiskStat | null | undefined> => {
            try {
                const stat = await this.adapter.stat(path);
                return stat && stat.type === 'file' ? { mtime: stat.mtime, size: stat.size } : null;
            } catch {
                return undefined;
            }
        }));
        return answered(paths, stats);
    }
}

/** The stats the disk answered, the paths it could not answer for left out. */
function answered(paths: readonly string[], stats: ReadonlyArray<DiskStat | null | undefined>): Map<string, DiskStat | null> {
    const map = new Map<string, DiskStat | null>();
    paths.forEach((path, i) => {
        const stat = stats[i];
        if (stat !== undefined) map.set(path, stat);
    });
    return map;
}
