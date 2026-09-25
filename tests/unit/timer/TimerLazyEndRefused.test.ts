import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { CountupTimer, TimerInstance, TimerRecordMode } from '../../../src/timer/TimerInstance';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * end の書き足しが拒否されても、門（lazyEndFloorMs）は決めた次の見直しの時刻へ
 * 進む。門はメモリの上だけの「次にいつ見直すか」の予定で、状態ではない。end の
 * 真の値は見直すたびにファイルから読み直すので、拒否された書き足しは次の見直しで
 * 古い end を読んでまた書く。
 *
 * 以前は拒否で門を進めず、拒否が続くと毎 tick 書き直して毎秒通知が出た。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';
const at = (h: number, m: number, s = 0) => new Date(2026, 8, 21, h, m, s);

function lifecycleOver(s: VaultSession) {
    const ctx = {
        timers: new Map<string, TimerInstance>(), recorder: s.recorder,
        plugin: { settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 } }, app: s.app,
        startTimer: () => { }, render: () => { }, renderTimerItem: () => { }, persistTimersToStorage: () => { },
        onTimerClosed: () => { }, flushTimerContent: async () => true, discardTimerContent: () => { },
        ensureContainer: () => ({}) as HTMLElement, destroyContainer: () => { },
        getPinState: () => 'pinned' as const, togglePin: () => { }, shouldShowPinBadge: () => false,
    } as unknown as TimerContext;
    return { ctx, lifecycle: new TimerLifecycle(ctx, new TimerCreator(ctx)) };
}

/** 09:00 に始めて、実効 end（開始時刻）を過ぎた 09:10 の今も走っているタイマー。 */
async function runningPastEnd(mode: TimerRecordMode) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', ''].join('\n')]]);
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
    timer.lazyEndFloorMs = undefined;

    // 実効 end は行の end、無ければ開始時刻とする（既定の長さを持ち込まない）。
    const plugin = (s.recorder as unknown as { plugin: Record<string, unknown> }).plugin;
    plugin.getTaskReadService = () => ({
        getDisplayTask: (id: string) => {
            const t = s.index.getTask(id);
            return t && { ...t, effectiveEndDate: t.endDate ?? t.startDate, effectiveEndTime: t.endTime ?? t.startTime };
        },
    });
    vi.setSystemTime(at(9, 10));
    return { s, contents, timer, ...h };
}

/** これ以後の `vault.process` をすべて例外で落とし、呼ばれた回数を数える。 */
function refuseAllWrites(s: VaultSession) {
    const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
    const calls = { n: 0 };
    vault.process = async () => { calls.n++; throw new Error('refused'); };
    return calls;
}

async function tickAndSettle(lifecycle: TimerLifecycle, timer: TimerInstance, s: VaultSession) {
    (lifecycle as unknown as { tick(id: string): void }).tick(timer.id);
    await vi.waitFor(() => {
        expect((lifecycle as unknown as { extending: Set<string> }).extending.has(timer.id)).toBe(false);
    });
    await s.settle(FILE);
}

describe('a refused end extension waits for the next look', () => {
    afterEach(() => vi.useRealTimers());

    for (const mode of ['self', 'child'] as const) {
        it(`${mode}: ticks until the next look write and tell once`, async () => {
            const { s, timer, lifecycle } = await runningPastEnd(mode);
            const writes = refuseAllWrites(s);
            Notice.messages.length = 0;

            for (let i = 0; i < 20; i++) {
                vi.setSystemTime(at(9, 10, i));
                await tickAndSettle(lifecycle, timer, s);
            }

            expect(writes.n).toBe(1);
            expect(Notice.messages).toHaveLength(1);
            const floor = timer.lazyEndFloorMs!;
            expect(floor).toBeGreaterThan(at(9, 10, 19).getTime());

            // 次の見直しで、ファイルの古い end を読んでまた書く。
            vi.setSystemTime(new Date(floor));
            await tickAndSettle(lifecycle, timer, s);
            expect(writes.n).toBe(2);
            expect(Notice.messages).toHaveLength(2);
            s.dispose();
        });
    }
});
