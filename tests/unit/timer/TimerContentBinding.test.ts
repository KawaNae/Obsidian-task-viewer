import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TimerContentBinding, CONTENT_WRITE_DEBOUNCE_MS } from '../../../src/timer/TimerContentBinding';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * content の正は**尻尾の行**ひとつだけで、widget の入力欄はその行の編集器である。
 *
 * v0.51.0 は widget 側にも値を持ち（`customLabel`）、md へ渡るのは行を書く一度きり
 * だったので、入力が常に 1 セッション遅れて記録された。ここで pin するのは「入力は
 * その場で尻尾の行へ届く」ことと、その周りの取りこぼし防止。
 *
 * DOM は使わない（unit の environment は node）。入力欄は value と activeElement
 * だけを持つ最小の代役で、打鍵は `oninput` を直接呼んで起こす。
 */

interface FakeInput {
    value: string;
    oninput: (() => void) | null;
    ownerDocument: { activeElement: unknown };
}

interface Harness {
    binding: TimerContentBinding;
    timer: TimerInstance;
    input: FakeInput;
    updates: { id: string; updates: Record<string, unknown> }[];
    /** 尻尾として返す行。undefined なら「書く相手がまだ無い」状態。 */
    setTail(task: Task | undefined): void;
    /** 入力欄にフォーカスがある状態にする。 */
    focus(): void;
}

const TAIL_ID = 'tv-inline:notes/a.md:blk:tv-t-1';

function tailLine(content: string): Task {
    return makeTask({ id: TAIL_ID, file: 'notes/a.md', line: 3, content, blockId: 'tv-t-1' });
}

function makeHarness(options: { tail?: Task | undefined } = {}): Harness {
    const updates: { id: string; updates: Record<string, unknown> }[] = [];
    let tail: Task | undefined = 'tail' in options ? options.tail : tailLine('器タスク');

    const timer = {
        id: 'timer-1',
        taskId: 'tv-inline:notes/a.md:ln:3',
        taskName: '器タスク',
        taskFile: 'notes/a.md',
        recordMode: 'child',
        timerType: 'countup',
        runState: 'running',
    } as unknown as TimerInstance;

    const ctx = {
        timers: new Map([[timer.id, timer]]),
        recorder: { resolveTailRecord: () => tail },
        plugin: {
            getTaskIndex: () => ({
                updateTask: async (id: string, u: Record<string, unknown>) => {
                    updates.push({ id, updates: u });
                    // 書いた値は行に載る（次の比較の対象になる）。
                    if (tail && tail.id === id) tail = { ...tail, content: u.content as string };
                },
            }),
        },
        persistTimersToStorage: () => { /* localStorage は測らない */ },
    } as unknown as TimerContext;

    const binding = new TimerContentBinding(ctx);
    const input: FakeInput = {
        value: binding.displayValue(timer),
        oninput: null,
        ownerDocument: { activeElement: null },
    };
    binding.bind(timer, input as unknown as HTMLInputElement);

    return {
        binding, timer, input, updates,
        setTail: (t) => { tail = t; },
        focus: () => { input.ownerDocument.activeElement = input; },
    };
}

/** 入力欄に打ち込む。 */
function type(h: Harness, value: string): void {
    h.input.value = value;
    h.input.oninput?.();
}

describe('TimerContentBinding: the running line owns the content', () => {
    let h: Harness;
    beforeEach(() => { vi.useFakeTimers(); h = makeHarness(); });

    it('writes the typed name to the tail line', async () => {
        type(h, '資料集め');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].id).toBe(TAIL_ID);
        expect(h.updates[0].updates.content).toBe('資料集め');
        expect(h.timer.pendingContent).toBeUndefined();
    });

    it('folds embedded newlines into spaces before writing (paste, IME)', async () => {
        // インライン記法は 1 行でなければならない。display は複数行に折り返して
        // よいが、貼り付け由来の改行が textarea の value に残っていても、記録は
        // 常に 1 行へ畳む。
        type(h, '資料集め\nメモ書き');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].updates.content).toBe('資料集め メモ書き');
    });

    it('collapses a burst of keystrokes into one write', async () => {
        for (const s of ['あ', 'あい', 'あいう']) {
            type(h, s);
            await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS / 4);
        }
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].updates.content).toBe('あいう');
    });

    it('skips the write when the value did not change', async () => {
        // no-op な vault.process は modify を発火せず、無駄な往復だけが残る。
        type(h, '器タスク');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        expect(h.updates).toHaveLength(0);
    });

    it('keeps the icon that the line already carries', async () => {
        // 中断後のレコードは `⏱️` 付き。名前だけ差し替えて、アイコンは残す。
        h.setTail(tailLine('⏱️ 器タスク'));
        type(h, '資料集め');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        expect(h.updates[0].updates.content).toBe('⏱️ 資料集め');
    });

    it('does not grow an icon on a line that has none', async () => {
        // 走行中の行はアイコンを持たない（付くのは停止時）。
        type(h, '資料集め');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        expect(h.updates[0].updates.content).toBe('資料集め');
    });

    it('holds the input as a draft while there is no line to write to', async () => {
        // デイリーノート起点は停止時に 1 行足す形で、走行中の行を持たない。
        h.setTail(undefined);
        type(h, '資料集め');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        expect(h.updates).toHaveLength(0);
        expect(h.timer.pendingContent).toBe('資料集め');
    });

    it('writes the draft out once a line appears', async () => {
        h.setTail(undefined);
        type(h, '資料集め');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        h.setTail(tailLine('器タスク'));
        await h.binding.flush(h.timer);

        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].updates.content).toBe('資料集め');
        expect(h.timer.pendingContent).toBeUndefined();
    });

    it('flush writes before the debounce elapses', async () => {
        // 中断・完了は記録の前に flush する。待たずに記録すると、停止時の書き込みが
        // 古い content を読んで入力が 1 セッション繰り越される（v0.51.0 のバグ）。
        type(h, '資料集め');
        await h.binding.flush(h.timer);

        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].updates.content).toBe('資料集め');
    });

    it('discard drops the pending input without writing', async () => {
        // ✕ 破棄は走行中の行ごと消すので、書いてから消すのは無駄でしかない。
        type(h, '資料集め');
        h.binding.discard(h.timer);
        await h.binding.flush(h.timer);

        expect(h.updates).toHaveLength(0);
        expect(h.timer.pendingContent).toBeUndefined();
    });
});

describe('TimerContentBinding: reading the line back into the input', () => {
    let h: Harness;
    beforeEach(() => { vi.useFakeTimers(); h = makeHarness(); });

    it('shows the tail line name when there is no pending input', () => {
        expect(h.binding.displayValue(h.timer)).toBe('器タスク');
    });

    it('strips the icon from what the input shows', () => {
        h.setTail(tailLine('⏱️ 器タスク'));
        expect(h.binding.displayValue(h.timer)).toBe('器タスク');
    });

    it('prefers the unwritten draft over the line', () => {
        h.timer.pendingContent = '打ちかけ';
        expect(h.binding.displayValue(h.timer)).toBe('打ちかけ');
    });

    it('follows an external edit of the line', () => {
        h.setTail(tailLine('外で直した名前'));
        h.binding.syncFromFile(h.timer, h.input as unknown as HTMLInputElement);
        expect(h.input.value).toBe('外で直した名前');
    });

    it('leaves the input alone while an edit is unwritten', () => {
        type(h, '打ちかけ');
        h.setTail(tailLine('外で直した名前'));
        h.binding.syncFromFile(h.timer, h.input as unknown as HTMLInputElement);
        expect(h.input.value).toBe('打ちかけ');
    });

    it('leaves the input alone while it has focus', () => {
        h.focus();
        h.setTail(tailLine('外で直した名前'));
        h.binding.syncFromFile(h.timer, h.input as unknown as HTMLInputElement);
        expect(h.input.value).toBe('器タスク');
    });
});
