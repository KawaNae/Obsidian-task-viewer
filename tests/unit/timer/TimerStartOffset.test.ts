import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { TimerPersistence } from '../../../src/timer/TimerPersistence';
import type { RecordMode, TimerState } from '../../../src/timer/TimerState';
import type { TimerWidget } from '../../../src/timer/TimerWidget';
import { readSeconds } from '../../../src/timer/TimerClock';
import { progressOf } from '../../../src/timer/TimerProgress';
import { agoLabel, canOffsetStart, readOffsetInput, rememberedStart, startLabel } from '../../../src/timer/TimerStartOffset';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { widgetOver } from '../helpers/timerRig';

/**
 * 走っている区間の開始をずらす（かけ忘れたタイマーを、実際に始めた時刻から数える）。
 *
 * 先に走行の行の start を書き直し、書けてから時計を動かす（`TimerLifecycle.offsetStart`
 * の `shifted`）。規則は mode で分けないので、self の 1 本目、child、sibling、⏸→▶ の
 * あとの区間のどれでも、止めたときの記録の start がずらした時刻になる。
 */
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
    addEventListener: () => { }, removeEventListener: () => { },
    localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    },
};

const FILE = 'notes/a.md';
const DAY = '2026-09-30';
const at = (h: number, m: number, day = 30) => new Date(2026, 8, day, h, m, 0);

async function settleAll(s: VaultSession) {
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
    }
}

/** 次に呼ばれる `vault.process` を 1 回だけ例外で落とす。 */
function failNextWrite(s: VaultSession) {
    const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
    const real = vault.process;
    let left = 1;
    vault.process = async (...a: unknown[]) => {
        if (left > 0) { left--; throw new Error('disk full'); }
        return real(...a);
    };
}

/** 保存に在るタイマー（1 本だけ）。 */
function savedIn(persistence: TimerPersistence): Record<string, unknown> | undefined {
    const raw = store.get(persistence.storageKey());
    return raw ? (JSON.parse(raw) as { timers: Record<string, unknown>[] }).timers[0] : undefined;
}

const lines = (contents: Map<string, string>) => contents.get(FILE)!.split('\n').filter(l => l.trim() !== '');
/** 完了した記録の `start>end`（日付つき）。 */
const records = (contents: Map<string, string>) =>
    lines(contents).map(l => /^\s*- \[x\] .*@(\S+>\S+)/.exec(l)?.[1]).filter(Boolean);
const elapsed = (timer: TimerState) => readSeconds(timer.clock, Date.now());

/** `name` の行で、今、開始の命令（`TimerWidget.startTimer`）で countup か 25 分の countdown を始め、1 本目の行を書き終える。 */
async function started(
    note: string[],
    name: string,
    mode: RecordMode,
    kind: 'countup' | 'countdown' = 'countup',
): Promise<{ contents: Map<string, string>; s: VaultSession; widget: TimerWidget; timer: TimerState }> {
    const contents = new Map([[FILE, [...note, ''].join('\n')]]);
    const s = vaultSession(contents);
    await s.scanAll();
    const widget = widgetOver(s);
    const target = s.index.getTasks().find(t => t.content === name)!;
    widget.startTimer(target, mode, kind === 'countup' ? { kind } : { kind, seconds: 25 * 60 });
    const [timer] = widget.board.values();
    await vi.waitFor(() => {
        expect(timer.tail).not.toBeNull();
        expect(widget.runtime.busy.has(timer.id)).toBe(false);
    });
    await settleAll(s);
    return { contents, s, widget, timer };
}

describe('shifting the start of a running timer writes the running line, then moves the clock', () => {
    beforeEach(() => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(10, 20));
    });
    afterEach(() => vi.useRealTimers());

    it('self: the start overwritten at the start is remembered, and shifting to it records from it', async () => {
        const { contents, s, widget, timer } = await started([`- [ ] 設計 @${DAY}T10:00>11:00`], '設計', 'self');
        expect(timer.priorStartMs).toBe(at(10, 0).getTime());
        expect(lines(contents)[0]).toContain(`@${DAY}T10:20>11:20`);

        vi.setSystemTime(at(10, 25));
        expect(rememberedStart(timer, Date.now(), 0)).toBe(at(10, 0).getTime());
        await widget.lifecycle.offsetStart(timer, at(10, 0).getTime());
        await settleAll(s);
        // 走っている間の行も、ずらした start を示す。
        expect(lines(contents)[0]).toContain(`@${DAY}T10:00>11:20`);
        expect(timer.clock).toEqual({ kind: 'running', startMs: at(10, 0).getTime() });
        expect(elapsed(timer)).toBe(25 * 60);

        vi.setSystemTime(at(10, 50));
        await widget.lifecycle.stop(timer, 'close');
        await settleAll(s);
        expect(records(contents)).toEqual([`${DAY}T10:00>10:50`]);
        s.dispose();
    });

    it('child: the line written at the start is shifted, and the record keeps the shifted start', async () => {
        const { contents, s, widget, timer } = await started([`- [ ] 対象 @${DAY}`], '対象', 'child');
        expect(timer.priorStartMs).toBeNull();

        vi.setSystemTime(at(10, 25));
        await widget.lifecycle.offsetStart(timer, Date.now() - 15 * 60_000);
        await settleAll(s);
        expect(lines(contents)[1]).toMatch(new RegExp(`@${DAY}T10:10 \\^`));

        vi.setSystemTime(at(10, 40));
        await widget.lifecycle.stop(timer, 'close');
        await settleAll(s);
        expect(records(contents)).toEqual([`${DAY}T10:10>10:40`]);
        s.dispose();
    });

    it('sibling: the line added next to the completed run is shifted', async () => {
        const { contents, s, widget, timer } = await started(
            [`- [x] ⏱️ 対象 @${DAY}T09:00>09:30`], '⏱️ 対象', 'sibling');
        expect(timer.priorStartMs).toBeNull();

        vi.setSystemTime(at(10, 22));
        await widget.lifecycle.offsetStart(timer, at(10, 5).getTime());
        await settleAll(s);

        vi.setSystemTime(at(10, 45));
        await widget.lifecycle.stop(timer, 'close');
        await settleAll(s);
        expect(records(contents)).toEqual([`${DAY}T09:00>09:30`, `${DAY}T10:05>10:45`]);
        s.dispose();
    });

    it('after ⏸ and ▶: only the running session moves, and the remembered start is not offered', async () => {
        const { contents, s, widget, timer } = await started([`- [ ] 設計 @${DAY}T10:00>11:00`], '設計', 'self');

        vi.setSystemTime(at(10, 50));
        await widget.lifecycle.stop(timer, 'suspend');
        await settleAll(s);
        vi.setSystemTime(at(11, 10));
        await widget.lifecycle.resume(timer);
        await settleAll(s);
        expect(timer.session.kind).toBe('running');
        expect(rememberedStart(timer, Date.now(), 0)).toBeNull();

        // ▶ の押し忘れ: 前の区間の end より前へもずらせる（下限を置かない）。
        vi.setSystemTime(at(11, 12));
        await widget.lifecycle.offsetStart(timer, at(10, 45).getTime());
        await settleAll(s);

        vi.setSystemTime(at(11, 30));
        await widget.lifecycle.stop(timer, 'close');
        await settleAll(s);
        expect(records(contents)).toEqual([`${DAY}T10:20>10:50`, `${DAY}T10:45>11:30`]);
        s.dispose();
    });

    it('a time later than now is read as the day before, and the line keeps its end date', async () => {
        vi.setSystemTime(at(0, 10));
        const { contents, s, widget, timer } = await started([`- [ ] 夜 @${DAY}T00:00>01:00`], '夜', 'self');
        expect(lines(contents)[0]).toContain(`@${DAY}T00:10>01:10`);

        vi.setSystemTime(at(0, 15));
        const startMs = readOffsetInput('time', '23:50', Date.now());
        expect(startMs).toBe(at(23, 50, 29).getTime());
        await widget.lifecycle.offsetStart(timer, startMs!);
        await settleAll(s);
        expect(lines(contents)[0]).toContain(`@2026-09-29T23:50>${DAY}T01:10`);
        expect(elapsed(timer)).toBe(25 * 60);

        vi.setSystemTime(at(0, 30));
        await widget.lifecycle.stop(timer, 'close');
        await settleAll(s);
        expect(records(contents)).toEqual([`2026-09-29T23:50>${DAY}T00:30`]);
        s.dispose();
    });

    it('countdown: the time left shrinks by the shift, and goes over past zero', async () => {
        const { s, widget, timer } = await started([`- [ ] 対象 @${DAY}`], '対象', 'child', 'countdown');

        vi.setSystemTime(at(10, 21));
        await widget.lifecycle.offsetStart(timer, Date.now() - 10 * 60_000);
        expect(elapsed(timer)).toBe(10 * 60);
        expect(progressOf(timer.measure, elapsed(timer))).toMatchObject({ displaySeconds: 15 * 60, tone: 'work' });

        await widget.lifecycle.offsetStart(timer, Date.now() - 30 * 60_000);
        expect(progressOf(timer.measure, elapsed(timer))).toMatchObject({ displaySeconds: -5 * 60, tone: 'overtime' });
        s.dispose();
    });

    it('a shift whose line cannot be written moves nothing', async () => {
        const { contents, s, widget, timer } = await started([`- [ ] 対象 @${DAY}`], '対象', 'child');
        const before = contents.get(FILE);
        const clock = timer.clock;

        vi.setSystemTime(at(10, 25));
        failNextWrite(s);
        await widget.lifecycle.offsetStart(timer, at(10, 0).getTime());
        await settleAll(s);
        expect(contents.get(FILE)).toBe(before);
        expect(timer.clock).toEqual(clock);
        s.dispose();
    });

    it('a start in the future, or on a suspended timer, is not taken', async () => {
        const { contents, s, widget, timer } = await started([`- [ ] 対象 @${DAY}`], '対象', 'child');
        const before = contents.get(FILE);
        const clock = timer.clock;

        await widget.lifecycle.offsetStart(timer, at(10, 21).getTime());
        expect(timer.clock).toEqual(clock);
        expect(contents.get(FILE)).toBe(before);

        vi.setSystemTime(at(10, 30));
        await widget.lifecycle.stop(timer, 'suspend');
        await settleAll(s);
        const suspended = contents.get(FILE);
        const frozen = timer.clock;
        expect(suspended).not.toBe(before);
        await widget.lifecycle.offsetStart(timer, at(10, 0).getTime());
        await settleAll(s);
        expect(contents.get(FILE)).toBe(suspended);
        expect(timer.clock).toEqual(frozen);
        s.dispose();
    });
});

describe('the remembered start is saved with the timer', () => {
    beforeEach(() => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(10, 20));
    });
    afterEach(() => vi.useRealTimers());

    it('it is saved before the start is written, and read back after a reload', async () => {
        const contents = new Map([[FILE, [`- [ ] 設計 @${DAY}T10:00>11:00`, ''].join('\n')]]);
        const s = vaultSession(contents);
        await s.scanAll();
        const persistence = new TimerPersistence(s.app);
        const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
        const real = vault.process;
        let savedAtWrite: Record<string, unknown> | undefined;
        vault.process = async (...a: unknown[]) => { savedAtWrite ??= savedIn(persistence); return real(...a); };

        const widget = widgetOver(s);
        const target = s.index.getTasks().find(t => t.content === '設計')!;
        widget.startTimer(target, 'self', { kind: 'countup' });
        const [timer] = widget.board.values();
        await vi.waitFor(() => expect(timer.tail).not.toBeNull());
        await settleAll(s);
        expect(savedAtWrite?.priorStartMs).toBe(at(10, 0).getTime());
        widget.board.flush();
        s.dispose();

        // 再読み込み: 同じ vault の保存を読む。
        const next = vaultSession(contents);
        await next.scanAll();
        const { timers } = new TimerPersistence(next.app).restore();
        expect(timers).toHaveLength(1);
        expect(timers[0].priorStartMs).toBe(at(10, 0).getTime());
        next.dispose();
    });

    it('a timer saved without priorStartMs is not read', async () => {
        const { s, widget } = await started([`- [ ] 対象 @${DAY}`], '対象', 'child');
        widget.board.flush();
        const persistence = new TimerPersistence(s.app);
        const raw = JSON.parse(store.get(persistence.storageKey())!) as { timers: Record<string, unknown>[] };
        s.dispose();

        delete raw.timers[0].priorStartMs;
        store.set(persistence.storageKey(), JSON.stringify(raw));
        expect(new TimerPersistence(s.app).restore().timers).toHaveLength(0);
    });
});

describe('where a shift goes (TimerStartOffset)', () => {
    const now = at(10, 20).getTime();

    it('an amount is whole minutes back from now, 1 or more', () => {
        expect(readOffsetInput('minutes', '20', now)).toBe(at(10, 0).getTime());
        expect(readOffsetInput('minutes', ' ２０ ', now)).toBe(at(10, 0).getTime());
        expect(readOffsetInput('minutes', '0', now)).toBeNull();
        expect(readOffsetInput('minutes', '-5', now)).toBeNull();
        expect(readOffsetInput('minutes', '1.5', now)).toBeNull();
        expect(readOffsetInput('minutes', '9:40', now)).toBeNull();
        expect(readOffsetInput('minutes', '', now)).toBeNull();
    });

    it('a time is that time today, or the day before when it is later than now', () => {
        expect(readOffsetInput('time', '9:40', now)).toBe(at(9, 40).getTime());
        expect(readOffsetInput('time', '09:40', now)).toBe(at(9, 40).getTime());
        expect(readOffsetInput('time', '１０：１５', now)).toBe(at(10, 15).getTime());
        expect(readOffsetInput('time', '10:30', now)).toBe(at(10, 30, 29).getTime());
        expect(readOffsetInput('time', '24:00', now)).toBeNull();
        expect(readOffsetInput('time', '9:4', now)).toBeNull();
        expect(readOffsetInput('time', '20', now)).toBeNull();
        expect(readOffsetInput('time', '', now)).toBeNull();
    });

    it('the remembered start is offered while nothing is recorded yet, and only when it is past', () => {
        const timer = { recorded: { seconds: 0, count: 0 }, priorStartMs: at(10, 0).getTime() };
        expect(rememberedStart(timer, now, 0)).toBe(at(10, 0).getTime());
        expect(rememberedStart({ ...timer, recorded: { seconds: 600, count: 1 } }, now, 0)).toBeNull();
        expect(rememberedStart({ ...timer, priorStartMs: at(10, 30).getTime() }, now, 0)).toBeNull();
        expect(rememberedStart({ ...timer, priorStartMs: null }, now, 0)).toBeNull();
    });

    it('the remembered start is offered only within today, the day startHour divides', () => {
        const prior = (ms: number) => ({ recorded: { seconds: 0, count: 0 }, priorStartMs: ms });
        // 何か月も前の予定の start は出さない。
        expect(rememberedStart(prior(new Date(2026, 5, 1, 9, 0).getTime()), now, 0)).toBeNull();
        expect(rememberedStart(prior(at(23, 50, 29).getTime()), now, 0)).toBeNull();
        // 今日の区切りが 5 時なら、02:00 の今日は前日の 05:00 から始まる。
        const night = at(2, 0).getTime();
        expect(rememberedStart(prior(at(23, 50, 29).getTime()), night, 5)).toBe(at(23, 50, 29).getTime());
        expect(rememberedStart(prior(at(4, 59, 29).getTime()), night, 5)).toBeNull();
        expect(rememberedStart(prior(at(0, 30).getTime()), night, 0)).toBe(at(0, 30).getTime());
        expect(rememberedStart(prior(at(23, 50, 29).getTime()), night, 0)).toBeNull();
    });

    it('only a running countup or countdown can be shifted', () => {
        const running = { measure: { type: 'countup' as const }, session: { kind: 'running' as const, from: 0 } };
        expect(canOffsetStart(running)).toBe(true);
        expect(canOffsetStart({ ...running, measure: { type: 'countdown', totalSeconds: 1500 } })).toBe(true);
        expect(canOffsetStart({ ...running, measure: { type: 'interval', source: 'pomodoro', groups: [], at: { group: 0, repeat: 0, segment: 0, from: 0 } } })).toBe(false);
        expect(canOffsetStart({ ...running, session: { kind: 'suspended' } })).toBe(false);
        expect(canOffsetStart({ ...running, session: { kind: 'pending', record: { endMs: now, seconds: 1, then: 'close' } } })).toBe(false);
    });

    it('a start on another day says so: the day before by name, older ones by their date', () => {
        expect(startLabel(at(9, 5).getTime(), now)).toBe('09:05');
        expect(startLabel(at(23, 50, 29).getTime(), now)).toBe('yesterday 23:50');
        expect(startLabel(at(23, 50, 28).getTime(), now)).toBe('2026-09-28 23:50');
    });

    it('how long ago a start is, in minutes, and in hours and minutes from an hour on', () => {
        expect(agoLabel(at(9, 30).getTime(), now)).toBe('50 min ago');
        expect(agoLabel(now - 59_999, now)).toBe('0 min ago');
        expect(agoLabel(at(8, 15).getTime(), now)).toBe('2 h 5 min ago');
        expect(agoLabel(at(9, 20).getTime(), now)).toBe('1 h 0 min ago');
    });
});
