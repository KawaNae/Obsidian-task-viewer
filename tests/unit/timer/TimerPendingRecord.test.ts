import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerPersistence } from '../../../src/timer/TimerPersistence';
import { TimerRenderer } from '../../../src/timer/TimerRenderer';
import { STORAGE_VERSION } from '../../../src/timer/TimerStorageUtils';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { TimerContentBinding } from '../../../src/timer/TimerContentBinding';
import type { CountupTimer, IntervalTimer, TimerInstance } from '../../../src/timer/TimerInstance';
import { t } from '../../../src/i18n';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * 止めたが記録していない走行は、明示的な状態（`pendingRecord`）として残る。
 *
 * 出口（⏸、■、interval の ■、interval の満了）は、止めて計測を固定し、保存して
 * から書く。書けたら押した出口の行き先へ進む。書けなければ何も戻さず、状態が
 * そのまま「記録待ち」を言う。再読み込みをまたいでも同じ時刻と長さで書き直す。
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
const keyFor = (version: number) => `task-viewer.active-timers.v${version}:vault-fp`;
const storageUtils = {
    deviceId: 'device-1',
    vaultFingerprint: 'vault-fp',
    getStorageKey: () => keyFor(STORAGE_VERSION),
    getStorageKeyForVersion: (v: number) => keyFor(v),
} as unknown as TimerStorageUtils;

/** 保存に在るタイマー（1 本だけ）。 */
function saved(): Record<string, unknown> | undefined {
    const raw = store.get(keyFor(STORAGE_VERSION));
    return raw ? (JSON.parse(raw) as { timers: Record<string, unknown>[] }).timers[0] : undefined;
}

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
    // interval の tick が走行中の行の end を見に行く。ここでは書き足さない。
    (s.recorder as unknown as { plugin: Record<string, unknown> }).plugin.getTaskReadService =
        () => ({ getDisplayTask: () => undefined });
    const creator = new TimerCreator(ctx);
    const lifecycle = new TimerLifecycle(ctx, creator);
    const persistence = new TimerPersistence(ctx, creator, lifecycle, storageUtils);
    const renderer = new TimerRenderer(ctx, lifecycle, creator, {} as TimerContentBinding);
    return { ctx, creator, lifecycle, persistence, renderer };
}

/** 操作列のボタンのラベル。 */
function controls(renderer: TimerRenderer, timer: TimerInstance): string[] {
    const labels: string[] = [];
    const make = (): unknown => ({
        createEl: () => make(),
        createSpan: (options?: { text?: string }) => {
            if (options?.text) labels.push(options.text);
            return make();
        },
    });
    (renderer as unknown as { renderControls(c: unknown, t: TimerInstance): void }).renderControls(make(), timer);
    return labels;
}

/** 次に呼ばれる `vault.process` を `count` 回だけ例外で落とす。落とす前に `seen` を呼ぶ。 */
function failNextWrites(s: VaultSession, count: number, seen?: () => void) {
    const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
    const real = vault.process;
    let left = count;
    vault.process = async (...a: unknown[]) => {
        seen?.();
        if (left > 0) { left--; throw new Error('disk full'); }
        return real(...a);
    };
}

/** 09:00 に child で始めた countup。 */
async function running(contents: Map<string, string>) {
    const s = vaultSession(contents);
    await s.scanAll();
    const target = s.index.getTasks().find(task => task.content === '対象')!;
    const p = pluginOver(s);
    const timer = s.creator.createTimer({
        taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
        timerType: 'countup', recordMode: 'child', autoStart: true,
    }) as CountupTimer;
    p.ctx.timers.set(timer.id, timer);
    expect(await s.recorder.writeStart(timer)).toBe(true);
    await s.settle(FILE);
    timer.startTimeMs = Date.now();
    return { s, timer, ...p };
}

/** 保存から戻す、次の plugin の読み込み。 */
async function reload(contents: Map<string, string>) {
    const s = vaultSession(contents);
    await s.scanAll();
    const p = pluginOver(s);
    p.persistence.restoreTimersFromStorage();
    return { s, ...p, timer: [...p.ctx.timers.values()][0] };
}

const notes = () => new Map([[FILE, ['- [ ] 対象 @2026-09-21', ''].join('\n')]]);
const recorded = (text: string) => [...text.matchAll(/- \[x\] .*@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);

describe('a record that could not be written is kept as a state, saved before the write', () => {
    beforeEach(() => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('⏸ that cannot be written: the record is fixed and saved before the write, and nothing moves on', async () => {
        const contents = notes();
        const { s, timer, lifecycle } = await running(contents);
        const before = contents.get(FILE)!;

        vi.setSystemTime(at(9, 10));
        let savedAtWrite: Record<string, unknown> | undefined;
        failNextWrites(s, 1, () => { savedAtWrite ??= saved(); });
        Notice.messages.length = 0;
        await lifecycle.suspendTimer(timer);

        const fixed = { endMs: at(9, 10).getTime(), seconds: 600, then: 'suspend' };
        // 書く前に固定して保存している。
        expect(savedAtWrite?.pendingRecord).toEqual(fixed);
        expect(timer.pendingRecord).toEqual(fixed);
        // 状態は進んでいない: 中断にも、記録済みにもならない。
        expect(timer.runState).toBe('running');
        expect(timer.isRunning).toBe(false);
        expect(timer.sessionCount).toBe(0);
        expect(timer.recordedElapsedTime).toBe(0);
        expect(saved()?.pendingRecord).toEqual(fixed);
        expect(Notice.messages).toHaveLength(1);
        expect(contents.get(FILE)).toBe(before);
        s.dispose();
    });

    it('after a reload, ■ writes the record fixed at 09:10, not at the time it is pressed', async () => {
        const contents = notes();
        const first = await running(contents);
        vi.setSystemTime(at(9, 10));
        failNextWrites(first.s, 1);
        await first.lifecycle.suspendTimer(first.timer);
        first.s.dispose();

        vi.setSystemTime(at(9, 40));
        const next = await reload(contents);
        const timer = next.timer as CountupTimer;
        expect(timer.pendingRecord).toEqual({ endMs: at(9, 10).getTime(), seconds: 600, then: 'suspend' });
        expect(timer.isRunning).toBe(false);
        expect(timer.elapsedTime).toBe(600);
        // 記録待ちの操作列は ⏸ と ■。
        expect(controls(next.renderer, timer)).toEqual([t('timer.suspend'), t('timer.finish')]);

        await next.lifecycle.finishTimer(timer);
        await next.s.settle(FILE);
        expect(recorded(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        expect(next.ctx.timers.has(timer.id)).toBe(false);
        next.s.dispose();
    });

    it('⏸ again after a failed ■ records with the same time and then suspends', async () => {
        const contents = notes();
        const { s, timer, lifecycle } = await running(contents);
        vi.setSystemTime(at(9, 10));
        failNextWrites(s, 1);
        await lifecycle.finishTimer(timer);
        expect(timer.pendingRecord?.then).toBe('close');

        vi.setSystemTime(at(9, 25));
        await lifecycle.suspendTimer(timer);
        await s.settle(FILE);
        expect(recorded(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        expect(timer.pendingRecord).toBeNull();
        expect(timer.runState).toBe('suspended');
        expect(timer.sessionCount).toBe(1);
        expect(timer.recordedElapsedTime).toBe(600);
        expect(saved()?.pendingRecord).toBeNull();
        s.dispose();
    });

    it('an interval whose end cannot be written waits with ■ alone, and ■ writes the end it reached', async () => {
        const contents = notes();
        const s = vaultSession(contents);
        await s.scanAll();
        const target = s.index.getTasks().find(task => task.content === '対象')!;
        const p = pluginOver(s);
        const timer = p.creator.createTimer({
            taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
            timerType: 'interval', recordMode: 'child', autoStart: true,
            intervalGroups: [{ repeatCount: 1, segments: [{ label: 'Work', durationSeconds: 600, type: 'work' }] }],
        }) as IntervalTimer;
        p.ctx.timers.set(timer.id, timer);
        expect(await s.recorder.writeStart(timer)).toBe(true);
        await s.settle(FILE);

        vi.setSystemTime(at(9, 10));
        failNextWrites(s, 1);
        (p.lifecycle as unknown as { tick(id: string): void }).tick(timer.id);
        await vi.waitFor(() => expect(timer.pendingRecord).not.toBeNull());
        await vi.waitFor(() => expect((p.lifecycle as unknown as { busy: Set<string> }).busy.size).toBe(0));
        expect(timer.pendingRecord).toEqual({ endMs: at(9, 10).getTime(), seconds: 600, then: 'close' });
        expect(p.ctx.timers.has(timer.id)).toBe(true);
        expect(controls(p.renderer, timer)).toEqual([t('timer.stop')]);

        vi.setSystemTime(at(9, 30));
        await p.lifecycle.stopIntervalTimer(timer);
        await s.settle(FILE);
        expect(recorded(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        expect(p.ctx.timers.has(timer.id)).toBe(false);
        s.dispose();
    });
});

describe('the saved state is read only at its own version', () => {
    beforeEach(() => store.clear());

    it('a v6 save is not read, and its key is dropped', async () => {
        store.set(keyFor(6), JSON.stringify({
            version: 6, ownerDeviceId: 'device-1', vaultFingerprint: 'vault-fp', updatedAtMs: 0,
            timers: [{
                id: 'timer-6', taskId: 'tv-inline:notes/a.md:ln:1', taskName: 'A', taskOriginalText: '- [ ] A',
                taskFile: FILE, startTimeMs: 0, pausedElapsedTime: 30, isRunning: false, isExpanded: true,
                timerType: 'countup', recordMode: 'child', parserId: 'tv-inline', elapsedTime: 30,
            }],
        }));
        const next = await reload(notes());
        expect(next.ctx.timers.size).toBe(0);
        expect(store.has(keyFor(6))).toBe(false);
        expect(STORAGE_VERSION).toBe(7);
        next.s.dispose();
    });

    it('a saved timer without pendingRecord is not read', async () => {
        const contents = notes();
        const first = await running(contents);
        first.persistence.persistTimersToStorage();
        const raw = JSON.parse(store.get(keyFor(STORAGE_VERSION))!) as { timers: Record<string, unknown>[] };
        delete raw.timers[0].pendingRecord;
        store.set(keyFor(STORAGE_VERSION), JSON.stringify(raw));
        first.s.dispose();

        const next = await reload(contents);
        expect(next.ctx.timers.size).toBe(0);
        next.s.dispose();
    });
});
