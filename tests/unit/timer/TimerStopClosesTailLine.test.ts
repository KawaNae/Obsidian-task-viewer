import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { CountupTimer, TimerInstance, TimerRecordMode } from '../../../src/timer/TimerInstance';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * 停止は尻尾（tailRecordBlockId）が指すセッションの行を閉じる
 * （TimerRecorder.recordSessionEnd）。
 *
 * 尻尾は書き込みが書けたときに移り、停止はその錨で行を引いて閉じる。以前は書いた
 * あとにスキャンで行の id を引き直し、引けなかったときの停止は開いた行の横に記録を
 * 1行足した。開いた行は残り、
 * 1 セッションが 2 行になった（並びも逆）。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

function lifecycleOver(s: VaultSession) {
    const ctx = {
        timers: new Map<string, TimerInstance>(), recorder: s.recorder,
        plugin: { settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 } }, app: s.app,
        startTimer: () => { }, render: () => { }, renderTimerItem: () => { }, persistTimersToStorage: () => { },
        onTimerClosed: () => { }, flushTimerContent: async () => true, discardTimerContent: () => { },
        ensureContainer: () => ({}) as HTMLElement, destroyContainer: () => { },
        getPinState: () => 'pinned' as const, togglePin: () => { }, shouldShowPinBadge: () => false,
    } as unknown as TimerContext;
    const lifecycle = new TimerLifecycle(ctx, new TimerCreator(ctx));
    return { ctx, lifecycle };
}

async function sessionAt9(mode: TimerRecordMode) {
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
    const h = lifecycleOver(s);
    h.ctx.timers.set(timer.id, timer);
    return { s, contents, timer, ...h };
}

async function settleAll(s: VaultSession) {
    await new Promise(r => setTimeout(r, 0));
    await s.settle(FILE);
    await new Promise(r => setTimeout(r, 0));
}

const records = (text: string) => [...text.matchAll(/@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);
/** 開始時刻だけを持つ、開いたままのセッションの行。 */
const openLines = (text: string) => text.split('\n').filter(l => /@2026-09-21T\d\d:\d\d(?!>)/.test(l));

describe('a stop closes the session line the tail names', () => {
    afterEach(() => vi.useRealTimers());

    it('child, session 1: ■ closes the line written at start, and there is one line', async () => {
        const { s, contents, timer, lifecycle, ctx } = await sessionAt9('child');
        // 書けた時点で尻尾はその行の錨。
        expect(await s.recorder.writeStart(timer)).toBe(true);
        expect(openLines(contents.get(FILE)!)).toEqual([expect.stringContaining(`^${timer.tailRecordBlockId}`)]);
        await s.settle(FILE);

        timer.startTimeMs = Date.now();
        vi.setSystemTime(at(9, 10));
        Notice.messages.length = 0;
        await lifecycle.finishTimer(timer);
        await settleAll(s);

        expect(Notice.messages).toHaveLength(1);
        expect(ctx.timers.has(timer.id)).toBe(false);
        const text = contents.get(FILE)!;
        expect(records(text)).toEqual(['09:00>09:10']);
        expect(openLines(text)).toEqual([]);
        expect(text.split('\n').filter(l => l.includes('@2026-09-21T09:'))).toHaveLength(1);
        s.dispose();
    });

    for (const mode of ['child', 'self'] as const) {
        it(`${mode}, session 2: ⏸ closes the resumed line, and the records are 09:00>09:10 then 09:20>09:30`, async () => {
            const { s, contents, timer, lifecycle } = await sessionAt9(mode);
            await s.recorder.writeStart(timer);
            await s.settle(FILE);
            timer.startTimeMs = Date.now();
            vi.setSystemTime(at(9, 10));
            await lifecycle.suspendTimer(timer);
            await settleAll(s);
            expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);

            vi.setSystemTime(at(9, 20));
            const firstTail = timer.tailRecordBlockId;
            // 再開の行が書けた時点で、尻尾は新しい行。
            lifecycle.resumeSession(timer);
            await vi.waitFor(() => expect(timer.runState).toBe('running'));
            expect(timer.tailRecordBlockId).not.toBe(firstTail);
            await settleAll(s);
            expect(openLines(contents.get(FILE)!)).toHaveLength(1);

            vi.setSystemTime(at(9, 30));
            Notice.messages.length = 0;
            await lifecycle.suspendTimer(timer);
            await settleAll(s);

            expect(Notice.messages).toHaveLength(1);
            expect(timer.runState).toBe('suspended');
            expect(timer.sessionCount).toBe(2);
            const text = contents.get(FILE)!;
            expect(records(text)).toEqual(['09:00>09:10', '09:20>09:30']);
            expect(openLines(text)).toEqual([]);
            expect(text.split('\n').filter(l => l.includes('T09:20'))).toHaveLength(1);
            s.dispose();
        });
    }
});
