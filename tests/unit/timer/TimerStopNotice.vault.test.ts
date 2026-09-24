import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { TimerCreator } from '../../../src/timer/TimerCreator';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { TimerInstance, TimerRecordMode } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import en from '../../../src/i18n/locales/en.json';

/**
 * ■ 終了を1回押したときに利用者が聞くのは、ちょうど1件。書けたなら成功の
 * 通知、書けなかったなら拒否の理由。実物の TaskIndex / 書き込みの層 /
 * TimerRecorder / TimerLifecycle を通し、記録の書き込みを拒否させる形は
 * 「走行中の行を、index が読み直す前に外から書き換える／消す」で作る。
 */

(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1,
    clearInterval: () => { /* unused */ },
};

const FILE = 'notes/a.md';

type NoticeKey = keyof typeof en.notice;

function isNotice(message: string, key: NoticeKey): boolean {
    const template = en.notice[key] as string;
    const pattern = template
        .split(/\{\{\w+\}\}/)
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${pattern}$`, 's').test(message);
}

function lifecycleOver(s: VaultSession) {
    const ctx = {
        timers: new Map<string, TimerInstance>(),
        recorder: s.recorder,
        plugin: { settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 } },
        app: s.app,
        startTimer: () => { /* unused */ },
        render: () => { /* unused */ },
        renderTimerItem: () => { /* unused */ },
        persistTimersToStorage: () => { /* unused */ },
        onTimerClosed: () => { /* unused */ },
        flushTimerContent: async () => true,
        discardTimerContent: () => { /* unused */ },
        ensureContainer: () => ({}) as HTMLElement,
        destroyContainer: () => { /* unused */ },
        getPinState: () => 'pinned' as const,
        togglePin: () => { /* unused */ },
        shouldShowPinBadge: () => false,
    } as unknown as TimerContext;
    const creator = new TimerCreator(ctx, { isAutoManagedTimerTargetId: () => false } as unknown as TimerStorageUtils);
    return { ctx, lifecycle: new TimerLifecycle(ctx, creator) };
}

async function start(s: VaultSession, recordMode: TimerRecordMode): Promise<TimerInstance> {
    await s.scanAll();
    const target = s.index.getTasks().find(task => task.content === '対象')!;
    const timer = s.creator.createTimer({
        taskId: target.id,
        taskName: target.content,
        taskFile: target.file,
        taskOriginalText: target.originalText,
        timerType: 'countup',
        recordMode,
        autoStart: true,
    });
    if (recordMode === 'child') await s.recorder.createChildAtStart(timer);
    await s.settle(FILE);
    timer.startTimeMs = Date.now() - 60_000;
    return timer;
}

describe('one press of ■ says one thing', () => {
    let contents: Map<string, string>;
    let s: VaultSession;

    beforeEach(() => {
        contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
        s = vaultSession(contents);
    });
    afterEach(() => { s.dispose(); vi.useRealTimers(); });

    it('written: one notice, and it is the success', async () => {
        const timer = await start(s, 'child');
        const { ctx, lifecycle } = lifecycleOver(s);
        ctx.timers.set(timer.id, timer);
        Notice.messages.length = 0;

        await lifecycle.finishTimer(timer);

        expect(Notice.messages).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'kindRecorded')).toBe(true);
        expect(ctx.timers.has(timer.id)).toBe(false);
        expect(contents.get(FILE)).toMatch(/- \[x\] .*\^tv-t-/);
    });

    it('the running line was removed behind the index: one notice, and it is the refusal', async () => {
        const timer = await start(s, 'child');
        const { ctx, lifecycle } = lifecycleOver(s);
        ctx.timers.set(timer.id, timer);
        // 外から走行中の行を消す。index はまだ読み直していない。
        const anchor = `^${timer.tailRecordBlockId}`;
        contents.set(FILE, contents.get(FILE)!.split('\n').filter(line => !line.includes(anchor)).join('\n'));
        const before = contents.get(FILE);
        Notice.messages.length = 0;

        await lifecycle.finishTimer(timer);

        expect(Notice.messages, Notice.messages.join(' | ')).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'writeTargetGone'), Notice.messages[0]).toBe(true);
        // widget は残り、計測も残る。
        expect(ctx.timers.has(timer.id)).toBe(true);
        expect(timer.sessionCount).toBe(0);
        expect(contents.get(FILE)).toBe(before);
    });

    it('the running line was rewritten behind the index: one notice, and it is the refusal', async () => {
        const timer = await start(s, 'self');
        const { ctx, lifecycle } = lifecycleOver(s);
        ctx.timers.set(timer.id, timer);
        // self の記録先（対象タスクの行）を、index が読み直す前に書き換える。
        contents.set(FILE, contents.get(FILE)!.replace('- [ ] 対象', '- [ ] 別の名前'));
        const before = contents.get(FILE);
        Notice.messages.length = 0;

        await lifecycle.finishTimer(timer);

        expect(Notice.messages, Notice.messages.join(' | ')).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'writeTargetChanged'), Notice.messages[0]).toBe(true);
        expect(ctx.timers.has(timer.id)).toBe(true);
        expect(contents.get(FILE)).toBe(before);
    });
});
