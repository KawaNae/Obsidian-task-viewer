import { describe, it, expect, afterEach, vi } from 'vitest';
import { targetOf, type TimerState } from '../../../src/timer/TimerState';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { begin, timerOn, timerRig } from '../helpers/timerRig';

/**
 * タイマーが外してよいのは、自分の書き込みで付けた `^id` だけで、付けたかどうかは
 * その書き込みが記録する（`owned`。id の形からは推さない）。外すのは、同じノートで
 * 開いているほかのどのタイマーも、その錨で行を引かない（対象、尻尾、書いている
 * 途中の行）ときだけ。
 *
 * タイマー B が A の走行中の行を対象にして先に閉じても、A の尻尾の `^tv-t-` は
 * 残る。A の ■ はその行を引いて閉じ、予備の記録を足さない。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';
const ORIGINAL = ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n');
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

/** 1 つの表の上の 2 つのタイマー: A は「対象」の子に、B は A の走行中の行の子に記録する。 */
async function twoTimers() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const contents = new Map([[FILE, ORIGINAL]]);
    const s = vaultSession(contents);
    await s.scanAll();
    const rig = timerRig(s);

    const target = s.index.getTasks().find(t => t.content === '対象')!;
    const a = await begin(rig, timerOn(target, 'child', 'countup', s.recorder.startAnchor(target) ?? undefined), target);
    await lineWritten(s, a);

    // B は A の走行中の行を対象にする。その行は A の `^tv-t-` をもう持っている。
    const line = s.index.getTaskByAnchor(FILE, a.tail!)!;
    expect(s.recorder.startAnchor(line)).toBe(a.tail);
    const b = await begin(rig, timerOn(line, 'child'), line);
    await lineWritten(s, b);
    expect(targetOf(b)).toBe(a.tail);
    expect(b.owned).not.toContain(a.tail);
    return { s, contents, rig, a, b };
}

async function settleAll(s: VaultSession) {
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
    }
}

/** 1 本目の往復が済むまで待つ（行を書き、その錨が尻尾になった）。 */
async function lineWritten(s: VaultSession, timer: TimerState) {
    await vi.waitFor(() => {
        expect(timer.tail).not.toBeNull();
        expect(s.index.getTaskByAnchor(timer.file, timer.tail!)).toBeDefined();
    });
    await settleAll(s);
}

const records = (text: string) => [...text.matchAll(/@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);
/** 開始時刻だけを持つ、開いたままのセッションの行。 */
const openLines = (text: string) => text.split('\n').filter(l => /@2026-09-21T\d\d:\d\d(?!>)/.test(l));

describe('two timers: one does not take off an anchor it did not put on, nor one the other holds', () => {
    afterEach(() => vi.useRealTimers());

    it('B, on A\'s running line, closes first: A\'s line keeps its anchor, and A\'s ■ closes that line', async () => {
        const { s, contents, rig, a, b } = await twoTimers();
        const aLine = a.tail!;

        vi.setSystemTime(at(9, 5));
        await rig.lifecycle.stop(b, 'close');
        await settleAll(s);
        expect(rig.board.has(b)).toBe(false);
        expect(s.index.getTaskByAnchor(FILE, aLine)).toBeDefined();

        vi.setSystemTime(at(9, 10));
        await rig.lifecycle.stop(a, 'close');
        await settleAll(s);

        expect(rig.board.has(a)).toBe(false);
        const text = contents.get(FILE)!;
        expect(openLines(text)).toEqual([]);
        expect(records(text).sort()).toEqual(['09:00>09:05', '09:00>09:10']);
        s.dispose();
    });

    it('A closes first: the line B runs on keeps its anchor, so B still finds its target', async () => {
        const { s, contents, rig, a, b } = await twoTimers();

        vi.setSystemTime(at(9, 10));
        await rig.lifecycle.stop(a, 'close');
        await settleAll(s);
        expect(rig.board.has(a)).toBe(false);
        expect(s.index.getTaskByAnchor(FILE, targetOf(b)!)).toBeDefined();

        vi.setSystemTime(at(9, 15));
        await rig.lifecycle.stop(b, 'close');
        await settleAll(s);
        const text = contents.get(FILE)!;
        expect(openLines(text)).toEqual([]);
        expect(records(text).sort()).toEqual(['09:00>09:10', '09:00>09:15']);
        s.dispose();
    });
});
