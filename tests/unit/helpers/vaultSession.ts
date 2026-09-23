import { expect, vi } from 'vitest';
import { type App, parseYaml, TFile } from 'obsidian';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import type { TaskScanner } from '../../../src/services/core/TaskScanner';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import { DEFAULT_SETTINGS } from '../../../src/types';
import type { Task } from '../../../src/types';
import { splitLines } from '../../../src/utils/FileLines';
import type { Refusal, WriteChannel, WriteOrigin } from '../../../src/utils/FileLines';

export function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.basename = file.name.replace(/\.[^.]+$/, '');
    file.extension = path.split('.').pop() ?? '';
    return file;
}

/** What `metadataCache.getCache` answers — only the fields `TaskScanner` reads. */
interface VaultCache {
    frontmatter?: Record<string, unknown>;
    listItems?: unknown[];
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
    return { frontmatter, listItems };
}

/**
 * The private parts of a session that tests reach into. Every cast to one is
 * here, so a change to a private name is a change to this file.
 */

/** What a test reads of the index's flow executor. */
export interface FlowExecutorView {
    isProcessing: boolean;
    taskQueue: unknown[];
    handleTaskCompletion(task: Task): Promise<void>;
}

/** What a test reads of the scanner's write ledger. */
export interface ClaimsView {
    lastWrite(path: string): { rows: readonly unknown[] | null } | undefined;
    claim: (...args: unknown[]) => unknown;
}

/** The scanner a `TaskIndex` built, for a test that makes its own index. */
export function scannerOf(index: TaskIndex): TaskScanner {
    return (index as unknown as { scanner: TaskScanner }).scanner;
}

/**
 * One plugin session — a real TaskIndex, its scanner, a TimerRecorder — over
 * an in-memory vault shared between sessions.
 *
 * Writes go through the real write path (`vault.process`) and the real
 * `modify` handler `TaskIndex.initialize` registers (called here): whether a completion fires is answered
 * by the scan from the writes it reads, exactly as it would be after
 * Obsidian's own `modify` event. A write that changed bytes is followed by the
 * `metadataCache` `changed` event real Obsidian sends after `modify`; the scan
 * that asks for commits nothing when it reads what the last scan read
 * (`TaskScanner.rescanUnlessRead`).
 *
 * A second `vaultSession` over the same `contents` is a reload: a new index,
 * a new ledger, new runtime IDs.
 */
export function vaultSession(contents: Map<string, string>) {
    let scanner: TaskScanner | undefined;
    const noop = { on: () => ({}), offref: () => { } };
    const vaultHandlers = new Map<string, (...args: unknown[]) => unknown>();
    // Obsidian holds one TFile per note, and a write to it queues by that
    // object (`processOrFail`): the same path answers the same file.
    const held = new Map<string, TFile>();
    const fileAt = (path: string): TFile => held.get(path) ?? held.set(path, makeFile(path)).get(path)!;
    const app = {
        vault: {
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
                    await (vaultHandlers.get('modify') as (f: TFile) => Promise<void>)(file);
                    const changed = vaultHandlers.get('changed') as ((f: TFile) => void) | undefined;
                    if (changed) changed(file);
                }
                return next;
            },
            // A file written whole. Obsidian answers the new TFile and sends a
            // `create`, which the index scans like any other arrival — so the
            // scan follows here too, and every row in the file is minted by it.
            create: async (path: string, data: string) => {
                const file = fileAt(path);
                contents.set(path, data);
                await (vaultHandlers.get('create') as (f: TFile) => void | Promise<void>)(file);
                return file;
            },
            getAbstractFileByPath: (path: string) => (contents.has(path) ? fileAt(path) : null),
            getMarkdownFiles: () => [...contents.keys()].map(fileAt),
        },
        metadataCache: {
            ...noop,
            on: (name: string, fn: (...args: unknown[]) => unknown) => { vaultHandlers.set(name, fn); return {}; },
            getCache: (path: string) => (contents.has(path) ? computeCache(contents.get(path)!) : null),
        },
        workspace: { ...noop, onLayoutReady: () => { }, activeLeaf: null },
    };

    const index = new TaskIndex(app as never, { ...DEFAULT_SETTINGS });
    scanner = scannerOf(index);
    scanner.setInitializing(false);
    // Registers the real vault/metadataCache handlers `process`/`create`
    // above call into. `onLayoutReady` never runs its callback here.
    void index.initialize();

    const internals = index as unknown as {
        commandExecutor: FlowExecutorView;
        editorSignal: { mark(path: string): void };
        reportRefusal(refusal: Refusal): void;
    };
    const executor = internals.commandExecutor;
    // The channel `TaskIndex` connected, taken before a test connects another.
    const observer = index.getRepository().getWriteObserver();
    const connected = (observer as unknown as { resolve: (file: string, origin: WriteOrigin) => WriteChannel }).resolve;

    let n = 0;
    const storageUtils = {
        generateTimerTargetId: () => `tv-t-test${++n}`,
        isAutoManagedTimerTargetId: () => true,
    } as unknown as TimerStorageUtils;
    const plugin = {
        settings: { ...DEFAULT_SETTINGS },
        getTaskIndex: () => index,
        getTaskWriteService: () => new TaskWriteService(index),
    };

    return {
        /** For a test that writes through `processLines` itself. */
        app: app as unknown as App,
        index,
        scanner,
        /** The flow executor: whether it is busy, its queue, the completion it is handed. */
        executor,
        /** The scanner's write ledger. */
        claims: (scanner as unknown as { claims: ClaimsView }).claims,
        /** The channel `TaskIndex` gave a write to `file`, even after a test has connected another. */
        channelOf: (file: string, origin: WriteOrigin = 'user'): WriteChannel => connected(file, origin),
        /** Tell `TaskIndex` a write was refused, as its own channel does. */
        reportRefusal: (refusal: Refusal): void => internals.reportRefusal(refusal),
        /** The editor signals a change to `path` — a keystroke — the way the live editor does. */
        markEditor: (path: string): void => internals.editorSignal.mark(path),
        recorder: new TimerRecorder(app as never, plugin as never, storageUtils),
        creator: new TimerCreator({} as TimerContext, storageUtils),
        fireVault: (name: string, ...args: unknown[]) => vaultHandlers.get(name)!(...args),
        scanAll: () => scanner!.scanVault(),
        settle: (path: string) => index.waitForScan(path),
        /**
         * Wait until the flow executor has nothing running or queued, then
         * until the scan of each `path` has finished.
         */
        flowSettled: async (...paths: string[]): Promise<void> => {
            await vi.waitFor(() => {
                expect(executor.isProcessing).toBe(false);
                expect(executor.taskQueue).toHaveLength(0);
            });
            for (const path of paths) await index.waitForScan(path);
        },
        dispose: () => index.dispose(),
    };
}

export type VaultSession = ReturnType<typeof vaultSession>;
