import { describe, expect, it, beforeEach } from 'vitest';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { PendingRecord, RecordMode, TimerState } from '../../../src/timer/TimerState';
import { step, type TimerEvent } from '../../../src/timer/TimerTransitions';
import type TaskViewerPlugin from '../../../src/main';
import { makeTask } from '../helpers/makeTask';
import { opsOver } from '../helpers/anchoredRow';
import { timerOn, type MeasureKind } from '../helpers/timerRig';

/**
 * 記録の書き先は尻尾（最後に書いた行）で選ぶ（`TimerRecorder.recordSessionEnd`）。
 * child は開始の書き込みで走行中の行を 1 行書き、止めたらその行を閉じる —
 * **1 つの走行は 1 行**。測り方（countup、countdown、ポモドーロ）で経路は分かれない。
 * 尻尾を引けなければ記録を 1 行足す（予備の記録）。self の 1 本目は尻尾が対象の錨
 * そのもので、対象の行を記録に書き換える。
 */

interface Harness {
    recorder: TimerRecorder;
    inserted: string[];
    updates: { id: string; updates: Record<string, unknown> }[];
    parent: ReturnType<typeof makeTask>;
}

const FILE = 'notes/a.md';
const CHILD_ID = 'tv-inline:notes/a.md:ln:5';
const PARENT_ID = 'tv-inline:notes/a.md:ln:3';
const TARGET = 'tv-timer-anchor';
const RUNNING = 'tv-timer-1';

/** 出来事を step で当てる。開いているタイマーはこのタイマーだけ。 */
const outlet = {
    dispatch: (timer: TimerState, event: TimerEvent) => { Object.assign(timer, step(timer, event, Date.now())); },
    timers: () => [],
};

function makeHarness(options: { childExists?: boolean; childContent?: string } = {}): Harness {
    const inserted: string[] = [];
    const updates: { id: string; updates: Record<string, unknown> }[] = [];
    const childExists = options.childExists !== false;

    const parent = makeTask({ id: PARENT_ID, file: FILE, line: 2, content: 'parent', blockId: TARGET, anchor: TARGET });
    const child = makeTask({ id: CHILD_ID, file: FILE, line: 3, content: options.childContent ?? '', blockId: RUNNING, anchor: RUNNING });
    const visible = childExists ? [parent, child] : [parent];

    const taskIndex = {
        getTask: (id: string) => visible.find(t => t.id === id),
        getTaskByAnchor: (file: string, anchor: string) => visible.find(t => t.file === file && t.anchor === anchor),
        getTasks: () => visible,
        updateTask: async (id: string, u: Record<string, unknown>) => { updates.push({ id, updates: u }); return true; },
    };

    const plugin = {
        settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 },
        getIndex: () => taskIndex,
        getOperations: () => ({
            ...opsOver(taskIndex),
            insertLine: async (_parentId: string, line: string, _place: string) => { inserted.push(line); return true; },
        }),
    } as unknown as TaskViewerPlugin;

    const recorder = new TimerRecorder(plugin, outlet, () => 'tv-timer-2');
    return { recorder, inserted, updates, parent };
}

/** `parent` に始めたタイマー。既定は child の 1 本目で、尻尾は開始の書き込みが書いた走行中の行。 */
function makeTimer(h: Harness, over: Partial<TimerState> & { kind?: MeasureKind; mode?: RecordMode } = {}): TimerState {
    const { kind = 'countup', mode = 'child', ...rest } = over;
    return { ...timerOn(h.parent, mode, kind), tail: RUNNING, owned: [RUNNING], ...rest };
}

/** 止めた時点で固定する記録: 10 分。 */
function recordFor(then: PendingRecord['then'] = 'close'): PendingRecord {
    return { endMs: Date.now(), seconds: 600, then };
}

describe('recordSessionEnd: one run writes one line', () => {
    let h: Harness;
    beforeEach(() => { h = makeHarness(); });

    it.each<[string, MeasureKind]>([
        ['countup', 'countup'],
        ['countdown', { countdown: 600 }],
        ['pomodoro', 'pomodoro'],
    ])('%s closes the running line instead of inserting a second line', async (_name, kind) => {
        await h.recorder.recordSessionEnd(makeTimer(h, { kind }), recordFor());
        expect(h.inserted).toHaveLength(0);
        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].id).toBe(CHILD_ID);
        expect(h.updates[0].updates.statusChar).toBe('x');
    });

    it('adds a record when the running line was deleted', async () => {
        const gone = makeHarness({ childExists: false });
        await gone.recorder.recordSessionEnd(makeTimer(gone), recordFor());
        expect(gone.inserted).toHaveLength(1);
        expect(gone.updates).toHaveLength(0);
    });

    it('the added record carries the task name', async () => {
        const gone = makeHarness({ childExists: false });
        await gone.recorder.recordSessionEnd(makeTimer(gone), recordFor());
        expect(gone.inserted[0]).toContain('⏱️ parent');
    });

    it('the added record takes the draft over the task name', async () => {
        const gone = makeHarness({ childExists: false });
        await gone.recorder.recordSessionEnd(makeTimer(gone, { draft: '資料集め' }), recordFor());
        expect(gone.inserted[0]).toContain('⏱️ 資料集め');
        expect(gone.inserted[0]).not.toContain('parent');
    });

    it('the running line and the added record go by the same name', async () => {
        const gone = makeHarness({ childExists: false });
        const timer = makeTimer(gone, { tail: null, owned: [] });
        // 開始の書き込みが書く走行中の行。
        expect(await gone.recorder.writeStart(timer, gone.parent)).toBe(true);
        const running = gone.inserted[0];
        // その行を見失ってからの記録。
        await gone.recorder.recordSessionEnd(timer, recordFor());

        expect(running).toContain('parent');
        expect(gone.inserted[1]).toContain('parent');
    });

    it('adds one record when no running line was written', async () => {
        await h.recorder.recordSessionEnd(makeTimer(h, { tail: null, owned: [] }), recordFor());
        expect(h.inserted).toHaveLength(1);
        expect(h.updates).toHaveLength(0);
    });

    it('the added record becomes the tail', async () => {
        const timer = makeTimer(h, { tail: null, owned: [] });
        await h.recorder.recordSessionEnd(timer, recordFor());
        expect(h.inserted[0]).toMatch(/ \^tv-timer-2$/);
        expect(timer.tail).toBe('tv-timer-2');
        expect(timer.owned).toEqual(['tv-timer-2']);
    });

    it('self, first run: the tail is the target, and the target row is the record', async () => {
        const timer = makeTimer(h, { mode: 'self', tail: TARGET, owned: [] });
        await h.recorder.recordSessionEnd(timer, recordFor());
        expect(h.inserted).toHaveLength(0);
        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].id).toBe(PARENT_ID);
        expect(h.updates[0].updates.statusChar).toBe('x');
    });

    it('does not stack a second icon on a line that already carries one', async () => {
        // 名前は対象から継ぐので、完了済みの記録から続きを始めると行の名前は「⏱️ …」で始まる。
        const iconed = makeHarness({ childContent: '⏱️ 完了済み記録' });
        await iconed.recorder.recordSessionEnd(makeTimer(iconed), recordFor());

        expect(iconed.updates[0].updates.content).toBe('⏱️ 完了済み記録');
    });

    it('self, a later run: closes the line it runs on, not the target row', async () => {
        // 2 本目からの self は自分で書いた兄弟に走っている。対象の行は 1 本目の記録で、
        // そこへ書き戻すと 1 本目が上書きされて消える。
        const timer = makeTimer(h, { mode: 'self' });
        await h.recorder.recordSessionEnd(timer, recordFor());

        expect(h.updates).toHaveLength(1);
        expect(h.updates[0].id).toBe(CHILD_ID);
        expect(h.inserted).toHaveLength(0);
    });

    it('self, a later run whose line was lost: adds a record, not back onto the target row', async () => {
        const gone = makeHarness({ childExists: false });
        await gone.recorder.recordSessionEnd(makeTimer(gone, { mode: 'self' }), recordFor());

        expect(gone.inserted).toHaveLength(1);
        expect(gone.updates).toHaveLength(0);
    });

    it('self, ⏸: the record keeps the target\'s anchor, so the next ▶ finds its place', async () => {
        const timer = makeTimer(h, { mode: 'self', tail: TARGET, owned: [TARGET] });
        await h.recorder.recordSessionEnd(timer, recordFor('suspend'));
        expect(h.updates[0].updates.blockId).toBe(TARGET);
    });

    it('self, ■: the record takes its own anchor off in the same write', async () => {
        // 同じ書き込みで発火する move は行を ^id ごと運ぶので、あとから外すと運ばれた先に錨が残る。
        const timer = makeTimer(h, { mode: 'self', tail: TARGET, owned: [TARGET] });
        await h.recorder.recordSessionEnd(timer, recordFor('close'));
        expect(h.updates[0].updates.blockId).toBeUndefined();
    });

    it('self, ■ on a target the user anchored: its anchor stays', async () => {
        const timer = makeTimer(h, { mode: 'self', tail: TARGET, owned: [] });
        await h.recorder.recordSessionEnd(timer, recordFor('close'));
        expect(h.updates[0].updates.blockId).toBe(TARGET);
    });
});

/**
 * 上は recordSessionEnd そのものしか見ない。⏸ と ■ がそこを通ることは、呼び口が
 * 1 つであることをソースで固定する: 描画は lifecycle の stop を呼ぶだけで、記録は
 * lifecycle の 1 か所から、名前の書き出しの直後に書く。
 */
describe('the stops record through one place', () => {
    it('TimerRenderer leaves the stop to TimerLifecycle', async () => {
        const { readFileSync } = await import('node:fs');
        const source = readFileSync('src/timer/TimerRenderer.ts', 'utf8');
        expect(source).not.toMatch(/recorder\.recordSessionEnd\(/);
        expect(source).not.toMatch(/content\.flush\(/);
    });

    it('TimerLifecycle records from exactly one place, right after the name is written', async () => {
        const { readFileSync } = await import('node:fs');
        const source = readFileSync('src/timer/TimerLifecycle.ts', 'utf8');
        expect(source.match(/recorder\.recordSessionEnd\(/g)).toHaveLength(1);
        // 名前を書けなければ記録に進まず、書けたら直後に記録する。
        expect(source).toMatch(
            /if \(!\(await this\.content\.flush\(timer\)\)\) return;\s*\n\s*if \(!\(await this\.recorder\.recordSessionEnd\(timer, record\)\)\) return;/
        );
    });
});
