import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import type { RecordMode, TimerState } from '../../../src/timer/TimerState';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { begin, timerOn, timerRig, type TimerRig } from '../helpers/timerRig';
import { rowOf } from '../helpers/anchoredRow';

/**
 * ▶ は新しい走行中の行を尻尾の兄弟に書き、書けてから走る（`TimerLifecycle.resume`）。
 * 行か、中断中に打った名前を書けなければ、何も動かずに中断のまま残る。通知は
 * 書き込みの層の1回だけ。
 *
 * 書く前に走り出すと、尻尾は1本目の書き終えた記録を指したまま走り、2本目の end の
 * 書き足しと名前が1本目の記録を書き換える（child と self の両方）。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

/** 09:00 に始めて 09:10 に中断した、1 本目を記録済みのタイマー。 */
async function suspendedAfterFirst(mode: RecordMode): Promise<{ s: VaultSession; contents: Map<string, string>; rig: TimerRig; timer: TimerState }> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
    const s = vaultSession(contents);
    await s.scanAll();
    const rig = timerRig(s);
    const target = s.index.getTasks().find(t => t.content === '対象')!;
    const timer = await begin(rig, timerOn(target, mode, 'countup', s.recorder.startAnchor(target)!), target);
    // 1 本目の行を書けた時点で、尻尾はその行（self は対象の行そのもの）。
    expect(timer.tail).not.toBeNull();
    expect(contents.get(FILE)).toContain(`^${timer.tail}`);
    await s.settle(FILE);
    vi.setSystemTime(at(9, 10));
    await rig.lifecycle.stop(timer, 'suspend');
    await s.settle(FILE);
    expect(timer.session).toEqual({ kind: 'suspended' });
    expect(contents.get(FILE)).toContain('@2026-09-21T09:00>09:10');
    return { s, contents, rig, timer };
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

async function resumeAndWait(s: VaultSession, rig: TimerRig, timer: TimerState) {
    await rig.lifecycle.resume(timer);
    expect(rig.runtime.busy.has(timer.id)).toBe(false);
    await s.settle(FILE);
}

/** end の書き足しが読むだけの読み取り口。 */
function withReadService(s: VaultSession) {
    s.plugin.getTaskReadService = () => ({
        getDisplayTask: (id: string) => {
            const t = s.index.getTask(id);
            return t && { ...t, effectiveEndDate: t.endDate ?? t.startDate, effectiveEndTime: t.endTime ?? t.startTime };
        },
    });
}

const records = (text: string) => [...text.matchAll(/@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);

describe('a resume whose line cannot be written stays suspended', () => {
    afterEach(() => vi.useRealTimers());

    for (const mode of ['child', 'self'] as const) {
        it(`${mode}: nothing moves, with one notice, and the file is left as it was`, async () => {
            const { s, contents, rig, timer } = await suspendedAfterFirst(mode);
            const afterFirst = contents.get(FILE)!;
            const before = structuredClone(timer);

            vi.setSystemTime(at(9, 20));
            failNextWrites(s, 1);
            Notice.messages.length = 0;
            await resumeAndWait(s, rig, timer);

            expect(Notice.messages).toHaveLength(1);
            expect(timer).toEqual(before);
            // 走っているタイマーは無いままなので、次のタスクの提案も出たまま。
            expect(rig.board.idle).not.toBeNull();
            expect(contents.get(FILE)).toBe(afterFirst);
            s.dispose();
        });

        it(`${mode}: ▶ again writes the line, and session 2's end and name go to it, not to 09:00>09:10`, async () => {
            const { s, contents, rig, timer } = await suspendedAfterFirst(mode);
            const firstTail = timer.tail;

            vi.setSystemTime(at(9, 20));
            failNextWrites(s, 1);
            await resumeAndWait(s, rig, timer);
            expect(timer.session).toEqual({ kind: 'suspended' });

            vi.setSystemTime(at(9, 30));
            Notice.messages.length = 0;
            await resumeAndWait(s, rig, timer);
            expect(Notice.messages).toHaveLength(0);
            expect(timer.session.kind).toBe('running');
            expect(timer.clock).toEqual({ kind: 'running', startMs: at(9, 30).getTime() });
            expect(rig.board.idle).toBeNull();
            // 尻尾は新しい行へ移った。
            expect(timer.tail).not.toBeNull();
            expect(timer.tail).not.toBe(firstTail);

            // 走行中（2本目）: end の書き足しと名前の書き込み。
            withReadService(s);
            vi.setSystemTime(at(9, 45));
            await s.recorder.extendRunningSession(timer);
            await s.settle(FILE);
            rig.board.dispatch(timer, { type: 'drafted', draft: '2本目の作業' });
            expect(await rig.content.flush(timer)).toBe(true);
            await s.settle(FILE);

            const running = contents.get(FILE)!;
            const firstLine = running.split('\n').find(l => l.includes('09:00>09:10'))!;
            expect(firstLine).not.toContain('2本目の作業');
            // 09:45 の書き足しは 2 本目の行の end を 09:50 まで延ばす。
            const secondLine = running.split('\n').find(l => l.includes('T09:30>09:50'))!;
            expect(secondLine).toContain('2本目の作業');

            vi.setSystemTime(at(9, 50));
            await rig.lifecycle.stop(timer, 'suspend');
            await s.settle(FILE);
            expect(records(contents.get(FILE)!)).toEqual(['09:00>09:10', '09:30>09:50']);
            expect(timer.recorded).toEqual({ seconds: 600 + 1200, count: 2 });
            s.dispose();
        });
    }

    it('a name typed while suspended, on a note that cannot be written: one notice, still suspended', async () => {
        const { s, contents, rig, timer } = await suspendedAfterFirst('child');
        const afterFirst = contents.get(FILE)!;
        rig.board.dispatch(timer, { type: 'drafted', draft: '中断中に直した名前' });

        const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
        const real = vault.process;
        vault.process = async () => { throw new Error('disk full'); };
        vi.setSystemTime(at(9, 20));
        Notice.messages.length = 0;
        await resumeAndWait(s, rig, timer);

        expect(Notice.messages).toHaveLength(1);
        expect(timer.session).toEqual({ kind: 'suspended' });
        expect(timer.draft).toBe('中断中に直した名前');
        expect(contents.get(FILE)).toBe(afterFirst);

        // 書けるようになれば、もう一度 ▶ で名前も行も書く。名前は直前の記録の行宛て。
        vault.process = real;
        Notice.messages.length = 0;
        await resumeAndWait(s, rig, timer);
        expect(Notice.messages).toHaveLength(0);
        expect(timer.session.kind).toBe('running');
        expect(timer.draft).toBeNull();
        const text = contents.get(FILE)!;
        expect(text.split('\n').find(l => l.includes('09:00>09:10'))).toContain('中断中に直した名前');
        s.dispose();
    });
});

describe('the target row is the tail of a self timer in its first session only', () => {
    afterEach(() => vi.useRealTimers());

    it('the target row is the tail from the start write through the suspend; the resumed session 2 moves the tail off it', async () => {
        const { s, rig, timer } = await suspendedAfterFirst('self');
        const anchor = timer.subject.kind === 'task' ? timer.subject.anchor : '';
        const target = s.index.getTaskByAnchor(FILE, anchor)!;

        // 記録を書き終えても、対象の行がまだ尻尾。
        expect(timer.tail).toBe(anchor);
        expect(rowOf(await s.recorder.resolveTailRecord(timer))?.id).toBe(target.id);

        // 再開（2 本目）で尻尾は新しい行へ移り、対象の行はもう尻尾ではない。
        vi.setSystemTime(at(9, 20));
        await resumeAndWait(s, rig, timer);
        expect(timer.tail).not.toBe(anchor);
        const tail = rowOf(await s.recorder.resolveTailRecord(timer));
        // 名前は対象タスクから継ぐので同じ「対象」だが、行そのものはもう対象の行ではない。
        expect(tail?.content).toContain('対象');
        expect(tail?.blockId).toBe(timer.tail);
        expect(tail?.line).not.toBe(target.line);
        // 対象の錨は走っている間ずっと残る。
        expect(s.index.getTaskByAnchor(FILE, anchor)).toBeDefined();
        s.dispose();
    });
});
