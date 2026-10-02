import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { STORAGE_VERSION } from '../../../src/timer/TimerPersistence';
import { TimerWidget } from '../../../src/timer/TimerWidget';
import type { TimerState } from '../../../src/timer/TimerState';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { widgetOver } from '../helpers/timerRig';

/**
 * 1 本目の行と再開の行は、書く前に「これから書く錨」（`opening`）を保存し、
 * 書けたら尻尾へ移す（`landed`）。再開は書けてから走行に移り、時計は押した時刻
 * から。往復の間は中断のまま。書く途中で再読み込みされたら、保存の `opening` を
 * 錨で引き、行が在れば尻尾にする — 推定でなく、ファイルに在る `^id` で答える。
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
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);
const keyOf = () => [...store.keys()].find(k => k.startsWith(`task-viewer.active-timers.v${STORAGE_VERSION}:`));

function saved(): TimerState | undefined {
    const key = keyOf();
    return key ? (JSON.parse(store.get(key)!) as { timers: TimerState[] }).timers[0] : undefined;
}

/** `vault.process` が呼ばれるたびに、書く前の姿を `seen` に渡す。 */
function watchWrites(s: VaultSession, seen: () => void) {
    const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
    const real = vault.process;
    vault.process = async (...a: unknown[]) => {
        seen();
        return real(...a);
    };
}

/** 対象の行に child で始め、1 本目の行を書き終えたタイマー。 */
async function started(s: VaultSession, widget: TimerWidget): Promise<TimerState> {
    widget.startTimer(s.index.getTasks().find(task => task.content === '対象')!, 'child', { kind: 'countup' });
    const [timer] = widget.board.values();
    await vi.waitFor(() => expect(timer.tail).not.toBeNull());
    await s.settle(FILE);
    widget.board.flush();
    return timer;
}

/**
 * 再読み込み: 保存から戻した widget。最初の索引の変化で、書く途中だった `opening` に
 * ファイルで答える（`activate` の予約）。
 */
function reloaded(contents: Map<string, string>) {
    const s = vaultSession(contents);
    const widget = new TimerWidget(s.app, { ...s.plugin, registerEvent: () => { } } as never);
    widget.render = () => { };
    widget.ensureContainer = () => ({ querySelector: () => null }) as unknown as HTMLElement;
    widget.activate();
    return { s, widget, timer: widget.board.values()[0] };
}

const notes = () => new Map([[FILE, ['- [ ] 対象 @2026-09-21', ''].join('\n')]]);

describe('the line a timer is about to write is saved as its opening, and becomes the tail once written', () => {
    beforeEach(() => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('the first line: the opening is saved before the write, and is the tail after it', async () => {
        const contents = notes();
        const s = vaultSession(contents);
        await s.scanAll();
        const widget = widgetOver(s);
        let atWrite: TimerState | undefined;
        watchWrites(s, () => { atWrite ??= saved(); });

        const timer = await started(s, widget);

        expect(typeof atWrite?.opening?.tail).toBe('string');
        expect(atWrite?.tail).toBeNull();
        expect(timer.tail).toBe(atWrite?.opening?.tail);
        expect(timer.opening).toBeNull();
        expect(contents.get(FILE)).toContain(`^${timer.tail}`);
        expect(saved()?.tail).toBe(timer.tail);
        expect(saved()?.opening).toBeNull();
        s.dispose();
    });

    it('▶ stays suspended while the line is written, then runs from the time it was pressed', async () => {
        const contents = notes();
        const s = vaultSession(contents);
        await s.scanAll();
        const widget = widgetOver(s);
        const timer = await started(s, widget);
        vi.setSystemTime(at(9, 10));
        await widget.lifecycle.stop(timer, 'suspend');
        await s.settle(FILE);
        const firstTail = timer.tail;

        vi.setSystemTime(at(9, 20));
        let atWrite: { saved?: TimerState; session: TimerState['session'] } | undefined;
        watchWrites(s, () => { atWrite ??= { saved: saved(), session: timer.session }; });
        const resumed = widget.lifecycle.resume(timer);
        // 往復の間は中断のまま。
        expect(timer.session).toEqual({ kind: 'suspended' });
        vi.setSystemTime(at(9, 21));
        await resumed;
        await s.settle(FILE);
        widget.board.flush();

        expect(atWrite?.session).toEqual({ kind: 'suspended' });
        expect(atWrite?.saved?.session).toEqual({ kind: 'suspended' });
        const opening = atWrite?.saved?.opening?.tail;
        expect(typeof opening).toBe('string');
        expect(opening).not.toBe(firstTail);

        expect(timer.session).toEqual({ kind: 'running', from: 0 });
        expect(timer.clock).toEqual({ kind: 'running', startMs: at(9, 20).getTime() });
        expect(timer.tail).toBe(opening);
        expect(timer.opening).toBeNull();
        expect(saved()?.opening).toBeNull();
        expect(saved()?.session.kind).toBe('running');
        s.dispose();
    });

    it('a reload between the write and the state: the saved opening is found by its ^id and becomes the tail', async () => {
        const contents = notes();
        const first = vaultSession(contents);
        await first.scanAll();
        const w1 = widgetOver(first);
        let atWrite: string | undefined;
        watchWrites(first, () => { atWrite ??= store.get(keyOf()!); });
        const before = await started(first, w1);
        first.dispose();
        // 行は書けたが、書けたあとの保存の前に落ちた。
        store.set(keyOf()!, atWrite!);
        const opening = (JSON.parse(atWrite!) as { timers: TimerState[] }).timers[0].opening!.tail;
        expect(contents.get(FILE)).toContain(`^${opening}`);

        const { s, widget, timer } = reloaded(contents);
        expect(timer.opening?.tail).toBe(opening);
        expect(timer.tail).toBeNull();

        await s.scanAll();
        await vi.waitFor(() => expect(timer.tail).toBe(opening));
        expect(timer.opening).toBeNull();
        // 書けた書き込みが付けた錨（1 本目の行と対象の行）も、書き込みの前の姿から当たる。
        const target = before.subject.kind === 'task' ? before.subject.anchor : '';
        expect(target).toMatch(/^tv-t-/);
        expect(contents.get(FILE)).toContain(`対象 @2026-09-21 ^${target}`);
        expect([...timer.owned].sort()).toEqual([opening, target].sort());
        widget.board.flush();
        expect(saved()?.tail).toBe(opening);
        expect(saved()?.opening).toBeNull();
        widget.destroy();
        s.dispose();
    });

    it('a reload after a write that did not land: the opening is let go and nothing becomes the tail', async () => {
        const contents = notes();
        const first = vaultSession(contents);
        await first.scanAll();
        const w1 = widgetOver(first);
        await started(first, w1);
        first.dispose();
        // 保存に、書かれなかった行の opening が残っている。
        const key = keyOf()!;
        const raw = JSON.parse(store.get(key)!) as { timers: TimerState[] };
        const tail = raw.timers[0].tail;
        raw.timers[0].opening = { tail: 'tv-t-never', owned: raw.timers[0].owned };
        store.set(key, JSON.stringify(raw));

        const { s, widget, timer } = reloaded(contents);
        await s.scanAll();
        await vi.waitFor(() => expect(timer.opening).toBeNull());
        expect(timer.tail).toBe(tail);
        widget.destroy();
        s.dispose();
    });
});

describe('a restored timer whose target cannot be found is kept, not closed', () => {
    beforeEach(() => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('the target row is gone after a reload: the widget stays, and ■ still closes the running line', async () => {
        const contents = notes();
        const first = vaultSession(contents);
        await first.scanAll();
        await started(first, widgetOver(first));
        first.dispose();
        // 外で対象の行が消された（走行中の行は残り、字下げが外れる）。
        contents.set(FILE, contents.get(FILE)!.split('\n').slice(1).map(l => l.trimStart()).join('\n'));

        const { s, widget, timer } = reloaded(contents);
        await s.scanAll();
        await new Promise(r => setTimeout(r, 30));
        await s.settle(FILE);
        expect(widget.board.has(timer)).toBe(true);

        vi.setSystemTime(at(9, 10));
        await widget.lifecycle.stop(timer, 'close');
        await s.settle(FILE);
        expect(contents.get(FILE)).toMatch(/- \[x\] .*@2026-09-21T09:00>09:10/);
        expect(widget.board.has(timer)).toBe(false);
        widget.destroy();
        s.dispose();
    });
});
