import { describe, expect, it, vi, afterEach } from 'vitest';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerState } from '../../../src/timer/TimerState';
import { step, type TimerEvent } from '../../../src/timer/TimerTransitions';
import type TaskViewerPlugin from '../../../src/main';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';
import { opsOver, rowOf, answerOf } from '../helpers/anchoredRow';
import { timerOnDay } from '../helpers/timerRig';

/**
 * デイリーノート起点のタイマーも、起動と同時に走行中の行を持つ。
 *
 * 器になるタスクが無いので 1 本目だけは設定の見出しの下へ直接置き、そのノートの
 * パスを `file` へ引き取る。そこから先は通常タスクと同じ経路（尻尾の兄弟として
 * 追記）に乗る — 見出しの下へ 2 行目を足すのではない。
 */

const DAILY_PATH = 'DailyNotes/2026-08-17.md';

interface Harness {
    recorder: TimerRecorder;
    /** 見出しの下へ置いた行。 */
    appended: string[];
    /** 尻尾の兄弟として挿した行。 */
    siblings: { afterTaskId: string; line: string }[];
    tasks: Task[];
}

function makeHarness(): Harness {
    const appended: string[] = [];
    const siblings: { afterTaskId: string; line: string }[] = [];
    const tasks: Task[] = [];
    let idSeq = 0;

    /** Where a line put in the daily note goes: the harness's own record of it. */
    const putInDailyNote = async (_date: string, line: string) => {
        appended.push(line);
        registerWrittenLine(line);
        return { written: true as const, path: DAILY_PATH };
    };

    /** 書いた行を index に載せる（スキャンの代役）。 */
    function registerWrittenLine(line: string): void {
        const blockId = line.match(/\^(\S+)\s*$/)?.[1];
        const content = line.replace(/^- \[.\]\s*/, '').replace(/\s*@.*$/, '');
        tasks.push(makeTask({
            id: `tv-inline:${DAILY_PATH}:blk:${blockId}`,
            file: DAILY_PATH,
            content,
            blockId,
            anchor: blockId,
        }));
    }

    const taskIndex = {
        getTask: (id: string) => tasks.find(t => t.id === id),
        getTaskByAnchor: (file: string, anchor: string) => tasks.find(t => t.file === file && t.anchor === anchor),
        getTasks: () => tasks,
        updateTask: async () => true,   // 記録の書き込みは測らない
    };

    const plugin = {
        settings: { taskHeading: 'Tasks', taskHeadingLevel: 2, sectionSide: 'head' },
        getIndex: () => taskIndex,
        getOperations: () => ({
            ...opsOver(taskIndex),
            putInDailyNote,
            insertLine: async (afterTaskId: string, line: string) => {
                siblings.push({ afterTaskId, line });
                registerWrittenLine(line);
                return answerOf(true);
            },
        }),
    } as unknown as TaskViewerPlugin;

    const outlet = {
        dispatch: (timer: TimerState, event: TimerEvent) => { Object.assign(timer, step(timer, event, Date.now())); },
        timers: () => [],
    };
    return { recorder: new TimerRecorder(plugin, outlet, () => `tv-t-${++idSeq}`), appended, siblings, tasks };
}

function makeDailyTimer(overrides: Partial<TimerState> = {}): TimerState {
    return { ...timerOnDay('2026-08-17'), ...overrides };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('daily note timers own a running line too', () => {
    it('writes a running line under the heading at start', async () => {
        const h = makeHarness();
        const timer = makeDailyTimer();

        const written = await h.recorder.writeStart(timer, null);

        expect(h.appended).toHaveLength(1);
        expect(h.appended[0]).toMatch(/^- \[ \]/);
        expect(written).toBe(true);
    });

    it('adopts the written line as the tail and remembers the note path', async () => {
        const h = makeHarness();
        const timer = makeDailyTimer();

        await h.recorder.writeStart(timer, null);

        // パスを覚えないと、尻尾の解決（ファイルで絞る）も兄弟挿入も相手を見失う。
        expect(timer.file).toBe(DAILY_PATH);
        expect(timer.tail).toBe('tv-t-1');
        expect(timer.owned).toEqual(['tv-t-1']);
        expect(rowOf(await h.recorder.resolveTailRecord(timer))?.file).toBe(DAILY_PATH);
    });

    it('starts the line unnamed instead of inheriting the date', async () => {
        const h = makeHarness();
        await h.recorder.writeStart(makeDailyTimer(), null);

        // name は日付。継ぐと「2026-08-17 を 25 分やった」という記録になる。
        expect(h.appended[0]).toMatch(/^- \[ \]\s+@/);
    });

    it('carries the draft into the line when one was typed before the write landed', async () => {
        const h = makeHarness();
        await h.recorder.writeStart(makeDailyTimer({ draft: '資料集め' }), null);

        expect(h.appended[0]).toContain('資料集め');
    });

    it('carries the name of the previous record into the next session', async () => {
        // 兄弟レコードは同名。継ぐ対象タスクが無いデイリーでは、直前のレコードが
        // 名前の出どころになる（毎回打ち直させない）。
        const h = makeHarness();
        const timer = makeDailyTimer({ draft: '資料集め' });
        await h.recorder.writeStart(timer, null);
        // 下書きは行に書き出して消えている（TimerContentBinding）。名前の正は行。
        Object.assign(timer, step(timer, { type: 'drafted', draft: null }, Date.now()));

        await h.recorder.startNextSession(timer);

        expect(h.siblings[0].line).toContain('資料集め');
    });

    it('puts the second session next to the first, not under the heading again', async () => {
        const h = makeHarness();
        const timer = makeDailyTimer();
        await h.recorder.writeStart(timer, null);

        await h.recorder.startNextSession(timer);

        expect(h.appended).toHaveLength(1);
        expect(h.siblings).toHaveLength(1);
        expect(h.siblings[0].afterTaskId).toBe(`tv-inline:${DAILY_PATH}:blk:tv-t-1`);
        expect(timer.tail).toBe('tv-t-2');
    });
});
