import { type App, parseYaml, TFile, TFolder } from 'obsidian';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import type { TaskScanner } from '../../../src/services/core/TaskScanner';
import { Operations } from '../../../src/services/operations/Operations';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import { DEFAULT_SETTINGS } from '../../../src/types';
import type { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { splitLines } from '../../../src/services/persistence/FileLines';
import type { Refusal, WriteChannel } from '../../../src/services/persistence/FileLines';
import type { DiskProbe } from '../../../src/services/core/DiskProbe';
import type { DiskReconciler } from '../../../src/services/core/DiskReconciler';
import type { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import { linkDouble } from './linkDouble';

export function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.basename = file.name.replace(/\.[^.]+$/, '');
    file.extension = path.split('.').pop() ?? '';
    return file;
}

/** A wikilink as `metadataCache.getCache` lists it: its target (alias left out) and the line it is on. */
interface CachedLink {
    link: string;
    original: string;
    position: { start: { line: number; col: number; offset: number }; end: { line: number; col: number; offset: number } };
}

/**
 * What `metadataCache.getCache` answers — the fields `TaskScanner` reads,
 * and the wikilinks and embeds a note writes (`NoteRefs.linksTo`).
 */
interface VaultCache {
    frontmatter?: Record<string, unknown>;
    listItems?: unknown[];
    links: CachedLink[];
    embeds: CachedLink[];
}

/** A line that opens a bullet, a numbered item, or a checkbox. */
const LIST_LINE = /^\s*(?:[-*+]\s|\d+[.)]\s)/;

/**
 * What `metadataCache.getCache` would answer for this content, computed
 * fresh from it every call rather than cached.
 *
 * That statelessness is what makes it faithful to the race
 * `TaskScanner.ts:60-66` documents: read from inside a `vault.process`
 * callback, before `contents.set` runs, it answers the file as it was before
 * this write; read by the scan that follows, it answers the file this write
 * produced. Nothing has to track which is which.
 *
 * `frontmatter` is parsed the way `FileParsePipeline`'s own fallback parses
 * a raw `---` block (`FileParsePipeline.ts:44-58`) — the same `parseYaml` —
 * so a file with no cache-backed frontmatter and a file with cache-backed
 * frontmatter read alike. `listItems` is a presence flag, not real Obsidian's
 * shape: `TaskScanner.mayContainTasks` (`:131-149`) only checks its length,
 * and false positives are the side that function already accepts (`:128`).
 */
function computeCache(content: string): VaultCache {
    const { lines } = splitLines(content);
    let frontmatter: Record<string, unknown> | undefined;

    if (lines[0]?.trim() === '---') {
        let end = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') { end = i; break; }
        }
        if (end > 0) {
            try {
                const parsed: unknown = parseYaml(lines.slice(1, end).join('\n'));
                if (parsed && typeof parsed === 'object') {
                    frontmatter = parsed as Record<string, unknown>;
                }
            } catch {
                // Malformed YAML: real Obsidian's cache omits frontmatter too,
                // and FileParsePipeline's own fallback swallows the same error.
            }
        }
    }

    const listItems = lines.some(line => LIST_LINE.test(line)) ? [{}] : undefined;
    const links: CachedLink[] = [];
    const embeds: CachedLink[] = [];
    lines.forEach((line, n) => {
        for (const m of line.matchAll(/(!?)\[\[([^\]]*)\]\]/g)) {
            const col = m.index ?? 0;
            const at = { line: n, col, offset: 0 };
            (m[1] ? embeds : links).push({
                link: m[2].split('|')[0],
                original: m[0],
                position: { start: at, end: { ...at, col: col + m[0].length } },
            });
        }
    });
    return { frontmatter, listItems, links, embeds };
}

/**
 * The note of `paths` a link spelling `linkpath` resolves to, as Obsidian
 * resolves one (`getFirstLinkpathDest`), case aside: the note at that path,
 * or else the first by that name.
 */
function linkDest(paths: readonly string[], linkpath: string): string | undefined {
    const bare = linkpath.replace(/\.md$/i, '').toLowerCase();
    return paths.find(p => p.replace(/\.md$/i, '').toLowerCase() === bare)
        ?? paths.find(p => (p.split('/').pop() ?? p).replace(/\.md$/i, '').toLowerCase() === bare);
}

/**
 * The private parts of a session that tests reach into. Every cast to one is
 * here, so a change to a private name is a change to this file.
 */

/** The index's flow executor, whose `planFire` a test wraps to count fires. */
export type FlowExecutorView = FlowExecutor;

/** The scanner a `TaskIndex` built, for a test that makes its own index. */
export function scannerOf(index: TaskIndex): TaskScanner {
    return (index as unknown as { scanner: TaskScanner }).scanner;
}

/**
 * One plugin session — a real TaskIndex, its scanner, a TimerRecorder — over
 * an in-memory vault shared between sessions.
 *
 * Writes go through the real write path (`vault.process`) and the real
 * `modify` handler `TaskIndex.initialize` registers (called here): the scan
 * reads the writes exactly as it would after Obsidian's own `modify` event. A
 * completion fires in the write that made it, never from a scan. A write that changed bytes is followed by the
 * `metadataCache` `changed` event real Obsidian sends after `modify`; the scan
 * that asks for commits nothing when it reads what the last scan read
 * (`TaskScanner.queueScan`).
 *
 * A second `vaultSession` over the same `contents` is a reload: a new index,
 * a new session of readings, new names.
 *
 * `contents` is the disk: a test that sets it without writing through the
 * index makes an edit from outside whose change event never came. The index
 * has a reconciler only when `probe` is given (its stand-in for the disk's
 * stats); it starts it when the test says (`reconciler.start()`), as the
 * plugin does once the vault is read.
 *
 * `config` is what `.obsidian/app.json` holds (`Vault.getConfig`); without
 * it the vault has no `getConfig`, and the plugin reads Obsidian's defaults
 * (`ObsidianConfig`).
 */
export function vaultSession(contents: Map<string, string>, options: { probe?: DiskProbe; config?: Record<string, unknown> } = {}) {
    let scanner: TaskScanner | undefined;
    const noop = { on: () => ({}), offref: () => { } };
    const vaultHandlers = new Map<string, (...args: unknown[]) => unknown>();
    // Obsidian holds one TFile per note, and a write to it queues by that
    // object (`processOrFail`): the same path answers the same file.
    const held = new Map<string, TFile>();
    const fileAt = (path: string): TFile => held.get(path) ?? held.set(path, makeFile(path)).get(path)!;
    // While set, a write's change events wait here instead of reaching the
    // index: the scan a write's `modify` starts has not come yet.
    let heldEvents: TFile[] | null = null;
    const fireChanged = async (file: TFile) => {
        await (vaultHandlers.get('modify') as (f: TFile) => Promise<void>)(file);
        const changed = vaultHandlers.get('changed') as ((f: TFile) => void) | undefined;
        if (changed) changed(file);
    };
    const config = options.config;
    const app = {
        vault: {
            ...(config ? { getConfig: (key: string) => config[key] } : {}),
            on: (name: string, fn: (...args: unknown[]) => unknown) => { vaultHandlers.set(name, fn); return {}; },
            offref: () => { },
            read: async (file: TFile) => contents.get(file.path) ?? '',
            process: async (file: TFile, fn: (data: string) => string) => {
                const before = contents.get(file.path) ?? '';
                const next = fn(before);
                contents.set(file.path, next);
                // Obsidian fires no `modify` for a write that produced the same
                // bytes, so no scan follows one here either. Without that, a
                // no-op write looks like a real one to everything downstream —
                // identity hints included, which wait for a scan that the real
                // vault would never send.
                if (next !== before) {
                    if (heldEvents) heldEvents.push(file);
                    else await fireChanged(file);
                }
                return next;
            },
            // A file written whole. Obsidian answers the new TFile and sends a
            // `create`, which the index scans like any other arrival — so the
            // scan follows here too, and every row in the file is minted by it.
            // A path that differs from a note's in case alone is taken, as
            // on the file systems of macOS and Windows (stage 0).
            create: async (path: string, data: string) => {
                if ([...contents.keys()].some(p => p.toLowerCase() === path.toLowerCase())) throw new Error('File already exists.');
                const file = fileAt(path);
                contents.set(path, data);
                await (vaultHandlers.get('create') as (f: TFile) => void | Promise<void>)(file);
                return file;
            },
            getAbstractFileByPath: (path: string) => (contents.has(path) ? fileAt(path) : null),
            getMarkdownFiles: () => [...contents.keys()].map(fileAt),
            getFiles: () => [...contents.keys()].map(fileAt),
            // The folders the notes are in; none is kept apart from them.
            getAllFolders: () => [...new Set([...contents.keys()].flatMap(path => {
                const parts = path.split('/').slice(0, -1);
                return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
            }))].map(path => Object.assign(new TFolder(), { path, name: path.split('/').pop() })),
            createFolder: async () => { },
        },
        fileManager: {
            // To the trash: the note is gone from the vault, which says so.
            trashFile: async (file: TFile) => {
                contents.delete(file.path);
                held.delete(file.path);
                await (vaultHandlers.get('delete') as (f: TFile) => void)(file);
            },
            // Spelt as Obsidian was measured to spell a new link, by default settings.
            generateMarkdownLink: linkDouble(() => [...contents.keys()]),
            // Obsidian's default place for new notes: the vault's root.
            getNewFileParent: (_sourcePath: string) => Object.assign(new TFolder(), { path: '/', name: '' }),
        },
        metadataCache: {
            ...noop,
            on: (name: string, fn: (...args: unknown[]) => unknown) => { vaultHandlers.set(name, fn); return {}; },
            getCache: (path: string) => (contents.has(path) ? computeCache(contents.get(path)!) : null),
            getFirstLinkpathDest: (linkpath: string, _sourcePath: string) => {
                const path = linkDest([...contents.keys()], linkpath);
                return path === undefined ? null : fileAt(path);
            },
            /** Per note, the notes its links and embeds resolve to, and how many times. */
            get resolvedLinks(): Record<string, Record<string, number>> {
                const paths = [...contents.keys()];
                const out: Record<string, Record<string, number>> = {};
                for (const [from, content] of contents) {
                    out[from] = {};
                    const { links, embeds } = computeCache(content);
                    for (const one of [...links, ...embeds]) {
                        const to = one.link.split('#')[0];
                        const dest = to === '' ? undefined : linkDest(paths, to);
                        if (dest !== undefined) out[from][dest] = (out[from][dest] ?? 0) + 1;
                    }
                }
                return out;
            },
        },
        workspace: { ...noop, onLayoutReady: () => { }, activeLeaf: null },
    };

    const index = new TaskIndex(app as never, { ...DEFAULT_SETTINGS }, { probe: options.probe ?? null });
    scanner = scannerOf(index);
    // Registers the real vault/metadataCache handlers `process`/`create`
    // above call into. `onLayoutReady` never runs its callback here.
    void index.initialize();

    const ops = new Operations(app as never, index);
    const internals = index as unknown as {
        reconciler: DiskReconciler | null;
        readVault(): Promise<void>;
    };
    const opsInternals = ops as unknown as {
        commandExecutor: FlowExecutorView;
        reportRefusal(refusal: Refusal): void;
        repository: TaskRepository;
    };
    const executor = opsInternals.commandExecutor;
    // The channel the operations connected, taken before a test connects another.
    const connected = (opsInternals.repository as unknown as { channels: (file: string) => WriteChannel }).channels;

    let n = 0;
    // What the recorder calls to save the timers before it writes a line.
    let persist = (): void => { };
    // The timers the recorder sees open, when it decides whether it may take an anchor off.
    let openTimers = (): Iterable<TimerInstance> => [];
    const storageUtils = {
        generateTimerTargetId: () => `tv-t-test${++n}`,
    } as unknown as TimerStorageUtils;
    const plugin = {
        settings: { ...DEFAULT_SETTINGS },
        getIndex: () => index,
        getOperations: () => ops,
    };

    return {
        /** For a test that writes through `processLines` itself. */
        app: app as unknown as App,
        index,
        /** The operations over `index`: the one way a test writes, as the plugin does. */
        ops,
        /** The repository the operations write through, for a test that connects its own channel or writes by hand. */
        repository: opsInternals.repository,
        scanner,
        /** The flow executor, whose `planFire` plans every completion's fire. */
        executor,
        /** The scanner's private scan entry, which a test wraps to see its answers. */
        scannerPrivates: scanner as unknown as { queueScan: (file: TFile) => Promise<boolean> },
        /** The channel the operations gave a write to `file`, even after a test has connected another. */
        channelOf: (file: string): WriteChannel => connected(file),
        /** The index's reconciler, when the session was given a probe. */
        reconciler: internals.reconciler,
        /** Tell the operations a write was refused, as their own channel does. */
        reportRefusal: (refusal: Refusal): void => opsInternals.reportRefusal(refusal),
        recorder: new TimerRecorder(app as never, plugin as never, storageUtils, () => persist(), () => openTimers()),
        /** Save the timers as the plugin does when the recorder asks, before it writes a line. */
        onPersist: (fn: () => void): void => { persist = fn; },
        /** The open timers the recorder sees, as the widget's own map. */
        onOpenTimers: (fn: () => Iterable<TimerInstance>): void => { openTimers = fn; },
        creator: new TimerCreator({} as TimerContext),
        fireVault: (name: string, ...args: unknown[]) => vaultHandlers.get(name)!(...args),
        /** Read the whole vault, and tell the listeners, as the index does once the layout is ready. */
        scanAll: () => internals.readVault(),
        /**
         * Hold every write's change events until `release`, which sends them
         * in order: the moment between a write landing and the scan it starts.
         */
        holdScans: (): { release: () => Promise<void> } => {
            heldEvents = [];
            return {
                release: async () => {
                    const events = heldEvents ?? [];
                    heldEvents = null;
                    for (const file of events) await fireChanged(file);
                },
            };
        },
        settle: (path: string) => scanner!.waitForScan(path),
        /**
         * Wait until the scan of each `path` has finished. A fire is made in
         * the write that completed its row, so by the time that write is back
         * there is nothing of it left to wait for but the scans it started.
         */
        flowSettled: async (...paths: string[]): Promise<void> => {
            for (const path of paths) await scanner!.waitForScan(path);
        },
        dispose: () => { ops.dispose(); index.dispose(); },
    };
}

/** The note a session opens when it is given one text or one list of lines. */
const NOTE = 'note.md';

/**
 * A session over `files`, scanned once. One text or one list of lines is
 * `NOTE`; a record names each file and gives its text or its lines.
 * The caller disposes the session.
 */
export async function openVault(
    files: string | string[] | Record<string, string | string[]>,
    options: { config?: Record<string, unknown> } = {},
): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    const text = (content: string | string[]) => (typeof content === 'string' ? content : content.join('\n'));
    const contents = new Map<string, string>(
        typeof files === 'string' || Array.isArray(files)
            ? [[NOTE, text(files)]]
            : Object.entries(files).map(([path, content]) => [path, text(content)]),
    );
    const session = vaultSession(contents, options);
    await session.scanAll();
    return { contents, session };
}

export type VaultSession = ReturnType<typeof vaultSession>;

/**
 * `openVault`, handing the session to `setLive` besides — the `let live` a
 * vault test's own `open()` set, so `afterEach` can dispose it. Most vault
 * tests defined that `open()` themselves, byte for byte; this is the one
 * function they all called it for.
 */
export async function openLiveVault(
    files: string | string[] | Record<string, string | string[]>,
    setLive: (session: VaultSession) => void,
    options: { config?: Record<string, unknown> } = {},
): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    const opened = await openVault(files, options);
    setLive(opened.session);
    return opened;
}
