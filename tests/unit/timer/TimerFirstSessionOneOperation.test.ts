import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import type { TimerState } from '../../../src/timer/TimerState';
import type { TimerWidget } from '../../../src/timer/TimerWidget';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { widgetOver } from '../helpers/timerRig';

/**
 * 開始の書き込み（1 本目の行）も、1 つのタイマーの 1 操作
 * （`TimerWidget.startTimer` → `TimerLifecycle.begin` → `exclusive`）。往復中に
 * 押された ■ や ✕ は、ほかの往復中の操作と同じく捨てる。
 *
 * 通せば、■ は書きかけの行の横に記録を1行足して閉じ、✕ はまだ無い行を消しに
 * 行って閉じる。どちらも、あとから書き上がった走行中の行がノートに残る。
 */
function stubWindow(): void {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
        setInterval: () => 1, clearInterval: () => { }, setTimeout, clearTimeout,
        addEventListener: () => { }, removeEventListener: () => { },
        localStorage: {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        },
    };
}
const FILE = 'notes/a.md';
const ORIGINAL = ['- [ ] 対象 @2026-09-21', '- [ ] 下のタスク @2026-09-21', ''].join('\n');
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

/** 実物の TimerWidget で、09:00 に「子として記録」を始めた直後（1 本目の行は往復中）。 */
async function started(): Promise<{ s: VaultSession; contents: Map<string, string>; widget: TimerWidget; timer: TimerState }> {
    stubWindow();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(9, 0));
    const contents = new Map([[FILE, ORIGINAL]]);
    const s = vaultSession(contents);
    await s.scanAll();
    const widget = widgetOver(s);
    const target = s.index.getTasks().find(t => t.content === '対象')!;
    widget.startTimer(target, 'child', { kind: 'countup' });
    const [timer] = widget.board.values();
    return { s, contents, widget, timer };
}

async function settleAll(s: VaultSession) {
    for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 0));
        await s.settle(FILE);
    }
}

/** 開始の書き込みが済むまで待つ（行を書き、尻尾として引き受けた）。 */
async function firstLineLanded(s: VaultSession, widget: TimerWidget, timer: TimerState) {
    await vi.waitFor(() => {
        expect(timer.tail).not.toBeNull();
        expect(s.index.getTaskByAnchor(timer.file, timer.tail!)).toBeDefined();
        expect(widget.runtime.busy.has(timer.id)).toBe(false);
    });
    await settleAll(s);
}

const records = (text: string) => [...text.matchAll(/@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);
/** 開始時刻だけを持つ、走行中の行。 */
const openLines = (text: string) => text.split('\n').filter(l => /@2026-09-21T\d\d:\d\d(?!>)/.test(l));

describe('a stop or a discard pressed while the start write is on its way is dropped', () => {
    afterEach(() => vi.useRealTimers());

    it('■ during the start write is dropped: the timer runs on its line, and ■ afterwards leaves one closed line', async () => {
        const { s, contents, widget, timer } = await started();
        Notice.messages.length = 0;
        vi.setSystemTime(at(9, 5));
        await widget.lifecycle.stop(timer, 'close');
        await firstLineLanded(s, widget, timer);

        expect(Notice.messages).toEqual([]);
        expect(widget.board.has(timer)).toBe(true);
        expect(timer.session).toEqual({ kind: 'running', from: 0 });
        expect(timer.clock.kind).toBe('running');
        expect(timer.recorded.count).toBe(0);
        expect(records(contents.get(FILE)!)).toEqual([]);
        expect(openLines(contents.get(FILE)!)).toHaveLength(1);

        vi.setSystemTime(at(9, 10));
        await widget.lifecycle.stop(timer, 'close');
        await settleAll(s);

        expect(Notice.messages).toHaveLength(1);
        expect(widget.board.has(timer)).toBe(false);
        const text = contents.get(FILE)!;
        expect(records(text)).toEqual(['09:00>09:10']);
        expect(openLines(text)).toEqual([]);
        expect(text.split('\n').filter(l => l.includes('@2026-09-21T09:'))).toHaveLength(1);
        s.dispose();
    });

    it('✕ during the start write is dropped: the timer stays, and ✕ afterwards takes its line away', async () => {
        const { s, contents, widget, timer } = await started();
        Notice.messages.length = 0;
        expect(widget.lifecycle.close(timer, true)).toBe('closing');
        await firstLineLanded(s, widget, timer);

        expect(widget.board.has(timer)).toBe(true);
        expect(timer.session.kind).toBe('running');
        expect(openLines(contents.get(FILE)!)).toHaveLength(1);

        expect(widget.lifecycle.close(timer, true)).toBe('closing');
        await settleAll(s);

        expect(Notice.messages).toEqual([]);
        expect(widget.board.has(timer)).toBe(false);
        // 走行中の行も、開始の書き込みが対象の行に付けた錨も消えている。
        expect(contents.get(FILE)).toBe(ORIGINAL);
        s.dispose();
    });
});
