import { describe, expect, it, vi, afterEach } from 'vitest';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import type TaskViewerPlugin from '../../../src/main';
import type { App } from 'obsidian';
import type { Task } from '../../../src/types';
import { DailyNoteUtils } from '../../../src/utils/DailyNoteUtils';
import { makeTask } from '../helpers/makeTask';

/**
 * デイリーノート起点のタイマーも、起動と同時に走行中の行を持つ。
 *
 * 器になるタスクが無いので 1 本目だけは設定の見出しの下へ直接置き、そのノートの
 * パスを `taskFile` へ引き取る。そこから先は通常タスクと同じ経路（尻尾の兄弟として
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

    vi.spyOn(DailyNoteUtils, 'appendLineToDailyNote').mockImplementation(async (_app, _date, line) => {
        appended.push(line);
        registerWrittenLine(line);
        return DAILY_PATH;
    });

    /** 書いた行を index に載せる（スキャンの代役）。 */
    function registerWrittenLine(line: string): void {
        const blockId = line.match(/\^(\S+)\s*$/)?.[1];
        const content = line.replace(/^- \[.\]\s*/, '').replace(/\s*@.*$/, '');
        tasks.push(makeTask({
            id: `tv-inline:${DAILY_PATH}:blk:${blockId}`,
            file: DAILY_PATH,
            content,
            blockId,
        }));
    }

    const taskIndex = {
        getTask: (id: string) => tasks.find(t => t.id === id),
        getTasks: () => tasks,
        updateTask: async () => { /* 記録の書き込みは測らない */ },
        waitForScan: async () => { /* 書き込みと同時に載せている */ },
    };

    const plugin = {
        settings: { dailyNoteHeader: 'Tasks', dailyNoteHeaderLevel: 2 },
        getTaskIndex: () => taskIndex,
        getTaskWriteService: () => ({
            insertSiblingAfterTask: async (afterTaskId: string, line: string) => {
                siblings.push({ afterTaskId, line });
                registerWrittenLine(line);
                return 5;
            },
        }),
    } as unknown as TaskViewerPlugin;

    const storageUtils = {
        generateTimerTargetId: () => `tv-t-${++idSeq}`,
    } as unknown as TimerStorageUtils;

    return { recorder: new TimerRecorder({} as App, plugin, storageUtils), appended, siblings, tasks };
}

function makeDailyTimer(overrides: Partial<TimerInstance> = {}): TimerInstance {
    return {
        id: 'timer-1',
        taskId: 'daily-2026-08-17',
        taskName: '2026-08-17',
        taskOriginalText: '',
        taskFile: '',
        startTimeMs: 0,
        pausedElapsedTime: 0,
        phase: 'work',
        isRunning: true,
        runState: 'running',
        sessionCount: 0,
        recordedElapsedTime: 0,
        isExpanded: true,
        intervalId: null,
        recordMode: 'child',
        parserId: 'tv-inline',
        taskColor: '',
        timerType: 'countup',
        elapsedTime: 0,
        ...overrides,
    } as TimerInstance;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('daily note timers own a running line too', () => {
    it('writes a running line under the heading at start', async () => {
        const h = makeHarness();
        const timer = makeDailyTimer();

        const sessionId = await h.recorder.createChildAtStart(timer);

        expect(h.appended).toHaveLength(1);
        expect(h.appended[0]).toMatch(/^- \[ \]/);
        expect(sessionId).toBeDefined();
    });

    it('adopts the written line as the tail and remembers the note path', async () => {
        const h = makeHarness();
        const timer = makeDailyTimer();

        await h.recorder.createChildAtStart(timer);

        // パスを覚えないと、尻尾の解決（ファイルで絞る）も兄弟挿入も相手を見失う。
        expect(timer.taskFile).toBe(DAILY_PATH);
        expect(timer.tailRecordBlockId).toBe('tv-t-1');
        expect(h.recorder.resolveTailRecord(timer)?.file).toBe(DAILY_PATH);
    });

    it('starts the line unnamed instead of inheriting the date', async () => {
        const h = makeHarness();
        await h.recorder.createChildAtStart(makeDailyTimer());

        // taskName は日付。継ぐと「2026-08-17 を 25 分やった」という記録になる。
        expect(h.appended[0]).toMatch(/^- \[ \]\s+@/);
    });

    it('carries the draft into the line when one was typed before the write landed', async () => {
        const h = makeHarness();
        await h.recorder.createChildAtStart(makeDailyTimer({ pendingContent: '資料集め' }));

        expect(h.appended[0]).toContain('資料集め');
    });

    it('carries the name of the previous record into the next session', async () => {
        // 兄弟レコードは同名、が v2 の規則。継ぐ対象タスクが無いデイリーでは
        // 直前のレコードが名前の出どころになる（毎回打ち直させない）。
        const h = makeHarness();
        const timer = makeDailyTimer({ pendingContent: '資料集め' });
        await h.recorder.createChildAtStart(timer);

        await h.recorder.startNextSession(timer);

        expect(h.siblings[0].line).toContain('資料集め');
    });

    it('puts the second session next to the first, not under the heading again', async () => {
        const h = makeHarness();
        const timer = makeDailyTimer();
        await h.recorder.createChildAtStart(timer);

        await h.recorder.startNextSession(timer);

        expect(h.appended).toHaveLength(1);
        expect(h.siblings).toHaveLength(1);
        expect(h.siblings[0].afterTaskId).toBe(`tv-inline:${DAILY_PATH}:blk:tv-t-1`);
        expect(timer.tailRecordBlockId).toBe('tv-t-2');
    });
});
