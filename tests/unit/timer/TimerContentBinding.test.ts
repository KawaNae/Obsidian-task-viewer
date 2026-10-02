import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TimerContentBinding, CONTENT_WRITE_DEBOUNCE_MS } from '../../../src/timer/TimerContentBinding';
import { TimerBoard } from '../../../src/timer/TimerBoard';
import type { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerState } from '../../../src/timer/TimerState';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * content の正は**尻尾の行**ひとつだけで、widget の入力欄はその行の編集器である。
 * 入力はその場で尻尾の行へ届き、行が無い間と書けなかった間だけ下書き
 * （`TimerState.draft`、`drafted` で当てる）に溜める。
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
    board: TimerBoard;
    timer: TimerState;
    input: FakeInput;
    updates: { id: string; updates: Record<string, unknown> }[];
    /** 保存のたびの下書き。 */
    savedDrafts: (string | null)[];
    /** 尻尾として返す行。undefined なら「書く相手がまだ無い」状態。 */
    setTail(task: Task | undefined): void;
    /** 入力欄にフォーカスがある状態にする。 */
    focus(): void;
}

const TAIL_ID = 'tv-inline:notes/a.md:blk:tv-t-1';

function tailLine(content: string): Task {
    return makeTask({ id: TAIL_ID, file: 'notes/a.md', line: 3, content, blockId: 'tv-t-1' });
}

/** 1 本目の行を書き終えて走っている child のタイマー。 */
function runningTimer(): TimerState {
    return {
        id: 'timer-1',
        subject: { kind: 'task', anchor: 'box' },
        file: 'notes/a.md',
        name: '器タスク',
        color: '',
        mode: 'child',
        measure: { type: 'countup' },
        clock: { kind: 'running', startMs: 0 },
        session: { kind: 'running', from: 0 },
        tail: 'tv-t-1',
        owned: ['tv-t-1'],
        opening: null,
        recorded: { seconds: 0, count: 0 },
        priorStartMs: null,
        draft: null,
        expanded: true,
    };
}

function makeHarness(options: { tail?: Task | undefined } = {}): Harness {
    const updates: { id: string; updates: Record<string, unknown> }[] = [];
    let tail: Task | undefined = 'tail' in options ? options.tail : tailLine('器タスク');

    const timer = runningTimer();
    const savedDrafts: (string | null)[] = [];
    const board = new TimerBoard({ persist: () => { savedDrafts.push(timer.draft); }, render: () => { } });
    board.add(timer);
    const recorder = {
        tailInIndex: () => tail,
        resolveTailRecord: async () => (tail ? { kind: 'row' as const, task: tail } : { kind: 'none' as const }),
        noticeUnreadable: () => false,
    } as unknown as TimerRecorder;
    const plugin = {
        getOperations: () => ({
            updateTask: async (id: string, u: Record<string, unknown>) => {
                updates.push({ id, updates: u });
                // 書いた値は行に載る（次の比較の対象になる）。
                if (tail && tail.id === id) tail = { ...tail, content: u.content as string };
                return true;
            },
        }),
    };

    const binding = new TimerContentBinding(plugin as never, board, recorder);
    const input: FakeInput = {
        value: binding.displayValue(timer),
        oninput: null,
        ownerDocument: { activeElement: null },
    };
    binding.bind(timer, input as unknown as HTMLInputElement);

    return {
        binding, board, timer, input, updates, savedDrafts,
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
        expect(h.timer.draft).toBeNull();
    });

    it('a typed name is the draft until it is written, and the board saves it', async () => {
        // 入力欄の組み直しや再読み込みをまたいでも打った字が消えない。
        type(h, '資料集め');
        expect(h.timer.draft).toBe('資料集め');
        h.board.flush();
        expect(h.savedDrafts.at(-1)).toBe('資料集め');

        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);
        h.board.flush();
        expect(h.savedDrafts.at(-1)).toBeNull();
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

    it('folds newlines in a draft that did not come through the input', async () => {
        // 下書きは保存からも戻る — oninput を一度も通らない値でも、書き込みの
        // 単一関門である writeOnce 側で必ず畳む。
        h.board.dispatch(h.timer, { type: 'drafted', draft: '資料集め\nメモ書き' });
        await h.binding.flush(h.timer);

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
        expect(h.timer.draft).toBeNull();
    });

    it('keeps the icon that the line already carries', async () => {
        // 記録を書き終えた行は `⏱️` 付き。名前だけ差し替えて、アイコンは残す。
        h.setTail(tailLine('⏱️ 器タスク'));
        type(h, '資料集め');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        expect(h.updates[0].updates.content).toBe('⏱️ 資料集め');
    });

    it('does not grow an icon on a line that has none', async () => {
        // 走行中の行はアイコンを持たない（付くのは記録のとき）。
        type(h, '資料集め');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        expect(h.updates[0].updates.content).toBe('資料集め');
    });

    it('holds the input as a draft while there is no line to write to', async () => {
        // 開始の書き込みの往復中は、尻尾の行がまだ無い。
        h.setTail(undefined);
        type(h, '資料集め');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        expect(h.updates).toHaveLength(0);
        expect(h.timer.draft).toBe('資料集め');
    });

    it('writes the draft out once a line appears', async () => {
        h.setTail(undefined);
        type(h, '資料集め');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS);

        h.setTail(tailLine('器タスク'));
        await h.binding.flush(h.timer);

        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].updates.content).toBe('資料集め');
        expect(h.timer.draft).toBeNull();
    });

    it('flush writes before the debounce elapses', async () => {
        // ⏸ と ■ は記録の前に flush する。待たずに記録すると、記録の書き込みが
        // 古い content を読み、入力が 1 セッション繰り越される。
        type(h, '資料集め');
        await h.binding.flush(h.timer);

        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].updates.content).toBe('資料集め');
    });

    it('discard drops the pending input without writing', async () => {
        // ✕ の破棄は走行中の行ごと消すので、書いてから消すのは無駄でしかない。
        type(h, '資料集め');
        h.binding.discard(h.timer);
        await h.binding.flush(h.timer);

        expect(h.updates).toHaveLength(0);
        expect(h.timer.draft).toBeNull();
    });
});

describe('TimerContentBinding: reading the line back into the input', () => {
    let h: Harness;
    beforeEach(() => { vi.useFakeTimers(); h = makeHarness(); });

    it('shows the tail line name when there is no draft', () => {
        expect(h.binding.displayValue(h.timer)).toBe('器タスク');
    });

    it('shows nothing while there is no tail line', () => {
        h.setTail(undefined);
        expect(h.binding.displayValue(h.timer)).toBe('');
    });

    it('strips the icon from what the input shows', () => {
        h.setTail(tailLine('⏱️ 器タスク'));
        expect(h.binding.displayValue(h.timer)).toBe('器タスク');
    });

    it('prefers the unwritten draft over the line', () => {
        h.board.dispatch(h.timer, { type: 'drafted', draft: '打ちかけ' });
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
