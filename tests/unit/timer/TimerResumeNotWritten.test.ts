import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerContentBinding } from '../../../src/timer/TimerContentBinding';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { CountupTimer, TimerInstance, TimerRecordMode } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * 再開の行（兄弟の挿入）か名前を書けなかった再開は、取り消して中断に戻る
 * （TimerLifecycle.resumeSession）。通知は書き込みの層の1回だけ。
 *
 * 以前は尻尾が1本目の書き終えた記録を指したまま走り、2本目の end の書き足しと
 * 名前が1本目の記録を書き換えた（child と self の両方）。
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
        onTimerClosed: () => { }, discardTimerContent: () => { },
        ensureContainer: () => ({}) as HTMLElement, destroyContainer: () => { },
        getPinState: () => 'pinned' as const, togglePin: () => { }, shouldShowPinBadge: () => false,
    } as unknown as TimerContext;
    // 名前の書き込みは実物（TimerContentBinding）で通す。flush ごとに新しい binding
    // を使うのは、中身の無い flush のあとに drain の握りが解けず、以後の flush が
    // 書かずに true を返す形（TimerContentBinding.drain）を避けて、ここで見たい
    // 再開の取り消しだけを見るため。下書きは timer.pendingContent が運ぶ。
    const flushName = (timer: TimerInstance) => new TimerContentBinding({
        recorder: s.recorder, plugin: { getTaskIndex: () => s.index }, persistTimersToStorage: () => { },
    } as unknown as TimerContext).flush(timer);
    (ctx as unknown as { flushTimerContent: (id: string) => Promise<boolean> }).flushTimerContent =
        async (id: string) => flushName(ctx.timers.get(id)!);
    const lifecycle = new TimerLifecycle(ctx, new TimerCreator(ctx, { isAutoManagedTimerTargetId: () => false } as unknown as TimerStorageUtils));
    return { ctx, lifecycle, flushName };
}

/** 09:00 に始めて 09:10 に中断した、1 本目を記録済みのタイマー。 */
async function suspendedAfterFirst(mode: TimerRecordMode) {
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
    if (mode === 'child') {
        await s.recorder.createChildAtStart(timer);
        // 1 本目の行を書けた時点で、尻尾はその行。
        expect(timer.tailRecordBlockId).toBeDefined();
        expect(contents.get(FILE)).toContain(`^${timer.tailRecordBlockId}`);
    }
    await s.settle(FILE);
    const h = lifecycleOver(s);
    h.ctx.timers.set(timer.id, timer);
    timer.startTimeMs = Date.now();
    vi.setSystemTime(at(9, 10));
    await h.lifecycle.suspendTimer(timer);
    await s.settle(FILE);
    expect(timer.runState).toBe('suspended');
    expect(contents.get(FILE)).toContain('@2026-09-21T09:00>09:10');
    return { s, contents, timer, ...h };
}

/** 次に呼ばれる `vault.process` を `count` 回だけ例外で落とす。 */
function failNextWrites(s: VaultSession, count: number) {
    const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
    const real = vault.process;
    let left = count;
    vault.process = async (...a: unknown[]) => {
        if (left > 0) { left--; throw new Error('disk full'); }
        return real(...a);
    };
}

async function resumeAndWait(s: VaultSession, lifecycle: TimerLifecycle, timer: TimerInstance) {
    lifecycle.resumeSession(timer);
    // 往復が済むまで待つ（busy が外れるまで）。
    await vi.waitFor(async () => {
        await new Promise(r => setTimeout(r, 0));
        expect((lifecycle as unknown as { busy: Set<string> }).busy.has(timer.id)).toBe(false);
    });
    await s.settle(FILE);
}

/** end の書き足しが読むだけの読み取り口。 */
function withReadService(s: VaultSession) {
    const plugin = (s.recorder as unknown as { plugin: Record<string, unknown> }).plugin;
    plugin.getTaskReadService = () => ({
        getDisplayTask: (id: string) => {
            const t = s.index.getTask(id);
            return t && { ...t, effectiveEndDate: t.endDate ?? t.startDate, effectiveEndTime: t.endTime ?? t.startTime };
        },
    });
}

const starts = (text: string) => [...text.matchAll(/@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);

describe('a resume whose line cannot be written stays suspended', () => {
    afterEach(() => vi.useRealTimers());

    for (const mode of ['child', 'self'] as const) {
        it(`${mode}: the resume is taken back, with one notice, and the file is left as it was`, async () => {
            const { s, contents, timer, lifecycle } = await suspendedAfterFirst(mode);
            const afterFirst = contents.get(FILE)!;
            const before = {
                startTimeMs: timer.startTimeMs,
                pausedElapsedTime: timer.pausedElapsedTime,
                elapsedTime: timer.elapsedTime,
                recordedElapsedTime: timer.recordedElapsedTime,
                sessionCount: timer.sessionCount,
                tail: timer.tailRecordBlockId,
                childId: timer.recordedChildTaskId,
            };

            vi.setSystemTime(at(9, 20));
            failNextWrites(s, 1);
            Notice.messages.length = 0;
            await resumeAndWait(s, lifecycle, timer);

            expect(Notice.messages).toHaveLength(1);
            expect(timer.runState).toBe('suspended');
            expect(timer.isRunning).toBe(false);
            // 再開で立てた tick も止まっている。
            expect(timer.intervalId).toBeNull();
            expect(timer.startTimeMs).toBe(before.startTimeMs);
            expect(timer.pausedElapsedTime).toBe(before.pausedElapsedTime);
            expect(timer.elapsedTime).toBe(before.elapsedTime);
            expect(timer.recordedElapsedTime).toBe(before.recordedElapsedTime);
            expect(timer.sessionCount).toBe(before.sessionCount);
            expect(timer.tailRecordBlockId).toBe(before.tail);
            expect(timer.recordedChildTaskId).toBe(before.childId);
            expect(contents.get(FILE)).toBe(afterFirst);
            s.dispose();
        });

        it(`${mode}: ▶ again writes the line, and session 2's end and name go to it, not to 09:00>09:10`, async () => {
            const { s, contents, timer, lifecycle, flushName } = await suspendedAfterFirst(mode);
            const firstTail = timer.tailRecordBlockId;
            const firstChildId = timer.recordedChildTaskId;

            vi.setSystemTime(at(9, 20));
            failNextWrites(s, 1);
            await resumeAndWait(s, lifecycle, timer);
            expect(timer.runState).toBe('suspended');

            vi.setSystemTime(at(9, 30));
            Notice.messages.length = 0;
            await resumeAndWait(s, lifecycle, timer);
            expect(Notice.messages).toHaveLength(0);
            expect(timer.runState).toBe('running');
            expect(timer.isRunning).toBe(true);
            // 尻尾は新しい行へ移った。
            expect(timer.tailRecordBlockId).toBeDefined();
            expect(timer.tailRecordBlockId).not.toBe(firstTail);
            expect(timer.recordedChildTaskId).toBeDefined();
            expect(timer.recordedChildTaskId).not.toBe(firstChildId);

            // 走行中（2本目）: end の書き足しと名前の書き込み。
            withReadService(s);
            vi.setSystemTime(at(9, 45));
            await s.recorder.extendRunningSession(timer);
            await s.settle(FILE);
            timer.pendingContent = '2本目の作業';
            expect(await flushName(timer)).toBe(true);
            await s.settle(FILE);

            const running = contents.get(FILE)!;
            expect(running).toContain('09:00>09:10');
            const firstLine = running.split('\n').find(l => l.includes('09:00>09:10'))!;
            expect(firstLine).not.toContain('2本目の作業');
            // 09:45 の書き足しは 2 本目の行の end を 09:50 まで延ばす。
            const secondLine = running.split('\n').find(l => l.includes('T09:30>09:50'))!;
            expect(secondLine).toContain('2本目の作業');

            vi.setSystemTime(at(9, 50));
            await lifecycle.suspendTimer(timer);
            await s.settle(FILE);
            expect(starts(contents.get(FILE)!)).toEqual(['09:00>09:10', '09:30>09:50']);
            expect(timer.sessionCount).toBe(2);
            s.dispose();
        });
    }

    it('a name typed while suspended, on a note that cannot be written: one notice, still suspended', async () => {
        const { s, contents, timer, lifecycle } = await suspendedAfterFirst('child');
        const afterFirst = contents.get(FILE)!;
        timer.pendingContent = '中断中に直した名前';

        const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
        const real = vault.process;
        vault.process = async () => { throw new Error('disk full'); };
        vi.setSystemTime(at(9, 20));
        Notice.messages.length = 0;
        await resumeAndWait(s, lifecycle, timer);

        expect(Notice.messages).toHaveLength(1);
        expect(timer.runState).toBe('suspended');
        expect(timer.isRunning).toBe(false);
        expect(contents.get(FILE)).toBe(afterFirst);

        // 書けるようになれば、もう一度 ▶ で名前も行も書く。
        vault.process = real;
        Notice.messages.length = 0;
        await resumeAndWait(s, lifecycle, timer);
        expect(Notice.messages).toHaveLength(0);
        expect(timer.runState).toBe('running');
        const text = contents.get(FILE)!;
        expect(text.split('\n').find(l => l.includes('09:00>09:10'))).toContain('中断中に直した名前');
        s.dispose();
    });
});

describe('resolveTailRecord: the target row is the tail of a self timer in its first session only', () => {
    it('falls to the target row while session 1 runs and while it is suspended, not while session 2 runs', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', ''].join('\n')]]);
        const s = vaultSession(contents);
        await s.scanAll();
        const target = s.index.getTasks().find(t => t.content === '対象')!;
        const timer = s.creator.createTimer({
            taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
            timerType: 'countup', recordMode: 'self', autoStart: true,
        });
        // 行がまだスキャンに見えていない尻尾（何も引けない）。
        timer.tailRecordBlockId = 'tv-missing';
        timer.recordedChildTaskId = undefined;

        timer.sessionCount = 0;
        timer.runState = 'running';
        expect(s.recorder.resolveTailRecord(timer)?.content).toBe('対象');

        timer.sessionCount = 1;
        timer.runState = 'suspended';
        expect(s.recorder.resolveTailRecord(timer)?.content).toBe('対象');

        timer.sessionCount = 1;
        timer.runState = 'running';
        expect(s.recorder.resolveTailRecord(timer)).toBeUndefined();

        timer.sessionCount = 2;
        timer.runState = 'suspended';
        expect(s.recorder.resolveTailRecord(timer)).toBeUndefined();
        s.dispose();
    });
});
