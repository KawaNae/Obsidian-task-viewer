import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { widgetOver } from '../helpers/timerRig';
import { readSeconds } from '../../../src/timer/TimerClock';

/**
 * 開始の命令は押した瞬間に走り出す（論点10）。「子として記録」もデイリーノートの
 * タイマーも、開いたまま待つ状態を持たない。1 本目の行の start は押した時刻で、
 * 時計もそこから数える。
 */
const FILE = 'notes/a.md';
const at = (h: number, m: number) => new Date(2026, 8, 21, h, m, 0);

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

describe('a start runs from the press', () => {
    let s: VaultSession;
    let contents: Map<string, string>;

    beforeEach(async () => {
        stubWindow();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
        contents = new Map([[FILE, ['- [ ] 器 @2026-09-21', ''].join('\n')]]);
        s = vaultSession(contents);
        await s.scanAll();
    });
    afterEach(() => {
        s.dispose();
        vi.useRealTimers();
    });

    it('track as child: running at once, and the first line starts at the press', async () => {
        const widget = widgetOver(s);
        const task = s.index.getTasks().find(t => t.content === '器')!;

        widget.startTimer(task, 'child', { kind: 'countup' });

        const [timer] = widget.board.values();
        expect(timer.session).toEqual({ kind: 'running', from: 0 });
        expect(timer.clock).toEqual({ kind: 'running', startMs: at(9, 0).getTime() });

        vi.setSystemTime(at(9, 3));
        await vi.waitFor(() => expect(timer.tail).not.toBeNull());
        expect(readSeconds(timer.clock, Date.now())).toBe(180);
        const child = contents.get(FILE)!.split('\n').find(line => line.includes(`^${timer.tail}`))!;
        expect(child).toMatch(/^\s+- \[ \] 器 @2026-09-21T09:00 /);
    });

    it('a daily note timer: running at once, and its first line starts at the press', async () => {
        const widget = widgetOver(s);
        const put: string[] = [];
        s.ops.putInDailyNote = async (_date: string, line: string) => { put.push(line); return { written: true, path: 'daily/2026-09-21.md' }; };

        widget.startTimer({ daily: '2026-09-21' }, 'child', { kind: 'pomodoro' });

        const [timer] = widget.board.values();
        expect(timer.subject).toEqual({ kind: 'daily', date: '2026-09-21' });
        expect(timer.session).toEqual({ kind: 'running', from: 0 });
        expect(timer.clock).toEqual({ kind: 'running', startMs: at(9, 0).getTime() });

        vi.setSystemTime(at(9, 1));
        await vi.waitFor(() => expect(timer.file).toBe('daily/2026-09-21.md'));
        expect(put).toHaveLength(1);
        expect(put[0]).toMatch(/^- \[ \] .*@2026-09-21T09:00 \^/);
        expect(timer.session.kind).toBe('running');
    });
});
