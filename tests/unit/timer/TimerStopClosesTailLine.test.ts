import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import type { RecordMode } from '../../../src/timer/TimerState';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { begin, timerOn, timerRig } from '../helpers/timerRig';

/**
 * 止めると、尻尾（`tail`）が指す走行中の行を閉じる（TimerRecorder.recordSessionEnd）。
 * 尻尾は書き込みが書けたときに移り（`landed`）、止めるときはその錨で行を引いて
 * 閉じる。1 つの走行は 1 行で、開いた行も、横に足した記録も残らない。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

/** 09:00 に始めて、1 本目の行を書いたタイマー。 */
async function startedAt9(mode: RecordMode) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
    const s = vaultSession(contents);
    await s.scanAll();
    const rig = timerRig(s);
    const target = s.index.getTasks().find(t => t.content === '対象')!;
    const timer = await begin(rig, timerOn(target, mode, 'countup', s.recorder.startAnchor(target) ?? undefined), target);
    return { s, contents, timer, rig };
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
        const { s, contents, timer, rig } = await startedAt9('child');
        // 書けた時点で尻尾はその行の錨。
        expect(openLines(contents.get(FILE)!)).toEqual([expect.stringContaining(`^${timer.tail}`)]);
        await s.settle(FILE);

        vi.setSystemTime(at(9, 10));
        Notice.messages.length = 0;
        await rig.lifecycle.stop(timer, 'close');
        await settleAll(s);

        expect(Notice.messages).toHaveLength(1);
        expect(rig.board.has(timer)).toBe(false);
        const text = contents.get(FILE)!;
        expect(records(text)).toEqual(['09:00>09:10']);
        expect(openLines(text)).toEqual([]);
        expect(text.split('\n').filter(l => l.includes('@2026-09-21T09:'))).toHaveLength(1);
        s.dispose();
    });

    for (const mode of ['child', 'self'] as const) {
        it(`${mode}, session 2: ⏸ closes the resumed line, and the records are 09:00>09:10 then 09:20>09:30`, async () => {
            const { s, contents, timer, rig } = await startedAt9(mode);
            await s.settle(FILE);
            vi.setSystemTime(at(9, 10));
            await rig.lifecycle.stop(timer, 'suspend');
            await settleAll(s);
            expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10']);

            vi.setSystemTime(at(9, 20));
            const firstTail = timer.tail;
            // 再開の行が書けた時点で、尻尾は新しい行。
            await rig.lifecycle.resume(timer);
            expect(timer.session.kind).toBe('running');
            expect(timer.tail).not.toBe(firstTail);
            await settleAll(s);
            expect(openLines(contents.get(FILE)!)).toHaveLength(1);

            vi.setSystemTime(at(9, 30));
            Notice.messages.length = 0;
            await rig.lifecycle.stop(timer, 'suspend');
            await settleAll(s);

            expect(Notice.messages).toHaveLength(1);
            expect(timer.session).toEqual({ kind: 'suspended' });
            expect(timer.recorded).toEqual({ seconds: 1200, count: 2 });
            const text = contents.get(FILE)!;
            expect(records(text)).toEqual(['09:00>09:10', '09:20>09:30']);
            expect(openLines(text)).toEqual([]);
            expect(text.split('\n').filter(l => l.includes('T09:20'))).toHaveLength(1);
            s.dispose();
        });
    }
});
