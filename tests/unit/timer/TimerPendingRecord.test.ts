import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { TimerPersistence, STORAGE_VERSION } from '../../../src/timer/TimerPersistence';
import type { TimerWidget } from '../../../src/timer/TimerWidget';
import type { TimerState } from '../../../src/timer/TimerState';
import { t } from '../../../src/i18n';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { widgetOver } from '../helpers/timerRig';

/**
 * 止めたが記録していない走行は、記録の区切り `session: { kind: 'pending', record }`
 * として残る（記録待ち）。
 *
 * 出口（⏸、■、ポモドーロの周の終わり）は、時計を止めて記録を固定し（`stopped`）、
 * 保存してから書く。書けたら押した出口の行き先へ進む。書けなければ何も戻さず、
 * 状態がそのまま「記録待ち」を言う。再読み込みをまたいでも、固定した時刻と長さで
 * 書き直す。
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

/** 保存に在るタイマー（1 本だけ）。 */
function saved(): TimerState | undefined {
    const key = [...store.keys()].find(k => k.startsWith(`task-viewer.active-timers.v${STORAGE_VERSION}:`));
    const raw = key ? store.get(key) : undefined;
    return raw ? (JSON.parse(raw) as { timers: TimerState[] }).timers[0] : undefined;
}

/** 操作列のボタンのラベル。 */
function controls(widget: TimerWidget, timer: TimerState): string[] {
    const labels: string[] = [];
    const make = (): unknown => ({
        createEl: () => make(),
        createSpan: (options?: { text?: string }) => {
            if (options?.text) labels.push(options.text);
            return make();
        },
    });
    (widget as unknown as { renderer: { renderControls(c: unknown, t: TimerState): void } }).renderer.renderControls(make(), timer);
    return labels;
}

/** 次に呼ばれる `vault.process` を `count` 回だけ例外で落とす。落とす前に `seen` を呼ぶ。 */
function failNextWrites(s: VaultSession, count: number, seen?: () => void) {
    const vault = (s.app as unknown as { vault: { process: (...a: unknown[]) => unknown } }).vault;
    const real = vault.process;
    let left = count;
    vault.process = async (...a: unknown[]) => {
        seen?.();
        if (left > 0) { left--; throw new Error('disk full'); }
        return real(...a);
    };
}

/** 09:00 に child で始めたタイマー。1 本目の行を書き終えている。 */
async function running(contents: Map<string, string>, kind: 'countup' | 'pomodoro' = 'countup') {
    const s = vaultSession(contents);
    await s.scanAll();
    const widget = widgetOver(s);
    widget.startTimer(s.index.getTasks().find(task => task.content === '対象')!, 'child', { kind });
    const [timer] = widget.board.values();
    await vi.waitFor(() => expect(timer.tail).not.toBeNull());
    await s.settle(FILE);
    return { s, widget, timer };
}

/** 保存から戻す、次の plugin の読み込み。 */
async function reload(contents: Map<string, string>) {
    const s = vaultSession(contents);
    await s.scanAll();
    const widget = widgetOver(s);
    const { timers, idle } = new TimerPersistence(s.app).restore();
    widget.board.restore(timers, idle);
    return { s, widget, timer: widget.board.values()[0] };
}

const notes = () => new Map([[FILE, ['- [ ] 対象 @2026-09-21', ''].join('\n')]]);
const recorded = (text: string) => [...text.matchAll(/- \[x\] .*@2026-09-21T(\d\d:\d\d)>(\d\d:\d\d)/g)].map(m => `${m[1]}>${m[2]}`);

describe('a record that could not be written is kept as a state, saved before the write', () => {
    beforeEach(() => {
        store.clear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at(9, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('⏸ that cannot be written: the record is fixed and saved before the write, and nothing moves on', async () => {
        const contents = notes();
        const { s, widget, timer } = await running(contents);
        const before = contents.get(FILE)!;

        vi.setSystemTime(at(9, 10));
        let savedAtWrite: TimerState | undefined;
        failNextWrites(s, 1, () => { savedAtWrite ??= saved(); });
        Notice.messages.length = 0;
        await widget.lifecycle.stop(timer, 'suspend');
        widget.board.flush();

        const fixed = { kind: 'pending', record: { endMs: at(9, 10).getTime(), seconds: 600, then: 'suspend' } };
        // 書く前に固定して保存している。
        expect(savedAtWrite?.session).toEqual(fixed);
        expect(timer.session).toEqual(fixed);
        // 時計は止まり、中断にも記録済みにもならない。
        expect(timer.clock).toEqual({ kind: 'frozen', seconds: 600 });
        expect(timer.recorded).toEqual({ seconds: 0, count: 0 });
        expect(saved()?.session).toEqual(fixed);
        expect(Notice.messages).toHaveLength(1);
        expect(contents.get(FILE)).toBe(before);
        s.dispose();
    });

    it('after a reload, ■ writes the record fixed at 09:10, not at the time it is pressed', async () => {
        const contents = notes();
        const first = await running(contents);
        vi.setSystemTime(at(9, 10));
        failNextWrites(first.s, 1);
        await first.widget.lifecycle.stop(first.timer, 'suspend');
        first.widget.board.flush();
        first.s.dispose();

        vi.setSystemTime(at(9, 40));
        const next = await reload(contents);
        const timer = next.timer;
        expect(timer.session).toEqual({ kind: 'pending', record: { endMs: at(9, 10).getTime(), seconds: 600, then: 'suspend' } });
        expect(timer.clock).toEqual({ kind: 'frozen', seconds: 600 });
        // 記録待ちの操作列は ⏸ と ■。
        expect(controls(next.widget, timer)).toEqual([t('timer.suspend'), t('timer.finish')]);

        await next.widget.lifecycle.stop(timer, 'close');
        await next.s.settle(FILE);
        expect(recorded(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        expect(next.widget.board.has(timer)).toBe(false);
        next.s.dispose();
    });

    it('⏸ again after a failed ■ records with the same time and then suspends', async () => {
        const contents = notes();
        const { s, widget, timer } = await running(contents);
        vi.setSystemTime(at(9, 10));
        failNextWrites(s, 1);
        await widget.lifecycle.stop(timer, 'close');
        expect(timer.session).toMatchObject({ kind: 'pending', record: { then: 'close' } });

        vi.setSystemTime(at(9, 25));
        await widget.lifecycle.stop(timer, 'suspend');
        await s.settle(FILE);
        widget.board.flush();
        expect(recorded(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        expect(timer.session).toEqual({ kind: 'suspended' });
        expect(timer.recorded).toEqual({ seconds: 600, count: 1 });
        expect(saved()?.session).toEqual({ kind: 'suspended' });
        s.dispose();
    });

    it('a pomodoro whose last segment filled and could not be written waits, and ■ writes the end it reached', async () => {
        const contents = notes();
        const { s, widget, timer } = await running(contents, 'pomodoro');
        if (timer.measure.type !== 'interval') throw new Error('not a pomodoro');
        widget.board.dispatch(timer, {
            type: 'retimed',
            groups: [{ repeatCount: 1, segments: [{ label: 'Work', durationSeconds: 600, type: 'work' }] }],
        });

        // tick は時間の表示を進める。描く項目の無い器を渡す。
        widget.ensureContainer = () => ({ querySelector: () => null }) as unknown as HTMLElement;
        vi.setSystemTime(at(9, 12));
        failNextWrites(s, 1);
        widget.lifecycle.tick(at(9, 12).getTime());
        await vi.waitFor(() => expect(timer.session.kind).toBe('pending'));
        await vi.waitFor(() => expect(widget.runtime.busy.size).toBe(0));
        expect(timer.session).toEqual({ kind: 'pending', record: { endMs: at(9, 10).getTime(), seconds: 600, then: 'close' } });
        expect(widget.board.has(timer)).toBe(true);

        vi.setSystemTime(at(9, 30));
        await widget.lifecycle.stop(timer, 'close');
        await s.settle(FILE);
        expect(recorded(contents.get(FILE)!)).toEqual(['09:00>09:10']);
        expect(widget.board.has(timer)).toBe(false);
        s.dispose();
    });
});
