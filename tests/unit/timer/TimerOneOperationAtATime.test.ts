import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import type { RecordMode, TimerState } from '../../../src/timer/TimerState';
import { NO_TASK_LOOKUP, toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { begin, timerOn, timerRig, type TimerRig } from '../helpers/timerRig';

/**
 * 1 つのタイマーの操作は 1 つずつ（`TimerRuntime.busy`、`TimerLifecycle.exclusive`）。
 * 記録の往復中に押された ⏸、■、▶、✕ は捨てる。ボタンは記録が返るまで描き直され
 * ないので、二度押しはそのまま届く。通せば同じ走行を二度記録し、通知も二度出る。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

/** 09:00 に始めて 09:10 の今も走っているタイマー。 */
async function runningTimer(mode: RecordMode): Promise<{ s: VaultSession; contents: Map<string, string>; rig: TimerRig; timer: TimerState }> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
    const s = vaultSession(contents);
    await s.scanAll();
    const rig = timerRig(s);
    const target = s.index.getTasks().find(t => t.content === '対象')!;
    const timer = await begin(rig, timerOn(target, mode, 'countup', s.recorder.startAnchor(target)!), target);
    await s.settle(FILE);
    vi.setSystemTime(at(9, 10));
    return { s, contents, rig, timer };
}

const records = (text: string) => [...text.matchAll(/@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);

async function settleAll(s: VaultSession) {
    await new Promise(r => setTimeout(r, 0));
    await s.settle(FILE);
}

describe('a second press while the record is on its way is dropped', () => {
    afterEach(() => vi.useRealTimers());

    for (const mode of ['self', 'child'] as const) {
        it(`${mode}: ⏸ twice records the run once, with one notice`, async () => {
            const { s, contents, rig, timer } = await runningTimer(mode);
            Notice.messages.length = 0;
            await Promise.all([rig.lifecycle.stop(timer, 'suspend'), rig.lifecycle.stop(timer, 'suspend')]);
            await settleAll(s);

            expect(Notice.messages).toHaveLength(1);
            expect(timer.session).toEqual({ kind: 'suspended' });
            expect(timer.recorded).toEqual({ seconds: 600, count: 1 });
            expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);
            s.dispose();
        });

        it(`${mode}: ■ twice records the run once, with one notice, and closes once`, async () => {
            const { s, contents, rig, timer } = await runningTimer(mode);
            Notice.messages.length = 0;
            const removed = vi.spyOn(rig.board, 'remove');
            await Promise.all([rig.lifecycle.stop(timer, 'close'), rig.lifecycle.stop(timer, 'close')]);
            await settleAll(s);

            expect(Notice.messages).toHaveLength(1);
            expect(rig.board.has(timer)).toBe(false);
            expect(removed).toHaveBeenCalledTimes(1);
            expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);
            s.dispose();
        });
    }

    it('■ pressed while ⏸ is on its way is dropped: the timer stays, suspended', async () => {
        const { s, contents, rig, timer } = await runningTimer('child');
        Notice.messages.length = 0;
        await Promise.all([rig.lifecycle.stop(timer, 'suspend'), rig.lifecycle.stop(timer, 'close')]);
        await settleAll(s);

        expect(Notice.messages).toHaveLength(1);
        expect(timer.recorded.count).toBe(1);
        expect(timer.session).toEqual({ kind: 'suspended' });
        expect(rig.board.has(timer)).toBe(true);
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        s.dispose();
    });

    it('✕ pressed while ⏸ is on its way is dropped: the record stays, the timer stays', async () => {
        const { s, contents, rig, timer } = await runningTimer('child');
        const suspending = rig.lifecycle.stop(timer, 'suspend');
        // 押した時点では記録待ち: ノートに走行中の行を持つので、確認の 2 打目で捨てに行く。
        expect(rig.lifecycle.close(timer, true)).toBe('closing');
        await suspending;
        await settleAll(s);

        expect(rig.board.has(timer)).toBe(true);
        expect(timer.session).toEqual({ kind: 'suspended' });
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        s.dispose();
    });

    it('⏸ pressed while a resume is on its way is dropped: the resumed session runs on its own line', async () => {
        const { s, contents, rig, timer } = await runningTimer('child');
        await rig.lifecycle.stop(timer, 'suspend');
        await settleAll(s);

        vi.setSystemTime(at(9, 20));
        const resuming = rig.lifecycle.resume(timer);
        await rig.lifecycle.stop(timer, 'suspend');
        await resuming;
        await settleAll(s);
        expect(rig.runtime.busy.has(timer.id)).toBe(false);

        expect(timer.session.kind).toBe('running');
        expect(timer.clock).toEqual({ kind: 'running', startMs: at(9, 20).getTime() });
        expect(timer.recorded.count).toBe(1);
        const text = contents.get(FILE)!;
        expect(records(text)).toEqual(['09:00>09:10']);
        expect(text).toMatch(/@2026-09-21T09:20 \^/);

        // 往復が済めば ⏸ は通る。
        vi.setSystemTime(at(9, 30));
        await rig.lifecycle.stop(timer, 'suspend');
        await settleAll(s);
        expect(timer.recorded.count).toBe(2);
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10', '09:20>09:30']);
        s.dispose();
    });

    it('the end is not extended while the resume is on its way (the tail may still be the last record)', async () => {
        const { s, contents, rig, timer } = await runningTimer('child');
        await rig.lifecycle.stop(timer, 'suspend');
        await settleAll(s);
        rig.runtime.lazyEndFloorMs.delete(timer.id);

        s.plugin.getTaskReadService = () => ({
            getDisplayTask: (id: string) => {
                const t = s.index.getTask(id);
                return t && toDisplayTask(t, s.plugin.settings.startHour, NO_TASK_LOOKUP);
            },
        });
        const extend = vi.spyOn(s.recorder, 'extendRunningSession');

        vi.setSystemTime(at(9, 20));
        const resuming = rig.lifecycle.resume(timer);
        // 往復の最中に来た tick。
        rig.lifecycle.tick(Date.now());
        await resuming;
        await settleAll(s);

        expect(extend).not.toHaveBeenCalled();
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        s.dispose();
    });
});
