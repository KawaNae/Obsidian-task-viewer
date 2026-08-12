import { describe, expect, it, beforeEach } from 'vitest';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerPersistence } from '../../../src/timer/TimerPersistence';
import { STORAGE_VERSION } from '../../../src/timer/TimerStorageUtils';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import { IDLE_TIMER_ID, type TimerContext } from '../../../src/timer/TimerContext';
import type { CountupTimer, TimerInstance } from '../../../src/timer/TimerInstance';

/**
 * セッション状態（runState / sessionCount / recordedElapsedTime）の永続化と
 * 復元。中断中のタイマーは「記録済み・再開待ち」なので、閉じていた間の時間を
 * 経過に積んではならないし ticker も回してはならない。
 */

const store = new Map<string, string>();
const intervals: number[] = [];
(globalThis as unknown as { window: unknown }).window = {
    localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    },
    setInterval: () => { intervals.push(intervals.length + 1); return intervals.length; },
    clearInterval: () => { /* unused */ },
};

const VAULT = 'vault-fp';
const DEVICE = 'device-1';
const KEY_PREFIX = 'task-viewer.active-timers';
const keyFor = (version: number) => `${KEY_PREFIX}.v${version}:${VAULT}`;

const storageUtils = {
    deviceId: DEVICE,
    vaultFingerprint: VAULT,
    getStorageKey: () => keyFor(STORAGE_VERSION),
    getStorageKeyForVersion: (v: number) => keyFor(v),
    isAutoManagedTimerTargetId: () => false,
} as unknown as TimerStorageUtils;

function makeCtx(): TimerContext {
    const ctx = {
        timers: new Map<string, TimerInstance>(),
        intervalPrepareBaseElapsed: new Map<string, number>(),
        recorder: {} as TimerContext['recorder'],
        plugin: {
            settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 },
            // アンカー検証は最初の onChange を合図にする。テストでは通知を出さない
            // ＝ 検証は走らない（保守的側の挙動そのもの）。
            getTaskReadService: () => ({ onChange: () => () => { /* noop */ } }),
        } as unknown as TimerContext['plugin'],
        app: {} as TimerContext['app'],
        startTimer: () => { /* unused */ },
        render: () => { /* unused */ },
        renderTimerItem: () => { /* unused */ },
        persistTimersToStorage: () => { /* replaced below */ },
        onTimerClosed: () => { /* unused */ },
        ensureContainer: () => ({}) as HTMLElement,
        destroyContainer: () => { /* unused */ },
        getPinState: () => 'pinned' as const,
        togglePin: () => { /* unused */ },
        shouldShowPinBadge: () => false,
    };
    return ctx;
}

function build() {
    const ctx = makeCtx();
    const creator = new TimerCreator(ctx, storageUtils);
    const lifecycle = new TimerLifecycle(ctx, creator);
    const persistence = new TimerPersistence(ctx, creator, lifecycle, storageUtils);
    return { ctx, creator, lifecycle, persistence };
}

function makeCountup(overrides: Partial<CountupTimer> = {}): CountupTimer {
    return {
        id: 'timer-1',
        taskId: 'tv-inline:notes/a.md:ln:3',
        taskName: 'A',
        taskOriginalText: '- [ ] A',
        taskFile: 'notes/a.md',
        startTimeMs: Date.now() - 60_000,
        pausedElapsedTime: 0,
        phase: 'work',
        isRunning: true,
        runState: 'running',
        sessionCount: 0,
        recordedElapsedTime: 0,
        isExpanded: true,
        intervalId: null,
        customLabel: '',
        recordMode: 'child',
        parserId: 'tv-inline',
        taskColor: '',
        timerType: 'countup',
        elapsedTime: 60,
        ...overrides,
    };
}

describe('session state persistence', () => {
    beforeEach(() => { store.clear(); intervals.length = 0; });

    it('writes the current storage version', () => {
        const { ctx, persistence } = build();
        ctx.timers.set('timer-1', makeCountup());
        persistence.persistTimersToStorage();

        const payload = JSON.parse(store.get(keyFor(STORAGE_VERSION))!);
        expect(payload.version).toBe(STORAGE_VERSION);
        expect(STORAGE_VERSION).toBe(6);
    });

    it('round-trips runState, sessionCount and recordedElapsedTime', () => {
        const a = build();
        a.ctx.timers.set('timer-1', makeCountup({
            runState: 'suspended', isRunning: false, sessionCount: 2, recordedElapsedTime: 930,
        }));
        a.persistence.persistTimersToStorage();

        const b = build();
        b.persistence.restoreTimersFromStorage();
        const restored = b.ctx.timers.get('timer-1')!;

        expect(restored.runState).toBe('suspended');
        expect(restored.sessionCount).toBe(2);
        expect(restored.recordedElapsedTime).toBe(930);
    });

    it('does not accumulate elapsed time or start a ticker for a suspended timer', () => {
        const a = build();
        a.ctx.timers.set('timer-1', makeCountup({
            runState: 'suspended',
            isRunning: false,
            recordedElapsedTime: 300,
            // 「閉じていた間」を表す古い開始時刻。積まれてはならない。
            startTimeMs: Date.now() - 3_600_000,
            pausedElapsedTime: 42,
            elapsedTime: 42,
        }));
        a.persistence.persistTimersToStorage();

        const b = build();
        b.persistence.restoreTimersFromStorage();
        const restored = b.ctx.timers.get('timer-1') as CountupTimer;

        expect(restored.isRunning).toBe(false);
        expect(restored.startTimeMs).toBe(0);
        expect(restored.pausedElapsedTime).toBe(0);
        expect(restored.elapsedTime).toBe(0);
        expect(restored.recordedElapsedTime).toBe(300);
        expect(intervals).toHaveLength(0);
    });

    it('still resumes a running timer across a restart', () => {
        const a = build();
        a.ctx.timers.set('timer-1', makeCountup({ startTimeMs: Date.now() - 120_000 }));
        a.persistence.persistTimersToStorage();

        const b = build();
        b.persistence.restoreTimersFromStorage();
        const restored = b.ctx.timers.get('timer-1') as CountupTimer;

        expect(restored.runState).toBe('running');
        expect(restored.isRunning).toBe(true);
        expect(restored.elapsedTime).toBeGreaterThanOrEqual(120);
        expect(intervals).toHaveLength(1);
    });

    it('defaults missing session fields when reading older payloads', () => {
        const legacy = {
            version: STORAGE_VERSION,
            ownerDeviceId: DEVICE,
            vaultFingerprint: VAULT,
            updatedAtMs: Date.now(),
            timers: [{
                id: 'timer-9',
                taskId: 'tv-inline:notes/a.md:ln:3',
                taskName: 'A',
                taskOriginalText: '- [ ] A',
                taskFile: 'notes/a.md',
                startTimeMs: 0,
                pausedElapsedTime: 30,
                isRunning: false,
                isExpanded: true,
                customLabel: '',
                timerType: 'countup',
                recordMode: 'child',
                parserId: 'tv-inline',
                elapsedTime: 30,
            }],
        };
        store.set(keyFor(STORAGE_VERSION), JSON.stringify(legacy));

        const b = build();
        b.persistence.restoreTimersFromStorage();
        const restored = b.ctx.timers.get('timer-9')!;

        expect(restored.runState).toBe('running');
        expect(restored.sessionCount).toBe(0);
        expect(restored.recordedElapsedTime).toBe(0);
    });

    it('drops the obsolete v5 key on restore', () => {
        store.set(keyFor(5), '{"version":5}');
        const b = build();
        b.persistence.restoreTimersFromStorage();
        expect(store.has(keyFor(5))).toBe(false);
    });

    it('holds the invariant: suspended implies the ticker is stopped', () => {
        const a = build();
        a.ctx.timers.set('timer-1', makeCountup({ runState: 'suspended', isRunning: true }));
        a.persistence.persistTimersToStorage();

        const b = build();
        b.persistence.restoreTimersFromStorage();

        expect(b.ctx.timers.get('timer-1')!.isRunning).toBe(false);
        expect(intervals).toHaveLength(0);
    });

    it('keeps the idle timer out of the session state machine', () => {
        const { creator, lifecycle, ctx } = build();
        lifecycle.startIdleTimer();
        const idle = ctx.timers.get(IDLE_TIMER_ID)!;
        expect(idle.runState).toBe('running');

        const fresh = creator.createTimer({ taskId: 'tv-inline:a.md:ln:1', taskName: 'A', timerType: 'countup' });
        expect(fresh.runState).toBe('running');
        expect(fresh.sessionCount).toBe(0);
        expect(fresh.recordedElapsedTime).toBe(0);
    });
});
