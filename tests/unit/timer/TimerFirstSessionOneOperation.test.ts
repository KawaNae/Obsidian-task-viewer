import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { TimerWidget } from '../../../src/timer/TimerWidget';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import { IDLE_TIMER_ID } from '../../../src/timer/TimerContext';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * 1 本目のセッションの行の書き込みも、1 つのタイマーの 1 操作
 * （TimerWidget.writeFirstSession → TimerLifecycle.exclusive）。往復中に押された
 * ■ や ✕ は、ほかの往復中の操作と同じく受け付けない。
 *
 * 以前は開始の往復と並んで ■ / ✕ が走った。■ は開いた行の横に記録を1行足して
 * 閉じ、✕ はまだ無い行を消しに行って閉じた。どちらも、あとから書き上がった開いた
 * 行がノートに残った。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';
const ORIGINAL = ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n');
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

/** vaultSession の上の、実物の TimerWidget。描画と保存だけは置き換える。 */
async function widgetOver() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const contents = new Map([[FILE, ORIGINAL]]);
    const s = vaultSession(contents);
    await s.scanAll();
    Object.assign(s.app.vault, { getName: () => 'test-vault' });
    const plugin = {
        settings: { ...DEFAULT_SETTINGS },
        getTaskIndex: () => s.index,
        getTaskWriteService: () => new TaskWriteService(s.index),
        getTaskReadService: () => ({ getTask: (id: string) => s.index.getTask(id) }),
    };
    // widget の lifecycle は、開始が tick を立てるときに受け取る。
    const ticker = vi.spyOn(TimerLifecycle.prototype, 'startTimerTicker');
    const widget = new TimerWidget(s.app, plugin as never);
    widget.render = () => { };
    widget.renderTimerItem = () => { };
    widget.persistTimersToStorage = () => { };

    const target = s.index.getTasks().find(t => t.content === '対象')!;
    widget.startTimer({
        taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
        timerType: 'countup', recordMode: 'child', autoStart: true,
    });
    const lifecycle = ticker.mock.contexts[0] as TimerLifecycle;
    ticker.mockRestore();
    const timer = [...widget.timers.values()].find(t => t.id !== IDLE_TIMER_ID)!;
    return { s, contents, widget, lifecycle, timer };
}

async function settleAll(s: VaultSession) {
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
    }
}

/** 1 本目の往復が済むまで待つ（行を書き、その id を引き受けた）。 */
async function firstLineAdopted(s: VaultSession, timer: TimerInstance) {
    await vi.waitFor(() => expect(timer.recordedChildTaskId).toBeDefined());
    await settleAll(s);
}

const records = (text: string) => [...text.matchAll(/@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);
/** 開始時刻だけを持つ、開いたままのセッションの行。 */
const openLines = (text: string) => text.split('\n').filter(l => /@2026-09-21T\d\d:\d\d(?!>)/.test(l));

describe('a stop or a discard pressed while the first session line is on its way waits its turn', () => {
    afterEach(() => vi.useRealTimers());

    it('■ during the first write is not taken: the timer runs on its line, and ■ afterwards leaves one closed line', async () => {
        const { s, contents, widget, lifecycle, timer } = await widgetOver();
        Notice.messages.length = 0;
        vi.setSystemTime(at(9, 5));
        await lifecycle.finishTimer(timer);
        await firstLineAdopted(s, timer);

        expect(Notice.messages).toEqual([]);
        expect(widget.timers.has(timer.id)).toBe(true);
        expect(timer.runState).toBe('running');
        expect(timer.isRunning).toBe(true);
        expect(timer.sessionCount).toBe(0);
        expect(records(contents.get(FILE)!)).toEqual([]);
        expect(openLines(contents.get(FILE)!)).toHaveLength(1);

        vi.setSystemTime(at(9, 10));
        await lifecycle.finishTimer(timer);
        await settleAll(s);

        expect(Notice.messages).toHaveLength(1);
        expect(widget.timers.has(timer.id)).toBe(false);
        const text = contents.get(FILE)!;
        expect(records(text)).toEqual(['09:00>09:10']);
        expect(openLines(text)).toEqual([]);
        expect(text.split('\n').filter(l => l.includes('@2026-09-21T09:'))).toHaveLength(1);
        s.dispose();
    });

    it('✕ during the first write is not taken: the timer stays, and ✕ afterwards takes its line away', async () => {
        const { s, contents, widget, lifecycle, timer } = await widgetOver();
        Notice.messages.length = 0;
        await lifecycle.discardTimer(timer);
        await firstLineAdopted(s, timer);

        expect(widget.timers.has(timer.id)).toBe(true);
        expect(timer.runState).toBe('running');
        expect(openLines(contents.get(FILE)!)).toHaveLength(1);

        await lifecycle.discardTimer(timer);
        await settleAll(s);

        expect(Notice.messages).toEqual([]);
        expect(widget.timers.has(timer.id)).toBe(false);
        expect(contents.get(FILE)).toBe(ORIGINAL);
        s.dispose();
    });
});
