import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { begin, timerOn, timerRig } from '../helpers/timerRig';

/**
 * タイマーが書く行はどれも錨を付けて書き、書けたらそれが尻尾になる。尻尾を
 * 見失ったときの予備の記録も同じで、置き場所（対象の先頭の子）は変えない。
 * 走行中の行を外で消してから ⏸ を押すと、予備の記録が先頭の子に書かれて尻尾に
 * なり、次の ▶ の行はその隣（記録より下）に並ぶ。
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
};

const FILE = 'notes/a.md';
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

async function settleAll(s: VaultSession) {
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
    }
}

const lines = (contents: Map<string, string>) => contents.get(FILE)!.split('\n').filter(l => l.trim() !== '');

describe('a record written after the running line was lost becomes the tail', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('the running line is deleted, then ⏸ and ▶: the next line sits below the record, and ■ closes it', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n')]]);
        const s = vaultSession(contents);
        await s.scanAll();
        const rig = timerRig(s);
        const target = s.index.getTasks().find(t => t.content === '対象')!;
        const timer = await begin(rig, timerOn(target, 'child', 'countup', s.recorder.startAnchor(target) ?? undefined), target);
        await settleAll(s);
        expect(timer.tail).not.toBeNull();

        // 外で走行中の行を消す。
        const running = timer.tail!;
        contents.set(FILE, contents.get(FILE)!.split('\n').filter(l => !l.includes(`^${running}`)).join('\n'));
        await s.scanAll();

        vi.setSystemTime(at(9, 10));
        await rig.lifecycle.stop(timer, 'suspend');
        await settleAll(s);
        expect(timer.session).toEqual({ kind: 'suspended' });
        const record = lines(contents).findIndex(l => l.includes('@2026-09-21T09:00>09:10'));
        expect(record).toBe(1);
        // 予備の記録も錨を持ち、尻尾になる。
        expect(timer.tail).not.toBe(running);
        expect(lines(contents)[record]).toMatch(new RegExp(`\\^${timer.tail}$`));

        vi.setSystemTime(at(9, 20));
        await rig.lifecycle.resume(timer);
        await settleAll(s);
        expect(timer.session.kind).toBe('running');
        const next = lines(contents).findIndex(l => /@2026-09-21T09:20(?!>)/.test(l));
        expect(next).toBeGreaterThan(record);

        vi.setSystemTime(at(9, 30));
        await rig.lifecycle.stop(timer, 'close');
        await settleAll(s);
        const after = lines(contents);
        expect(after.filter(l => /@2026-09-21T\d\d:\d\d(?!>)/.test(l))).toEqual([]);
        expect(after.map(l => l.match(/T(\d\d:\d\d>\d\d:\d\d)/)?.[1]).filter(Boolean)).toEqual(['09:00>09:10', '09:20>09:30']);
        s.dispose();
    });
});
