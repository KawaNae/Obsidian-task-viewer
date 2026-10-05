import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { begin, timerOn, timerRig, type TimerRig } from '../helpers/timerRig';
import { readSeconds } from '../../../src/timer/TimerClock';
import { finished, type TimerState } from '../../../src/timer/TimerState';
import { step } from '../../../src/timer/TimerTransitions';

/**
 * ポモドーロも countup と同じ状態機械に乗る（論点11a）。⏸ は記録を閉じて中断し、
 * ▶ は新しい走行中の行を書く。時計は止めた所から続き、止まっていた時間は記録に
 * 入らない。周に限りがあれば、最後の区間が満ちた時刻で記録して閉じる。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';
const at = (h: number, m: number, sec = 0) => new Date(2026, 8, 21, h, m, sec);
const records = (text: string) => [...text.matchAll(/@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);
const openLines = (text: string) => text.split('\n').filter(l => /@2026-09-21T\d\d:\d\d(?!>)/.test(l));

describe('a pomodoro records each run and resumes where it stopped', () => {
    let s: VaultSession;
    let contents: Map<string, string>;
    let rig: TimerRig;
    let timer: TimerState;

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
        contents = new Map([[FILE, ['- [ ] 器 @2026-09-21 ^box', ''].join('\n')]]);
        s = vaultSession(contents);
        await s.scanAll();
        rig = timerRig(s);
        const task = s.index.getTasks().find(t => t.content === '器')!;
        timer = await begin(rig, timerOn(task, 'child', 'pomodoro'), task);
        await s.settle(FILE);
    });
    afterEach(() => {
        s.dispose();
        vi.useRealTimers();
    });

    it('⏸ writes the record and suspends; ▶ writes a new running line, and the clock goes on from where it stopped', async () => {
        vi.setSystemTime(at(9, 10));
        await rig.lifecycle.stop(timer, 'suspend');
        await s.settle(FILE);
        expect(timer.session).toEqual({ kind: 'suspended' });
        expect(timer.clock).toEqual({ kind: 'frozen', seconds: 600 });
        expect(timer.recorded).toEqual({ seconds: 600, count: 1 });
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        expect(openLines(contents.get(FILE)!)).toEqual([]);

        // 止まっていた 20 分は時計にも記録にも入らない。
        vi.setSystemTime(at(9, 30));
        await rig.lifecycle.resume(timer);
        await s.settle(FILE);
        expect(timer.session).toEqual({ kind: 'running', from: 600 });
        expect(openLines(contents.get(FILE)!)).toEqual([expect.stringContaining('@2026-09-21T09:30')]);

        vi.setSystemTime(at(9, 35));
        expect(readSeconds(timer.clock, Date.now())).toBe(900);
        await rig.lifecycle.stop(timer, 'suspend');
        await s.settle(FILE);
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10', '09:30>09:35']);
        expect(timer.recorded).toEqual({ seconds: 900, count: 2 });
    });

    it('■ while running writes the record and closes', async () => {
        vi.setSystemTime(at(9, 12));
        await rig.lifecycle.stop(timer, 'close');
        await s.settle(FILE);
        expect(rig.board.values()).toEqual([]);
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:12']);
    });

    it('with no auto repeat, the last segment filling records up to the moment it filled and closes', async () => {
        if (timer.measure.type !== 'interval') throw new Error('not a pomodoro');
        rig.board.dispatch(timer, { type: 'retimed', groups: [{ ...timer.measure.groups[0], repeatCount: 1 }] });

        // 25 分の work と 5 分の break の1周は 09:30 に満ちる。tick が気づくのは 09:31:07。
        rig.lifecycle.tick(at(9, 29, 50).getTime());
        vi.setSystemTime(at(9, 31, 7));
        rig.lifecycle.tick(Date.now());
        await vi.waitFor(() => expect(rig.board.values()).toEqual([]));
        await s.settle(FILE);
        expect(records(contents.get(FILE)!)).toEqual(['09:00>09:30']);
    });

    it('a pomodoro that finished its round and waits to record only closes: ⏸ does not turn it to suspend', () => {
        if (timer.measure.type !== 'interval') throw new Error('not a pomodoro');
        const once = { ...timer, measure: { ...timer.measure, groups: [{ ...timer.measure.groups[0], repeatCount: 1 }] } };
        const stopped = step(once, { type: 'stopped', then: 'close' }, at(9, 30).getTime());
        expect(finished(stopped, at(9, 31).getTime())).toBe(true);
        expect(step(stopped, { type: 'stopped', then: 'suspend' }, at(9, 31).getTime())).toBe(stopped);
    });
});
