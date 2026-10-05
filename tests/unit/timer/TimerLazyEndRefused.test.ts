import { describe, it, expect, afterEach, vi } from 'vitest';
import { statedDates } from '../../../src/utils/TaskDates';
import { DateUtils } from '../../../src/utils/DateUtils';
import { Notice } from 'obsidian';
import type { RecordMode, TimerState } from '../../../src/timer/TimerState';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { begin, timerOn, timerRig, type TimerRig } from '../helpers/timerRig';

/**
 * end の書き足しが拒否されても、門（`TimerRuntime.lazyEndFloorMs`）は決めた次の
 * 見直しの時刻へ進む。門はメモリの上だけの「次にいつ見直すか」の予定で、状態
 * ではない。end の真の値は見直すたびにファイルから読み直すので、拒否された
 * 書き足しは次の見直しで古い end を読んでまた書く。拒否が続いても毎 tick は
 * 書き直さず、通知は見直しごとに1回。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';
const at = (h: number, m: number, s = 0) => new Date(2026, 8, 21, h, m, s);

/** 09:00 に始めて、実効 end（開始時刻）を過ぎた 09:10 の今も走っているタイマー。 */
async function runningPastEnd(mode: RecordMode) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', ''].join('\n')]]);
    const s = vaultSession(contents);
    await s.scanAll();
    const rig = timerRig(s);
    const target = s.index.getTasks().find(t => t.content === '対象')!;
    const timer = await begin(rig, timerOn(target, mode, 'countup', s.recorder.startAnchor(target) ?? undefined), target);
    await s.settle(FILE);
    expect(rig.runtime.lazyEndFloorMs.has(timer.id)).toBe(false);

    // 実効 end は行の end、無ければ開始時刻とする（既定の長さを持ち込まない）。
    s.plugin.getTaskReadService = () => ({
        getDisplayTask: (id: string) => {
            const t = s.index.getTask(id);
            return t && { ...t, stated: statedDates(t), span: { startMs: 0, endMs: DateUtils.toDateTime(t.endDate ?? t.startDate!, t.endTime ?? t.startTime!).getTime() } };
        },
    });
    vi.setSystemTime(at(9, 10));
    return { s, contents, timer, rig };
}

/** これ以後の `vault.process` をすべて例外で落とし、呼ばれた回数を数える。 */
function refuseAllWrites(s: VaultSession) {
    const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
    const calls = { n: 0 };
    vault.process = async () => { calls.n++; throw new Error('refused'); };
    return calls;
}

async function tickAndSettle(rig: TimerRig, timer: TimerState, s: VaultSession) {
    rig.lifecycle.tick(Date.now());
    await vi.waitFor(() => {
        expect(rig.runtime.extending.has(timer.id)).toBe(false);
    });
    await s.settle(FILE);
}

describe('a refused end extension waits for the next look', () => {
    afterEach(() => vi.useRealTimers());

    for (const mode of ['self', 'child'] as const) {
        it(`${mode}: ticks until the next look write and tell once`, async () => {
            const { s, timer, rig } = await runningPastEnd(mode);
            const writes = refuseAllWrites(s);
            Notice.messages.length = 0;

            for (let i = 0; i < 20; i++) {
                vi.setSystemTime(at(9, 10, i));
                await tickAndSettle(rig, timer, s);
            }

            expect(writes.n).toBe(1);
            expect(Notice.messages).toHaveLength(1);
            const floor = rig.runtime.lazyEndFloorMs.get(timer.id)!;
            expect(floor).toBeGreaterThan(at(9, 10, 19).getTime());

            // 次の見直しで、ファイルの古い end を読んでまた書く。
            vi.setSystemTime(new Date(floor));
            await tickAndSettle(rig, timer, s);
            expect(writes.n).toBe(2);
            expect(Notice.messages).toHaveLength(2);
            s.dispose();
        });
    }
});
