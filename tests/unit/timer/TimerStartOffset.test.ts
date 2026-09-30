import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerPersistence } from '../../../src/timer/TimerPersistence';
import { STORAGE_VERSION } from '../../../src/timer/TimerStorageUtils';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { CountdownTimer, CountupTimer, TimerInstance, TimerRecordMode } from '../../../src/timer/TimerInstance';
import { canOffsetStart, parseOffsetInput, rememberedStart, startLabel } from '../../../src/timer/TimerStartOffset';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * 走っている区間の開始をずらす（かけ忘れたタイマーを、実際に始めた時刻から数える）。
 *
 * ずらした時点で走行の行の start を書き直し、書けてから `startTimeMs` を動かす。
 * 規則は mode で分けないので、self の 1 本目、child、sibling、⏸→▶ のあとの区間の
 * どれでも、止めたときの記録の start がずらした時刻になる。
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
const DAY = '2026-09-30';
const at = (h: number, m: number, day = 30) => new Date(2026, 8, day, h, m, 0);
const keyFor = (version: number) => `task-viewer.active-timers.v${version}:vault-fp`;
const storageUtils = {
    deviceId: 'device-1',
    vaultFingerprint: 'vault-fp',
    getStorageKey: () => keyFor(STORAGE_VERSION),
    getStorageKeyForVersion: (v: number) => keyFor(v),
} as unknown as TimerStorageUtils;

/** 1 回の plugin の読み込み: 索引、recorder、lifecycle、保存。 */
function pluginOver(s: VaultSession) {
    const ctx = {
        timers: new Map<string, TimerInstance>(), recorder: s.recorder,
        plugin: {
            settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 },
            getTaskReadService: () => ({ onChange: () => () => { } }),
        },
        app: s.app,
        startTimer: () => { }, render: () => { }, renderTimerItem: () => { },
        persistTimersToStorage: () => persistence.persistTimersToStorage(),
        onTimerClosed: () => { }, discardTimerContent: () => { },
        flushTimerContent: async () => true,
        ensureContainer: () => ({}) as HTMLElement, destroyContainer: () => { },
        getPinState: () => 'pinned' as const, togglePin: () => { }, shouldShowPinBadge: () => false,
    } as unknown as TimerContext;
    s.onOpenTimers(() => ctx.timers.values());
    s.onPersist(() => persistence.persistTimersToStorage());
    const creator = new TimerCreator(ctx);
    const lifecycle = new TimerLifecycle(ctx, creator);
    const persistence = new TimerPersistence(ctx, creator, lifecycle, storageUtils);
    return { ctx, lifecycle, persistence };
}

async function settleAll(s: VaultSession) {
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
    }
}

/** 次に呼ばれる `vault.process` を 1 回だけ例外で落とす。 */
function failNextWrite(s: VaultSession) {
    const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
    const real = vault.process;
    let left = 1;
    vault.process = async (...a: unknown[]) => {
        if (left > 0) { left--; throw new Error('disk full'); }
        return real(...a);
    };
}

/** 保存に在るタイマー（1 本だけ）。 */
function saved(): Record<string, unknown> | undefined {
    const raw = store.get(keyFor(STORAGE_VERSION));
    return raw ? (JSON.parse(raw) as { timers: Record<string, unknown>[] }).timers[0] : undefined;
}

const busyOf = (lifecycle: TimerLifecycle) => (lifecycle as unknown as { busy: Set<string> }).busy;
const lines = (contents: Map<string, string>) => contents.get(FILE)!.split('\n').filter(l => l.trim() !== '');
/** 完了した記録の `start>end`（日付つき）。 */
const records = (contents: Map<string, string>) =>
    lines(contents).map(l => /^\s*- \[x\] .*@(\S+>\S+)/.exec(l)?.[1]).filter(Boolean);

/** `name` の行で、今 `recordMode` の countup か countdown を始める。 */
async function started(
    note: string[],
    name: string,
    recordMode: TimerRecordMode,
    timerType: 'countup' | 'countdown' = 'countup',
) {
    const contents = new Map([[FILE, [...note, ''].join('\n')]]);
    const s = vaultSession(contents);
    await s.scanAll();
    const p = pluginOver(s);
    const target = s.index.getTasks().find(t => t.content === name)!;
    const timer = s.creator.createTimer({
        taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
        timerType, recordMode, autoStart: true, countdownSeconds: 25 * 60,
    }) as CountupTimer | CountdownTimer;
    p.ctx.timers.set(timer.id, timer);
    expect(await s.recorder.writeStart(timer)).toBe(true);
    await settleAll(s);
    return { contents, s, timer, ...p };
}

describe('shifting the start of a running timer writes the running line, then moves the timer', () => {
    beforeEach(() => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(10, 20));
    });
    afterEach(() => vi.useRealTimers());

    it('self: the start overwritten at the start is remembered, and shifting to it records from it', async () => {
        const { contents, s, timer, lifecycle } = await started([`- [ ] 設計 @${DAY}T10:00>11:00`], '設計', 'self');
        expect(timer.priorStartMs).toBe(at(10, 0).getTime());
        expect(lines(contents)[0]).toContain(`@${DAY}T10:20>11:20`);

        vi.setSystemTime(at(10, 25));
        expect(rememberedStart(timer, Date.now())).toBe(at(10, 0).getTime());
        await lifecycle.offsetStart(timer, at(10, 0).getTime());
        await settleAll(s);
        // 走っている間の行も、ずらした start を示す。
        expect(lines(contents)[0]).toContain(`@${DAY}T10:00>11:20`);
        expect(timer.startTimeMs).toBe(at(10, 0).getTime());
        expect(timer.elapsedTime).toBe(25 * 60);

        vi.setSystemTime(at(10, 50));
        await lifecycle.finishTimer(timer);
        await settleAll(s);
        expect(records(contents)).toEqual([`${DAY}T10:00>10:50`]);
        s.dispose();
    });

    it('child: the line written at the start is shifted, and the record keeps the shifted start', async () => {
        const { contents, s, timer, lifecycle } = await started([`- [ ] 対象 @${DAY}`], '対象', 'child');
        expect(timer.priorStartMs).toBeNull();

        vi.setSystemTime(at(10, 25));
        await lifecycle.offsetStart(timer, Date.now() - 15 * 60_000);
        await settleAll(s);
        expect(lines(contents)[1]).toMatch(new RegExp(`@${DAY}T10:10 \\^`));

        vi.setSystemTime(at(10, 40));
        await lifecycle.finishTimer(timer);
        await settleAll(s);
        expect(records(contents)).toEqual([`${DAY}T10:10>10:40`]);
        s.dispose();
    });

    it('sibling: the line added next to the completed run is shifted', async () => {
        const { contents, s, timer, lifecycle } = await started(
            [`- [x] ⏱️ 対象 @${DAY}T09:00>09:30`], '⏱️ 対象', 'sibling');
        expect(timer.priorStartMs).toBeNull();

        vi.setSystemTime(at(10, 22));
        await lifecycle.offsetStart(timer, at(10, 5).getTime());
        await settleAll(s);

        vi.setSystemTime(at(10, 45));
        await lifecycle.finishTimer(timer);
        await settleAll(s);
        expect(records(contents)).toEqual([`${DAY}T09:00>09:30`, `${DAY}T10:05>10:45`]);
        s.dispose();
    });

    it('after ⏸ and ▶: only the running session moves, and the remembered start is not offered', async () => {
        const { contents, s, timer, lifecycle } = await started([`- [ ] 設計 @${DAY}T10:00>11:00`], '設計', 'self');

        vi.setSystemTime(at(10, 50));
        await lifecycle.suspendTimer(timer);
        await settleAll(s);
        vi.setSystemTime(at(11, 10));
        lifecycle.resumeSession(timer);
        await vi.waitFor(() => expect(busyOf(lifecycle).has(timer.id)).toBe(false));
        await settleAll(s);
        expect(timer.runState).toBe('running');
        expect(rememberedStart(timer, Date.now())).toBeNull();

        // ▶ の押し忘れ: 前の区間の end より前へもずらせる（下限を置かない）。
        vi.setSystemTime(at(11, 12));
        await lifecycle.offsetStart(timer, at(10, 45).getTime());
        await settleAll(s);

        vi.setSystemTime(at(11, 30));
        await lifecycle.finishTimer(timer);
        await settleAll(s);
        expect(records(contents)).toEqual([`${DAY}T10:20>10:50`, `${DAY}T10:45>11:30`]);
        s.dispose();
    });

    it('a time later than now is read as the day before, and the line keeps its end date', async () => {
        vi.setSystemTime(at(0, 10));
        const { contents, s, timer, lifecycle } = await started([`- [ ] 夜 @${DAY}T00:00>01:00`], '夜', 'self');
        expect(lines(contents)[0]).toContain(`@${DAY}T00:10>01:10`);

        vi.setSystemTime(at(0, 15));
        const startMs = parseOffsetInput('23:50', Date.now());
        expect(startMs).toBe(at(23, 50, 29).getTime());
        await lifecycle.offsetStart(timer, startMs!);
        await settleAll(s);
        expect(lines(contents)[0]).toContain(`@2026-09-29T23:50>${DAY}T01:10`);
        expect(timer.elapsedTime).toBe(25 * 60);

        vi.setSystemTime(at(0, 30));
        await lifecycle.finishTimer(timer);
        await settleAll(s);
        expect(records(contents)).toEqual([`2026-09-29T23:50>${DAY}T00:30`]);
        s.dispose();
    });

    it('countdown: the time left shrinks by the shift', async () => {
        const { s, timer, lifecycle } = await started([`- [ ] 対象 @${DAY}`], '対象', 'child', 'countdown');
        const countdown = timer as CountdownTimer;

        vi.setSystemTime(at(10, 21));
        await lifecycle.offsetStart(timer, Date.now() - 10 * 60_000);
        expect(countdown.elapsedTime).toBe(10 * 60);
        expect(countdown.timeRemaining).toBe(15 * 60);
        expect(countdown.phase).toBe('work');

        await lifecycle.offsetStart(timer, Date.now() - 30 * 60_000);
        expect(countdown.timeRemaining).toBe(-5 * 60);
        expect(countdown.phase).toBe('idle');
        s.dispose();
    });

    it('a shift whose line cannot be written moves nothing', async () => {
        const { contents, s, timer, lifecycle } = await started([`- [ ] 対象 @${DAY}`], '対象', 'child');
        const before = contents.get(FILE);
        const startTimeMs = timer.startTimeMs;

        vi.setSystemTime(at(10, 25));
        failNextWrite(s);
        await lifecycle.offsetStart(timer, at(10, 0).getTime());
        await settleAll(s);
        expect(contents.get(FILE)).toBe(before);
        expect(timer.startTimeMs).toBe(startTimeMs);
        s.dispose();
    });

    it('a start in the future, or on a suspended timer, is not taken', async () => {
        const { contents, s, timer, lifecycle } = await started([`- [ ] 対象 @${DAY}`], '対象', 'child');
        const before = contents.get(FILE);
        const startTimeMs = timer.startTimeMs;

        await lifecycle.offsetStart(timer, at(10, 21).getTime());
        expect(timer.startTimeMs).toBe(startTimeMs);

        vi.setSystemTime(at(10, 30));
        await lifecycle.suspendTimer(timer);
        await settleAll(s);
        const suspended = contents.get(FILE);
        expect(suspended).not.toBe(before);
        await lifecycle.offsetStart(timer, at(10, 0).getTime());
        await settleAll(s);
        expect(contents.get(FILE)).toBe(suspended);
        s.dispose();
    });
});

describe('the remembered start is saved with the timer', () => {
    beforeEach(() => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(10, 20));
    });
    afterEach(() => vi.useRealTimers());

    it('it is saved before the start is written, and read back after a reload', async () => {
        const contents = new Map([[FILE, [`- [ ] 設計 @${DAY}T10:00>11:00`, ''].join('\n')]]);
        const s = vaultSession(contents);
        await s.scanAll();
        const p0 = pluginOver(s);
        const target = s.index.getTasks().find(t => t.content === '設計')!;
        const first = s.creator.createTimer({
            taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
            timerType: 'countup', recordMode: 'self', autoStart: true,
        });
        p0.ctx.timers.set(first.id, first);
        const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
        const real = vault.process;
        let savedAtWrite: Record<string, unknown> | undefined;
        vault.process = async (...a: unknown[]) => { savedAtWrite ??= saved(); return real(...a); };
        expect(await s.recorder.writeStart(first)).toBe(true);
        await settleAll(s);
        expect(savedAtWrite?.priorStartMs).toBe(at(10, 0).getTime());
        p0.persistence.persistTimersToStorage();
        s.dispose();

        const next = vaultSession(contents);
        await next.scanAll();
        const p = pluginOver(next);
        p.persistence.restoreTimersFromStorage();
        const timer = [...p.ctx.timers.values()][0];
        expect(timer.priorStartMs).toBe(at(10, 0).getTime());
        next.dispose();
    });

    it('a v7 save is not read, and a save without priorStartMs is not read', async () => {
        const { s, persistence } = await started([`- [ ] 対象 @${DAY}`], '対象', 'child');
        persistence.persistTimersToStorage();
        const raw = JSON.parse(store.get(keyFor(STORAGE_VERSION))!) as { version: number; timers: Record<string, unknown>[] };
        s.dispose();

        store.clear();
        store.set(keyFor(7), JSON.stringify({ ...raw, version: 7 }));
        const v7 = pluginOver(vaultSession(new Map()));
        v7.persistence.restoreTimersFromStorage();
        expect(v7.ctx.timers.size).toBe(0);
        expect(store.has(keyFor(7))).toBe(false);

        delete raw.timers[0].priorStartMs;
        store.set(keyFor(STORAGE_VERSION), JSON.stringify(raw));
        const missing = pluginOver(vaultSession(new Map()));
        missing.persistence.restoreTimersFromStorage();
        expect(missing.ctx.timers.size).toBe(0);
    });
});

describe('where a shift goes (TimerStartOffset)', () => {
    const now = at(10, 20).getTime();

    it('a number is minutes back from now', () => {
        expect(parseOffsetInput('20', now)).toBe(at(10, 0).getTime());
        expect(parseOffsetInput(' ２０ ', now)).toBe(at(10, 0).getTime());
        expect(parseOffsetInput('0', now)).toBeNull();
    });

    it('HH:MM is that time today, or the day before when it is later than now', () => {
        expect(parseOffsetInput('9:40', now)).toBe(at(9, 40).getTime());
        expect(parseOffsetInput('１０：１５', now)).toBe(at(10, 15).getTime());
        expect(parseOffsetInput('10:30', now)).toBe(at(10, 30, 29).getTime());
        expect(parseOffsetInput('24:00', now)).toBeNull();
        expect(parseOffsetInput('9:4', now)).toBeNull();
        expect(parseOffsetInput('-5', now)).toBeNull();
        expect(parseOffsetInput('', now)).toBeNull();
    });

    it('the remembered start is offered in the first session only, and only when it is past', () => {
        const timer = { sessionCount: 0, priorStartMs: at(10, 0).getTime() } as TimerInstance;
        expect(rememberedStart(timer, now)).toBe(at(10, 0).getTime());
        expect(rememberedStart({ ...timer, sessionCount: 1 } as TimerInstance, now)).toBeNull();
        expect(rememberedStart({ ...timer, priorStartMs: at(10, 30).getTime() } as TimerInstance, now)).toBeNull();
        expect(rememberedStart({ ...timer, priorStartMs: null } as TimerInstance, now)).toBeNull();
    });

    it('only a running countup or countdown can be shifted', () => {
        const running = { timerType: 'countup', runState: 'running', isRunning: true, pendingRecord: null } as TimerInstance;
        expect(canOffsetStart(running)).toBe(true);
        expect(canOffsetStart({ ...running, timerType: 'countdown' } as TimerInstance)).toBe(true);
        expect(canOffsetStart({ ...running, timerType: 'interval' } as TimerInstance)).toBe(false);
        expect(canOffsetStart({ ...running, timerType: 'idle' } as TimerInstance)).toBe(false);
        expect(canOffsetStart({ ...running, runState: 'suspended', isRunning: false } as TimerInstance)).toBe(false);
        expect(canOffsetStart({ ...running, isRunning: false } as TimerInstance)).toBe(false);
        expect(canOffsetStart({ ...running, pendingRecord: { endMs: now, seconds: 1, then: 'close' } } as TimerInstance)).toBe(false);
    });

    it('a start on another day is labelled with its date', () => {
        expect(startLabel(at(9, 5).getTime(), now)).toBe('09:05');
        expect(startLabel(at(23, 50, 29).getTime(), now)).toBe('2026-09-29 23:50');
    });
});
