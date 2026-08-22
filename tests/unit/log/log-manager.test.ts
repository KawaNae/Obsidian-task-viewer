import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LogManager, type LogManagerDeps, AVG_ENTRY_BYTES } from '../../../src/log/log-manager';
import { clearLog, logInfo } from '../../../src/log/log';
import type { LogStorage } from '../../../src/log/log-storage';

/**
 * LogManager's own `onLogEntry` subscription goes through the global log.ts
 * buffer, so every test that calls logInfo() etc. must clear that buffer
 * first (beforeEach) and stop() the manager after (afterEach) — stop()
 * unsubscribes, so leaving it out leaks a listener into the next test.
 */

function makeFakeTimer() {
    let nextId = 1;
    const timeouts = new Map<number, () => void>();
    const intervals = new Map<number, () => void>();
    return {
        setTimeout: vi.fn((cb: () => void) => { const id = nextId++; timeouts.set(id, cb); return id; }),
        clearTimeout: vi.fn((id: number) => { timeouts.delete(id); }),
        setInterval: vi.fn((cb: () => void) => { const id = nextId++; intervals.set(id, cb); return id; }),
        clearInterval: vi.fn((id: number) => { intervals.delete(id); }),
        firePendingTimeouts() {
            const entries = [...timeouts];
            timeouts.clear();
            for (const [, cb] of entries) cb();
        },
        fireIntervals() {
            for (const cb of intervals.values()) cb();
        },
    };
}

function makeStorage() {
    return {
        bulkAppend: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue([]),
        deleteBefore: vi.fn().mockResolvedValue(0),
        trimToCount: vi.fn().mockResolvedValue(0),
        getStats: vi.fn().mockResolvedValue({ count: 0, oldestTs: null, newestTs: null, approxBytes: 0 }),
        clearAll: vi.fn().mockResolvedValue(undefined),
        deleteDatabase: vi.fn().mockResolvedValue(undefined),
    } as unknown as LogStorage;
}

function makeDeps(overrides: Partial<LogManagerDeps> = {}) {
    const timer = makeFakeTimer();
    const storage = makeStorage();
    const vaultExists = vi.fn().mockResolvedValue(false);
    const vaultCreateBinary = vi.fn().mockResolvedValue(undefined);
    const docListeners = new Map<string, () => void>();
    const winListeners = new Map<string, () => void>();
    const doc = {
        addEventListener: vi.fn((type: string, l: () => void) => docListeners.set(type, l)),
        removeEventListener: vi.fn((type: string) => docListeners.delete(type)),
        visibilityState: 'visible',
    };
    const win = {
        addEventListener: vi.fn((type: string, l: () => void) => winListeners.set(type, l)),
        removeEventListener: vi.fn((type: string) => winListeners.delete(type)),
    };
    const deps: LogManagerDeps = {
        storage,
        getSettings: () => ({ logRetentionDays: 30, logMaxStorageMB: 10 }),
        getPluginVersion: () => '0.53.0',
        getObsidianVersion: () => '1.12.0',
        getPlatform: () => ({ os: 'windows', isMobile: false }),
        getTaskDiagnostics: () => ({ taskCount: 0, activeViewCount: 0, enabledParsers: [], startHour: 4 }),
        vault: { exists: vaultExists, createBinary: vaultCreateBinary },
        now: () => Date.UTC(2026, 7, 22, 12, 0, 0),
        timer,
        doc,
        win,
        ...overrides,
    };
    return { deps, timer, storage, vaultExists, vaultCreateBinary, doc, win, docListeners, winListeners };
}

describe('LogManager', () => {
    let manager: LogManager | null = null;

    beforeEach(() => {
        clearLog();
    });

    afterEach(() => {
        manager?.stop();
        manager = null;
        vi.restoreAllMocks();
    });

    describe('flush batching', () => {
        it('debounces via timer.setTimeout rather than flushing immediately', async () => {
            const { deps, timer, storage } = makeDeps();
            manager = new LogManager(deps);
            manager.start();

            logInfo('one');
            expect(timer.setTimeout).toHaveBeenCalledTimes(1);
            expect(storage.bulkAppend).not.toHaveBeenCalled();

            timer.firePendingTimeouts();
            await vi.waitFor(() => expect(storage.bulkAppend).toHaveBeenCalledTimes(1));
            expect(storage.bulkAppend).toHaveBeenCalledWith([expect.objectContaining({ message: 'one' })]);
        });

        it('coalesces multiple pushes within the debounce window into one setTimeout', () => {
            const { deps, timer } = makeDeps();
            manager = new LogManager(deps);
            manager.start();

            logInfo('one');
            logInfo('two');
            logInfo('three');

            expect(timer.setTimeout).toHaveBeenCalledTimes(1); // second/third push found flushTimer already set
        });

        it('flushes immediately (microtask) once FLUSH_MAX_BATCH=100 entries are queued', async () => {
            const { deps, storage } = makeDeps();
            manager = new LogManager(deps);
            manager.start();

            for (let i = 0; i < 100; i++) logInfo(`e${i}`);

            await vi.waitFor(() => expect(storage.bulkAppend).toHaveBeenCalledTimes(1));
            const batch = (storage.bulkAppend as any).mock.calls[0][0];
            expect(batch).toHaveLength(100);
        });
    });

    describe('flush serialization', () => {
        it('does not double-append when flush() is awaited concurrently', async () => {
            const { deps, storage } = makeDeps();
            manager = new LogManager(deps);
            manager.start();
            logInfo('a');

            await Promise.all([manager.flush(), manager.flush()]);

            expect(storage.bulkAppend).toHaveBeenCalledTimes(1);
        });

        it('flush() is a no-op when the queue is empty', async () => {
            const { deps, storage } = makeDeps();
            manager = new LogManager(deps);
            manager.start();

            await manager.flush();

            expect(storage.bulkAppend).not.toHaveBeenCalled();
        });
    });

    describe('cleanup (runs once on start(), then on the cleanup interval)', () => {
        it('computes cutoff from retentionDays and calls storage.deleteBefore', async () => {
            const { deps, storage } = makeDeps({ getSettings: () => ({ logRetentionDays: 7, logMaxStorageMB: 10 }) });
            manager = new LogManager(deps);
            manager.start();

            const expectedCutoff = deps.now!() - 7 * 24 * 60 * 60 * 1000;
            await vi.waitFor(() => expect(storage.deleteBefore).toHaveBeenCalledWith(expectedCutoff));
        });

        it('clamps retentionDays to at least 1 day', async () => {
            const { deps, storage } = makeDeps({ getSettings: () => ({ logRetentionDays: 0, logMaxStorageMB: 10 }) });
            manager = new LogManager(deps);
            manager.start();

            const expectedCutoff = deps.now!() - 1 * 24 * 60 * 60 * 1000;
            await vi.waitFor(() => expect(storage.deleteBefore).toHaveBeenCalledWith(expectedCutoff));
        });

        it('skips trimToCount when logMaxStorageMB is 0 or less', async () => {
            const { deps, storage } = makeDeps({ getSettings: () => ({ logRetentionDays: 30, logMaxStorageMB: 0 }) });
            manager = new LogManager(deps);
            manager.start();

            await vi.waitFor(() => expect(storage.deleteBefore).toHaveBeenCalled());
            expect(storage.trimToCount).not.toHaveBeenCalled();
        });

        it('converts logMaxStorageMB into a max entry count using AVG_ENTRY_BYTES', async () => {
            const { deps, storage } = makeDeps({ getSettings: () => ({ logRetentionDays: 30, logMaxStorageMB: 1 }) });
            manager = new LogManager(deps);
            manager.start();

            const expectedMaxEntries = Math.max(1, Math.floor((1 * 1024 * 1024) / AVG_ENTRY_BYTES));
            await vi.waitFor(() => expect(storage.trimToCount).toHaveBeenCalledWith(expectedMaxEntries));
        });

        it('runs again on the cleanup interval, not just once on start', async () => {
            const { deps, timer, storage } = makeDeps();
            manager = new LogManager(deps);
            manager.start();
            await vi.waitFor(() => expect(storage.deleteBefore).toHaveBeenCalledTimes(1));

            timer.fireIntervals();

            await vi.waitFor(() => expect(storage.deleteBefore).toHaveBeenCalledTimes(2));
        });
    });

    describe('start/stop lifecycle', () => {
        it('a second start() is a no-op (does not double-subscribe or re-run cleanup)', async () => {
            const { deps, storage } = makeDeps();
            manager = new LogManager(deps);
            manager.start();
            await vi.waitFor(() => expect(storage.deleteBefore).toHaveBeenCalledTimes(1));

            manager.start();

            expect(storage.deleteBefore).toHaveBeenCalledTimes(1); // still 1, not re-triggered
        });

        it('stop() unsubscribes from log entries — pushes after stop are not enqueued', async () => {
            const { deps, storage } = makeDeps();
            manager = new LogManager(deps);
            manager.start();
            manager.stop();

            logInfo('after stop');
            await manager.flush();

            expect(storage.bulkAppend).not.toHaveBeenCalled();
        });

        it('stop() clears the cleanup and flush timers', () => {
            const { deps, timer } = makeDeps();
            manager = new LogManager(deps);
            manager.start();
            logInfo('pending'); // arms the flush timer

            manager.stop();

            expect(timer.clearInterval).toHaveBeenCalled();
            expect(timer.clearTimeout).toHaveBeenCalled();
        });

        it('stop() removes the doc/win event listeners it added in start()', () => {
            const { deps, doc, win } = makeDeps();
            manager = new LogManager(deps);
            manager.start();
            manager.stop();

            expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
            expect(win.removeEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
        });

        it('stop() flushes any queued entries before returning control', async () => {
            const { deps, storage } = makeDeps();
            manager = new LogManager(deps);
            manager.start();
            logInfo('flush me');

            manager.stop();

            await vi.waitFor(() => expect(storage.bulkAppend).toHaveBeenCalledWith(
                [expect.objectContaining({ message: 'flush me' })],
            ));
        });
    });

    describe('visibilitychange / pagehide flush triggers', () => {
        it('flushes when the document becomes hidden', async () => {
            const { deps, storage, doc, docListeners } = makeDeps();
            manager = new LogManager(deps);
            manager.start();
            logInfo('a');

            doc.visibilityState = 'hidden';
            docListeners.get('visibilitychange')?.();

            await vi.waitFor(() => expect(storage.bulkAppend).toHaveBeenCalled());
        });

        it('does not flush on visibilitychange when the document is not hidden', () => {
            const { deps, storage, docListeners } = makeDeps();
            manager = new LogManager(deps);
            manager.start();
            logInfo('a');

            docListeners.get('visibilitychange')?.(); // visibilityState stays 'visible'

            expect(storage.bulkAppend).not.toHaveBeenCalled();
        });

        it('flushes unconditionally on pagehide', async () => {
            const { deps, storage, winListeners } = makeDeps();
            manager = new LogManager(deps);
            manager.start();
            logInfo('a');

            winListeners.get('pagehide')?.();

            await vi.waitFor(() => expect(storage.bulkAppend).toHaveBeenCalled());
        });
    });

    describe('exportToVault', () => {
        it('flushes pending entries, reads storage, and writes a formatted file', async () => {
            const { deps, storage, vaultCreateBinary } = makeDeps();
            (storage.getAll as any).mockResolvedValue([{ timestamp: deps.now!(), level: 'info', message: 'hi' }]);
            manager = new LogManager(deps);
            manager.start();
            logInfo('pending');

            const result = await manager.exportToVault();

            expect(storage.bulkAppend).toHaveBeenCalled(); // pending entry flushed first
            expect(result.path).toBe('task_viewer_log_2026-08-22T12-00-00.md');
            expect(result.count).toBe(1);
            expect(vaultCreateBinary).toHaveBeenCalledTimes(1);
            const [path, bytes] = (vaultCreateBinary as any).mock.calls[0];
            expect(path).toBe('task_viewer_log_2026-08-22T12-00-00.md');
            const text = new TextDecoder().decode(bytes as ArrayBuffer);
            expect(text).toContain('[INFO] hi');
        });

        it('appends a numeric suffix when the target file name already exists', async () => {
            const { deps, vaultExists, vaultCreateBinary } = makeDeps();
            vaultExists.mockImplementation(async (path: string) =>
                path === 'task_viewer_log_2026-08-22T12-00-00.md' || path === 'task_viewer_log_2026-08-22T12-00-00_1.md');
            manager = new LogManager(deps);
            manager.start();

            const result = await manager.exportToVault();

            expect(result.path).toBe('task_viewer_log_2026-08-22T12-00-00_2.md');
            expect(vaultCreateBinary).toHaveBeenCalledWith('task_viewer_log_2026-08-22T12-00-00_2.md', expect.anything());
        });
    });

    describe('pass-through accessors', () => {
        it('getStats delegates to storage.getStats', async () => {
            const { deps, storage } = makeDeps();
            manager = new LogManager(deps);
            await manager.getStats();
            expect(storage.getStats).toHaveBeenCalledTimes(1);
        });

        it('clearStoredLogs delegates to storage.clearAll', async () => {
            const { deps, storage } = makeDeps();
            manager = new LogManager(deps);
            await manager.clearStoredLogs();
            expect(storage.clearAll).toHaveBeenCalledTimes(1);
        });

        it('deleteLogDatabase delegates to storage.deleteDatabase', async () => {
            const { deps, storage } = makeDeps();
            manager = new LogManager(deps);
            await manager.deleteLogDatabase();
            expect(storage.deleteDatabase).toHaveBeenCalledTimes(1);
        });
    });
});
