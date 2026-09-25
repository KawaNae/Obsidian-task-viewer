import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerPersistence } from '../../../src/timer/TimerPersistence';
import { STORAGE_VERSION } from '../../../src/timer/TimerStorageUtils';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { CountupTimer, TimerInstance } from '../../../src/timer/TimerInstance';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * 1 本目の行と再開の行は、書く前に「これから書く錨」（`opening`）を保存し、
 * 書けたら尻尾へ移す。再開は書けてから走行に移り、開始時刻は押した時刻。
 * 往復の間は中断のまま。書く途中で再読み込みされたら、保存の `opening` を錨で
 * 引き、行が在れば尻尾にする — 推定でなく、ファイルに在る `^id` で答える。
 */
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
    localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    },
};

const FILE = 'notes/a.md';
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);
const KEY = `task-viewer.active-timers.v${STORAGE_VERSION}:vault-fp`;
const storageUtils = {
    deviceId: 'device-1',
    vaultFingerprint: 'vault-fp',
    getStorageKey: () => KEY,
    getStorageKeyForVersion: (v: number) => `task-viewer.active-timers.v${v}:vault-fp`,
    isAutoManagedTimerTargetId: () => true,
} as unknown as TimerStorageUtils;

function saved(): Record<string, unknown> | undefined {
    const raw = store.get(KEY);
    return raw ? (JSON.parse(raw) as { timers: Record<string, unknown>[] }).timers.find(t => t.taskId !== '__idle__') : undefined;
}

function pluginOver(s: VaultSession) {
    const changed: (() => void)[] = [];
    const ctx = {
        timers: new Map<string, TimerInstance>(), recorder: s.recorder,
        plugin: {
            settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 },
            getTaskReadService: () => ({ onChange: (fn: () => void) => { changed.push(fn); return () => { }; } }),
        },
        app: s.app,
        startTimer: () => { }, render: () => { }, renderTimerItem: () => { },
        persistTimersToStorage: () => persistence.persistTimersToStorage(),
        onTimerClosed: () => { }, discardTimerContent: () => { },
        flushTimerContent: async () => true,
        ensureContainer: () => ({}) as HTMLElement, destroyContainer: () => { },
        getPinState: () => 'pinned' as const, togglePin: () => { }, shouldShowPinBadge: () => false,
    } as unknown as TimerContext;
    const creator = new TimerCreator(ctx, storageUtils);
    const lifecycle = new TimerLifecycle(ctx, creator);
    const persistence = new TimerPersistence(ctx, creator, lifecycle, storageUtils);
    s.onPersist(() => persistence.persistTimersToStorage());
    return { ctx, lifecycle, persistence, changed: () => changed.forEach(fn => fn()) };
}

/** `vault.process` が呼ばれるたびに、書く前の姿を `seen` に渡す。 */
function watchWrites(s: VaultSession, seen: () => void) {
    const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
    const real = vault.process;
    vault.process = async (...a: unknown[]) => {
        seen();
        return real(...a);
    };
}

async function started(contents: Map<string, string>) {
    const s = vaultSession(contents);
    await s.scanAll();
    const p = pluginOver(s);
    const target = s.index.getTasks().find(task => task.content === '対象')!;
    const timer = s.creator.createTimer({
        taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
        timerType: 'countup', recordMode: 'child', autoStart: true,
    }) as CountupTimer;
    p.ctx.timers.set(timer.id, timer);
    return { s, timer, ...p };
}

const notes = () => new Map([[FILE, ['- [ ] 対象 @2026-09-21', ''].join('\n')]]);
const busyOf = (lifecycle: TimerLifecycle) => (lifecycle as unknown as { busy: Set<string> }).busy;

describe('the line a timer is about to write is saved as its opening, and becomes the tail once written', () => {
    beforeEach(() => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('the first line: the opening is saved before the write, and is the tail after it', async () => {
        const contents = notes();
        const { s, timer } = await started(contents);
        let atWrite: Record<string, unknown> | undefined;
        watchWrites(s, () => { atWrite ??= saved(); });

        expect(await s.recorder.writeStart(timer)).toBe(true);
        await s.settle(FILE);

        expect(typeof atWrite?.opening).toBe('string');
        expect(atWrite?.tailRecordBlockId).toBeUndefined();
        expect(timer.tailRecordBlockId).toBe(atWrite?.opening);
        expect(timer.opening).toBeNull();
        expect(contents.get(FILE)).toContain(`^${timer.tailRecordBlockId}`);
        s.dispose();
    });

    it('▶ stays suspended while the line is written, then runs from the time it was pressed', async () => {
        const contents = notes();
        const { s, timer, lifecycle } = await started(contents);
        expect(await s.recorder.writeStart(timer)).toBe(true);
        await s.settle(FILE);
        timer.startTimeMs = Date.now();
        vi.setSystemTime(at(9, 10));
        await lifecycle.suspendTimer(timer);
        await s.settle(FILE);
        const firstTail = timer.tailRecordBlockId;

        vi.setSystemTime(at(9, 20));
        let atWrite: { saved?: Record<string, unknown>; runState: string; isRunning: boolean } | undefined;
        watchWrites(s, () => { atWrite ??= { saved: saved(), runState: timer.runState, isRunning: timer.isRunning }; });
        lifecycle.resumeSession(timer);
        // 往復の間は中断のまま。
        expect(timer.runState).toBe('suspended');
        expect(timer.isRunning).toBe(false);
        vi.setSystemTime(at(9, 21));
        await vi.waitFor(() => expect(busyOf(lifecycle).has(timer.id)).toBe(false));
        await s.settle(FILE);

        expect(atWrite?.runState).toBe('suspended');
        expect(atWrite?.isRunning).toBe(false);
        expect(atWrite?.saved?.runState).toBe('suspended');
        const opening = atWrite?.saved?.opening;
        expect(typeof opening).toBe('string');
        expect(opening).not.toBe(firstTail);

        expect(timer.runState).toBe('running');
        expect(timer.isRunning).toBe(true);
        expect(timer.startTimeMs).toBe(at(9, 20).getTime());
        expect(timer.tailRecordBlockId).toBe(opening);
        expect(timer.opening).toBeNull();
        expect(saved()?.opening).toBeNull();
        expect(saved()?.runState).toBe('running');
        s.dispose();
    });

    it('a reload between the write and the state: the saved opening is found by its ^id and becomes the tail', async () => {
        const contents = notes();
        const first = await started(contents);
        let atWrite: string | undefined;
        watchWrites(first.s, () => { atWrite ??= store.get(KEY); });
        expect(await first.s.recorder.writeStart(first.timer)).toBe(true);
        await first.s.settle(FILE);
        first.s.dispose();
        // 行は書けたが、書けたあとの保存の前に落ちた。
        store.set(KEY, atWrite!);
        const opening = (JSON.parse(atWrite!) as { timers: { opening: string }[] }).timers[0].opening;
        expect(contents.get(FILE)).toContain(`^${opening}`);

        const s = vaultSession(contents);
        await s.scanAll();
        const p = pluginOver(s);
        p.persistence.restoreTimersFromStorage();
        const timer = [...p.ctx.timers.values()].find(t => t.taskId !== '__idle__')!;
        expect(timer.opening).toBe(opening);
        expect(timer.tailRecordBlockId).toBeUndefined();

        p.changed();
        await vi.waitFor(() => expect(timer.tailRecordBlockId).toBe(opening));
        expect(timer.opening).toBeNull();
        expect(saved()?.tailRecordBlockId).toBe(opening);
        expect(saved()?.opening).toBeNull();
        s.dispose();
    });
});

describe('a restored timer whose target cannot be found is kept, not closed', () => {
    beforeEach(() => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('the target row is gone after a reload: the widget stays, and ■ still closes the running line', async () => {
        const contents = notes();
        const first = await started(contents);
        expect(await first.s.recorder.writeStart(first.timer)).toBe(true);
        await first.s.settle(FILE);
        first.timer.startTimeMs = Date.now();
        first.persistence.persistTimersToStorage();
        first.s.dispose();
        // 外で対象の行が消された（走行中の行は残り、字下げが外れる）。
        contents.set(FILE, contents.get(FILE)!.split('\n').slice(1).map(l => l.trimStart()).join('\n'));

        const s = vaultSession(contents);
        await s.scanAll();
        const p = pluginOver(s);
        p.persistence.restoreTimersFromStorage();
        const timer = [...p.ctx.timers.values()].find(t => t.taskId !== '__idle__')!;
        p.changed();
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
        expect(p.ctx.timers.has(timer.id)).toBe(true);

        vi.setSystemTime(at(9, 10));
        await p.lifecycle.finishTimer(timer);
        await s.settle(FILE);
        expect(contents.get(FILE)).toMatch(/- \[x\] .*@2026-09-21T09:00>09:10/);
        expect(p.ctx.timers.has(timer.id)).toBe(false);
        s.dispose();
    });
});
