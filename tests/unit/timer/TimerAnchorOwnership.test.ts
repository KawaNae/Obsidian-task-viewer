import { describe, it, expect, afterEach, vi } from 'vitest';
import { TimerWidget } from '../../../src/timer/TimerWidget';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import { IDLE_TIMER_ID } from '../../../src/timer/TimerContext';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * タイマーが外してよいのは、自分の書き込みで付けた `^id` だけで、付けたかどうかは
 * その書き込みが記録する（id の形からは推さない）。外すのは、開いているどの
 * タイマーもその錨を対象にも尻尾にも持っていないときだけ。
 *
 * 形 C（反例の実走の3）: タイマー B が A の走行中の行を対象にして先に閉じると、
 * B の片付けが A の尻尾の `^tv-t-` を外していた。A の ■ は尻尾を引けず、予備の
 * 記録を足し、A の開いた行は `[ ]` のまま残った。
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
    const ticker = vi.spyOn(TimerLifecycle.prototype, 'startTimerTicker');
    const widget = new TimerWidget(s.app, plugin as never);
    widget.render = () => { };
    widget.renderTimerItem = () => { };
    widget.persistTimersToStorage = () => { };

    const target = s.index.getTasks().find(t => t.content === '対象')!;
    widget.startTimer({
        taskId: target.id, taskName: target.content, taskFile: target.file, taskOriginalText: target.originalText,
        timerTargetId: target.anchor, timerType: 'countup', recordMode: 'child', autoStart: true,
    });
    const lifecycle = ticker.mock.contexts[0] as TimerLifecycle;
    ticker.mockRestore();
    const a = [...widget.timers.values()].find(t => t.id !== IDLE_TIMER_ID)!;
    await lineWritten(s, a);

    // B は A の走行中の行を対象にする。その行は A の `^tv-t-` をもう持っている。
    const line = s.index.getTaskByAnchor(FILE, a.tailRecordBlockId!)!;
    widget.startTimer({
        taskId: line.id, taskName: line.content, taskFile: line.file, taskOriginalText: line.originalText,
        timerTargetId: line.anchor, timerType: 'countup', recordMode: 'child', autoStart: true,
    });
    const b = [...widget.timers.values()].find(t => t.id !== IDLE_TIMER_ID && t.id !== a.id)!;
    await lineWritten(s, b);
    expect(b.timerTargetId).toBe(a.tailRecordBlockId);
    return { s, contents, widget, lifecycle, a, b };
}

async function settleAll(s: VaultSession) {
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
    }
}

/** 1 本目の往復が済むまで待つ（行を書き、その錨が尻尾になった）。 */
async function lineWritten(s: VaultSession, timer: TimerInstance) {
    await vi.waitFor(() => {
        expect(timer.tailRecordBlockId).toBeDefined();
        expect(s.index.getTaskByAnchor(timer.taskFile, timer.tailRecordBlockId!)).toBeDefined();
    });
    await settleAll(s);
}

const records = (text: string) => [...text.matchAll(/@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);
/** 開始時刻だけを持つ、開いたままのセッションの行。 */
const openLines = (text: string) => text.split('\n').filter(l => /@2026-09-21T\d\d:\d\d(?!>)/.test(l));

describe('two timers: one does not take off an anchor it did not put on, nor one the other holds', () => {
    afterEach(() => vi.useRealTimers());

    it('B, on A\'s running line, closes first: A\'s line keeps its anchor, and A\'s ■ closes that line', async () => {
        const { s, contents, widget, lifecycle, a, b } = await widgetOver();
        const aLine = a.tailRecordBlockId!;

        vi.setSystemTime(at(9, 5));
        await lifecycle.finishTimer(b);
        await settleAll(s);
        expect(widget.timers.has(b.id)).toBe(false);
        expect(s.index.getTaskByAnchor(FILE, aLine)).toBeDefined();

        vi.setSystemTime(at(9, 10));
        await lifecycle.finishTimer(a);
        await settleAll(s);

        expect(widget.timers.has(a.id)).toBe(false);
        const text = contents.get(FILE)!;
        expect(openLines(text)).toEqual([]);
        expect(records(text).sort()).toEqual(['09:00>09:05', '09:00>09:10']);
        s.dispose();
    });

    it('A closes first: the line B runs on keeps its anchor, so B still finds its target', async () => {
        const { s, contents, widget, lifecycle, a, b } = await widgetOver();

        vi.setSystemTime(at(9, 10));
        await lifecycle.finishTimer(a);
        await settleAll(s);
        expect(widget.timers.has(a.id)).toBe(false);
        expect(s.index.getTaskByAnchor(FILE, b.timerTargetId!)).toBeDefined();

        vi.setSystemTime(at(9, 15));
        await lifecycle.finishTimer(b);
        await settleAll(s);
        const text = contents.get(FILE)!;
        expect(openLines(text)).toEqual([]);
        expect(records(text).sort()).toEqual(['09:00>09:10', '09:00>09:15']);
        s.dispose();
    });
});
