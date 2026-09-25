import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { CountupTimer, TimerInstance } from '../../../src/timer/TimerInstance';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * タイマーが書く行はどれも錨を付けて書き、書けたらそれが尻尾になる。尻尾を
 * 見失ったときの予備の記録も同じで、置き場所（対象の先頭の子）は変えない。
 *
 * 形 B（実機の B）: 走行中の行を外で消してから ⏸ を押すと、予備の記録が先頭の子に
 * 書かれる。その行は錨を持たず、尻尾は消えた行を指したままだったので、次の ▶ の
 * 行も先頭の子に入り、前の記録より上に並んだ。
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
        plugin: { settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 } },
        app: s.app,
        startTimer: () => { }, render: () => { }, renderTimerItem: () => { }, persistTimersToStorage: () => { },
        onTimerClosed: () => { }, discardTimerContent: () => { },
        flushTimerContent: async () => true,
        ensureContainer: () => ({}) as HTMLElement, destroyContainer: () => { },
        getPinState: () => 'pinned' as const, togglePin: () => { }, shouldShowPinBadge: () => false,
    } as unknown as TimerContext;
    s.onOpenTimers(() => ctx.timers.values());
    return { ctx, lifecycle: new TimerLifecycle(ctx, new TimerCreator(ctx)) };
}

async function settleAll(s: VaultSession) {
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
    }
}

const busyOf = (lifecycle: TimerLifecycle) => (lifecycle as unknown as { busy: Set<string> }).busy;
const lines = (contents: Map<string, string>) => contents.get(FILE)!.split('\n').filter(l => l.trim() !== '');

describe('a record written after the running line was lost becomes the tail', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('the running line is deleted, then ⏸ and ▶: the next line sits below the record, and ■ closes it', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
        const s = vaultSession(contents);
        await s.scanAll();
        const { ctx, lifecycle } = lifecycleOver(s);
        const target = s.index.getTasks().find(t => t.content === '対象')!;
        const timer = s.creator.createTimer({
            taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
            timerType: 'countup', recordMode: 'child', autoStart: true,
        }) as CountupTimer;
        ctx.timers.set(timer.id, timer);
        expect(await s.recorder.writeStart(timer)).toBe(true);
        await settleAll(s);

        // 外で走行中の行を消す。
        const running = timer.tailRecordBlockId!;
        contents.set(FILE, contents.get(FILE)!.split('\n').filter(l => !l.includes(`^${running}`)).join('\n'));
        await s.scanAll();

        vi.setSystemTime(at(9, 10));
        await lifecycle.suspendTimer(timer);
        await settleAll(s);
        expect(timer.runState).toBe('suspended');
        const record = lines(contents).findIndex(l => l.includes('@2026-09-21T09:00>09:10'));
        expect(record).toBe(1);
        // 予備の記録も錨を持ち、尻尾になる。
        expect(lines(contents)[record]).toMatch(new RegExp(`\\^${timer.tailRecordBlockId}$`));

        vi.setSystemTime(at(9, 20));
        lifecycle.resumeSession(timer);
        await vi.waitFor(() => expect(busyOf(lifecycle).has(timer.id)).toBe(false));
        await settleAll(s);
        expect(timer.runState).toBe('running');
        const next = lines(contents).findIndex(l => /@2026-09-21T09:20(?!>)/.test(l));
        expect(next).toBeGreaterThan(record);

        vi.setSystemTime(at(9, 30));
        await lifecycle.finishTimer(timer);
        await settleAll(s);
        const after = lines(contents);
        expect(after.filter(l => /@2026-09-21T\d\d:\d\d(?!>)/.test(l))).toEqual([]);
        expect(after.map(l => l.match(/T(\d\d:\d\d>\d\d:\d\d)/)?.[1]).filter(Boolean)).toEqual(['09:00>09:10', '09:20>09:30']);
        s.dispose();
    });
});
