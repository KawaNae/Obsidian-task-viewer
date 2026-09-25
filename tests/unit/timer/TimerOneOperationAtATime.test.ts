import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { CountupTimer, TimerInstance, TimerRecordMode } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * 1 つのタイマーの操作は 1 つずつ（TimerLifecycle.busy / exclusive）。記録の
 * 往復中に押された出口・再開・破棄は無視する。ボタンは記録が返るまで描き直され
 * ないので、二度押しはそのまま届く。以前は同じ走行を二度記録し（sessionCount=2）、
 * 通知も二度出た。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

function lifecycleOver(s: VaultSession) {
    const closed: string[] = [];
    const ctx = {
        timers: new Map<string, TimerInstance>(), recorder: s.recorder,
        plugin: { settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 } }, app: s.app,
        startTimer: () => { }, render: () => { }, renderTimerItem: () => { }, persistTimersToStorage: () => { },
        onTimerClosed: (t: TimerInstance) => { closed.push(t.id); }, flushTimerContent: async () => true, discardTimerContent: () => { },
        ensureContainer: () => ({}) as HTMLElement, destroyContainer: () => { },
        getPinState: () => 'pinned' as const, togglePin: () => { }, shouldShowPinBadge: () => false,
    } as unknown as TimerContext;
    const lifecycle = new TimerLifecycle(ctx, new TimerCreator(ctx, { isAutoManagedTimerTargetId: () => false } as unknown as TimerStorageUtils));
    return { ctx, lifecycle, closed };
}

/** 09:00 に始めて 09:10 の今も走っているタイマー。 */
async function runningTimer(mode: TimerRecordMode) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
    const s = vaultSession(contents);
    await s.scanAll();
    const target = s.index.getTasks().find(t => t.content === '対象')!;
    const timer = s.creator.createTimer({
        taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
        timerType: 'countup', recordMode: mode, autoStart: true,
    }) as CountupTimer;
    await s.recorder.writeStart(timer);
    await s.settle(FILE);
    const h = lifecycleOver(s);
    h.ctx.timers.set(timer.id, timer);
    timer.startTimeMs = Date.now();
    vi.setSystemTime(at(9, 10));
    return { s, contents, timer, ...h };
}

const records = (text: string) => [...text.matchAll(/@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);

async function settleAll(s: VaultSession) {
    await new Promise(r => setTimeout(r, 0));
    await s.settle(FILE);
}

describe('a second press while the record is on its way is ignored', () => {
    afterEach(() => vi.useRealTimers());

    for (const mode of ['self', 'child'] as const) {
        it(`${mode}: ⏸ twice records the run once, with one notice`, async () => {
            const { s, contents, timer, lifecycle } = await runningTimer(mode);
            Notice.messages.length = 0;
            await Promise.all([lifecycle.suspendTimer(timer), lifecycle.suspendTimer(timer)]);
            await settleAll(s);

            expect(Notice.messages).toHaveLength(1);
            expect(timer.runState).toBe('suspended');
            expect(timer.sessionCount).toBe(1);
            expect(timer.recordedElapsedTime).toBe(600);
            expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);
            s.dispose();
        });

        it(`${mode}: ■ twice records the run once, with one notice, and closes once`, async () => {
            const { s, contents, timer, lifecycle, ctx, closed } = await runningTimer(mode);
            Notice.messages.length = 0;
            await Promise.all([lifecycle.finishTimer(timer), lifecycle.finishTimer(timer)]);
            await settleAll(s);

            expect(Notice.messages).toHaveLength(1);
            expect(timer.sessionCount).toBe(1);
            expect(ctx.timers.has(timer.id)).toBe(false);
            expect(closed).toEqual([timer.id]);
            expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);
            s.dispose();
        });
    }

    it('■ pressed while ⏸ is on its way is ignored: the timer stays, suspended', async () => {
        const { s, contents, timer, lifecycle, ctx } = await runningTimer('child');
        Notice.messages.length = 0;
        await Promise.all([lifecycle.suspendTimer(timer), lifecycle.finishTimer(timer)]);
        await settleAll(s);

        expect(Notice.messages).toHaveLength(1);
        expect(timer.sessionCount).toBe(1);
        expect(timer.runState).toBe('suspended');
        expect(ctx.timers.has(timer.id)).toBe(true);
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        s.dispose();
    });

    it('✕ pressed while ⏸ is on its way is ignored: the record stays, the timer stays', async () => {
        const { s, contents, timer, lifecycle, ctx } = await runningTimer('child');
        await Promise.all([lifecycle.suspendTimer(timer), lifecycle.discardTimer(timer)]);
        await settleAll(s);

        expect(ctx.timers.has(timer.id)).toBe(true);
        expect(timer.runState).toBe('suspended');
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        s.dispose();
    });

    it('⏸ pressed while a resume is on its way is ignored: the resumed session runs on its own line', async () => {
        const { s, contents, timer, lifecycle } = await runningTimer('child');
        await lifecycle.suspendTimer(timer);
        await settleAll(s);

        vi.setSystemTime(at(9, 20));
        lifecycle.resumeSession(timer);
        await lifecycle.suspendTimer(timer);
        await vi.waitFor(async () => {
            await settleAll(s);
            expect((lifecycle as unknown as { busy: Set<string> }).busy.has(timer.id)).toBe(false);
        });

        expect(timer.runState).toBe('running');
        expect(timer.isRunning).toBe(true);
        expect(timer.sessionCount).toBe(1);
        const text = contents.get(FILE)!;
        expect(records(text)).toEqual(['09:00>09:10']);
        expect(text).toMatch(/@2026-09-21T09:20 \^/);

        // 往復が済めば ⏸ は通る。
        vi.setSystemTime(at(9, 30));
        await lifecycle.suspendTimer(timer);
        await settleAll(s);
        expect(timer.sessionCount).toBe(2);
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10', '09:20>09:30']);
        s.dispose();
    });

    it('the end is not extended while the resume is on its way (the tail may still be the last record)', async () => {
        const { s, contents, timer, lifecycle } = await runningTimer('child');
        await lifecycle.suspendTimer(timer);
        await settleAll(s);
        timer.lazyEndFloorMs = undefined;

        const plugin = (s.recorder as unknown as { plugin: Record<string, unknown> }).plugin;
        plugin.getTaskReadService = () => ({
            getDisplayTask: (id: string) => {
                const t = s.index.getTask(id);
                return t && { ...t, effectiveEndDate: t.endDate ?? t.startDate, effectiveEndTime: t.endTime ?? t.startTime };
            },
        });
        const extend = vi.spyOn(s.recorder, 'extendRunningSession');

        vi.setSystemTime(at(9, 20));
        lifecycle.resumeSession(timer);
        // 往復の最中に来た tick。
        (lifecycle as unknown as { tick(id: string): void }).tick(timer.id);
        await vi.waitFor(async () => {
            await settleAll(s);
            expect((lifecycle as unknown as { busy: Set<string> }).busy.has(timer.id)).toBe(false);
        });
        await settleAll(s);

        expect(extend).not.toHaveBeenCalled();
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        s.dispose();
    });
});
