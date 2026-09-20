import { TFile } from 'obsidian';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import type { TaskScanner } from '../../../src/services/core/TaskScanner';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import { DEFAULT_SETTINGS } from '../../../src/types';

export function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.basename = file.name.replace(/\.[^.]+$/, '');
    file.extension = path.split('.').pop() ?? '';
    return file;
}

/**
 * One plugin session — a real TaskIndex, its scanner, a TimerRecorder — over
 * an in-memory vault shared between sessions.
 *
 * Writes go through the real write path (`vault.process`), and each write is
 * followed by the scan Obsidian's `metadataCache.changed` would trigger, marked
 * local the way the plugin's own writes are, so completions fire flows. A
 * second `vaultSession` over the same `contents` is a reload: a new index, a
 * new ledger, new runtime IDs.
 */
export function vaultSession(contents: Map<string, string>) {
    let scanner: TaskScanner | undefined;
    const noop = { on: () => ({}), offref: () => { } };
    const vaultHandlers = new Map<string, (...args: unknown[]) => unknown>();
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
                if (next !== before) void scanner!.queueScan(file, true);
                return next;
            },
            getAbstractFileByPath: (path: string) => (contents.has(path) ? makeFile(path) : null),
            getMarkdownFiles: () => [...contents.keys()].map(makeFile),
        },
        metadataCache: { ...noop, getCache: () => null },
        workspace: { ...noop, onLayoutReady: () => { }, activeLeaf: null },
    };

    const index = new TaskIndex(app as never, { ...DEFAULT_SETTINGS });
    scanner = (index as unknown as { scanner: TaskScanner }).scanner;
    scanner.setInitializing(false);

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
        index,
        scanner,
        recorder: new TimerRecorder(app as never, plugin as never, storageUtils),
        creator: new TimerCreator({} as TimerContext, storageUtils),
        initialize: () => index.initialize(),
        fireVault: (name: string, ...args: unknown[]) => vaultHandlers.get(name)!(...args),
        scanAll: () => scanner!.scanVault(),
        settle: (path: string) => index.waitForScan(path),
        dispose: () => index.dispose(),
    };
}

export type VaultSession = ReturnType<typeof vaultSession>;
