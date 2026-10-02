import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TimerBoard } from '../../../src/timer/TimerBoard';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerRuntime } from '../../../src/timer/TimerRuntime';
import type { TimerRecorder } from '../../../src/timer/TimerRecorder';
import { freeze, restart } from '../../../src/timer/TimerClock';
import { newTimerId, type TimerState } from '../../../src/timer/TimerState';
import { vaultSession } from '../helpers/vaultSession';
import { widgetOver } from '../helpers/timerRig';

/**
 * 次のタスクの提案（`board.idle`）はタイマーではなく、走っているタイマー（記録待ちを
 * 含む）が 1 本も無いときのウィジェットの表示である。
 *
 * - 出す: タイマーを閉じるか中断して、走っているタイマーが無くなったとき。
 *   **中断中は走っていない**と数える — 中断は手を止めた合図なので、中断した
 *   タイマーが残っていても提案を出す
 * - 消す: タイマーを始めたとき、▶ で再開したとき
 */

(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
};

/** `records` は記録の書き込みが書けるか。 */
function build(records = true) {
    const board = new TimerBoard({ persist: () => { }, render: () => { } });
    const recorder = {
        recordSessionEnd: async () => records,
        startNextSession: async () => true,
        discardRunningPlaceholder: async () => { },
        releaseAnchors: async () => { },
        extendRunningSession: async () => undefined,
    } as unknown as TimerRecorder;
    const content = { flush: async () => true, discard: () => { }, release: () => { } };
    const lifecycle = new TimerLifecycle({ board, runtime: new TimerRuntime(), recorder, content, renderTimes: () => { } });
    return { board, lifecycle };
}

function countup(board: TimerBoard, running = true): TimerState {
    const now = Date.now();
    const clock = restart(now - 60_000);
    const timer: TimerState = {
        id: newTimerId(),
        subject: { kind: 'task', anchor: 'box' },
        file: 'notes/a.md',
        name: 'a',
        color: '',
        mode: 'child',
        measure: { type: 'countup' },
        clock: running ? clock : freeze(clock, now),
        session: running ? { kind: 'running', from: 0 } : { kind: 'suspended' },
        tail: 'tail',
        owned: [],
        opening: null,
        recorded: { seconds: running ? 0 : 60, count: running ? 0 : 1 },
        priorStartMs: null,
        draft: null,
        expanded: true,
    };
    board.add(timer);
    return timer;
}

describe('the suggestion comes up when nothing runs', () => {
    let h: ReturnType<typeof build>;
    beforeEach(() => { h = build(); });

    it('comes up when the only timer is suspended', async () => {
        const timer = countup(h.board);
        await h.lifecycle.stop(timer, 'suspend');
        expect(timer.session).toEqual({ kind: 'suspended' });
        expect(h.board.idle).not.toBeNull();
    });

    it('stays away while another timer still runs', async () => {
        const a = countup(h.board);
        countup(h.board);
        await h.lifecycle.stop(a, 'suspend');
        expect(h.board.idle).toBeNull();
    });

    it('comes up when the running timer closes, though a suspended timer is still open', async () => {
        const suspended = countup(h.board, false);
        const running = countup(h.board);
        await h.lifecycle.stop(running, 'close');
        expect(h.board.has(running)).toBe(false);
        expect(h.board.has(suspended)).toBe(true);
        expect(h.board.idle).not.toBeNull();
    });

    it('comes up when a running timer is thrown away', async () => {
        const running = countup(h.board);
        expect(h.lifecycle.close(running, true)).toBe('closing');
        await vi.waitFor(() => expect(h.board.has(running)).toBe(false));
        expect(h.board.idle).not.toBeNull();
    });

    it('stays away while a timer waits to record: it holds a running line', async () => {
        const failing = build(false);
        const timer = countup(failing.board);

        await failing.lifecycle.stop(timer, 'suspend');
        expect(timer.session.kind).toBe('pending');
        expect(failing.board.idle).toBeNull();
    });

    it('keeps the time it came up when it is already up', async () => {
        const timer = countup(h.board);
        h.board.setIdle({ sinceMs: 1234 });
        await h.lifecycle.stop(timer, 'suspend');
        expect(h.board.idle).toEqual({ sinceMs: 1234 });
    });

    it('goes away when a suspended timer resumes', async () => {
        const timer = countup(h.board);
        await h.lifecycle.stop(timer, 'suspend');
        expect(h.board.idle).not.toBeNull();

        await h.lifecycle.resume(timer);
        expect(timer.session.kind).toBe('running');
        expect(h.board.idle).toBeNull();
    });
});

describe('the suggestion goes away when a timer starts', () => {
    it('the start command takes it down', async () => {
        const store = new Map<string, string>();
        (globalThis as unknown as { window: Record<string, unknown> }).window.localStorage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        };
        const s = vaultSession(new Map([['notes/a.md', '- [ ] 器 ^box\n']]));
        await s.scanAll();
        const widget = widgetOver(s);
        widget.board.setIdle({ sinceMs: Date.now() });

        widget.startTimer(s.index.getTasks()[0], 'child', { kind: 'countup' });

        expect(widget.board.idle).toBeNull();
        await vi.waitFor(() => expect(widget.board.values()[0].tail).not.toBeNull());
        s.dispose();
    });
});
