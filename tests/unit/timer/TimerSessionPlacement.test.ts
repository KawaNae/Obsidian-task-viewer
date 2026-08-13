import { describe, expect, it, beforeEach } from 'vitest';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import type TaskViewerPlugin from '../../../src/main';
import type { App } from 'obsidian';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

/**
 * v2 の記録の置き場。**尻尾（最後に書いたレコード）の兄弟**に並べる、が原則で、
 * 器を作ったり構造を変えたりはしない。
 *
 * ここで押さえるのは 3 点:
 *   - 再開は尻尾の隣に書き、`^id` を新しい行へ引き渡す（尻尾は常に 1 個）
 *   - 引き渡すのは自動生成 id だけ。ユーザーの blockId は触らない
 *   - 尻尾を見失っても記録は落とさない（子として書くフォールバック）
 */

const TARGET_ID = 'tv-inline:notes/a.md:ln:3';
const TAIL_ID = 'tv-inline:notes/a.md:ln:4';
const NEW_SESSION_ID = 'tv-inline:notes/a.md:ln:5';
const NEW_BLOCK_ID = 'tv-t-new1234';

interface Harness {
    recorder: TimerRecorder;
    siblingInserts: { taskId: string; line: string; opts: { afterCompletedRun?: boolean } }[];
    childInserts: string[];
    updates: { id: string; updates: Record<string, unknown> }[];
    deletes: string[];
}

function makeHarness(options: { tail?: Task | undefined; siblingFails?: boolean } = {}): Harness {
    const siblingInserts: Harness['siblingInserts'] = [];
    const childInserts: string[] = [];
    const updates: Harness['updates'] = [];
    const deletes: string[] = [];

    const target = makeTask({
        id: TARGET_ID, file: 'notes/a.md', line: 2, content: '設計', statusChar: ' ',
    });
    const tail = 'tail' in options
        ? options.tail
        : makeTask({
            id: TAIL_ID, file: 'notes/a.md', line: 3, content: '⏱️ 設計',
            statusChar: 'x', startTime: '11:05', endTime: '13:02', blockId: 'tv-t-old5678',
        });

    // 書き込みが成功したら、その行はスキャン後に index から引けるようになる。
    const tasks: Task[] = tail ? [target, tail] : [target];
    const appearWritten = (blockId: string) => {
        tasks.push(makeTask({
            id: NEW_SESSION_ID, file: 'notes/a.md', line: 4, content: '設計',
            statusChar: ' ', startTime: '14:01', blockId,
        }));
    };

    const taskIndex = {
        getTask: (id: string) => tasks.find(task => task.id === id),
        getTasks: () => tasks,
        updateTask: async (id: string, u: Record<string, unknown>) => {
            updates.push({ id, updates: u });
            const task = tasks.find(t => t.id === id);
            if (task && 'blockId' in u) task.blockId = u.blockId as string | undefined;
        },
        deleteTask: async (id: string) => { deletes.push(id); },
        waitForScan: async () => { /* 書き込みは同期的に反映済み */ },
    };

    const plugin = {
        settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 },
        getTaskIndex: () => taskIndex,
        getTaskWriteService: () => ({
            insertChildTask: async (_parentId: string, line: string) => {
                childInserts.push(line);
                appearWritten(NEW_BLOCK_ID);
            },
            insertSiblingAfterTask: async (taskId: string, line: string, opts = {}) => {
                if (options.siblingFails) return -1;
                siblingInserts.push({ taskId, line, opts });
                appearWritten(NEW_BLOCK_ID);
                return 4;
            },
        }),
    } as unknown as TaskViewerPlugin;

    const storageUtils = { generateTimerTargetId: () => NEW_BLOCK_ID } as unknown as TimerStorageUtils;
    const recorder = new TimerRecorder({} as App, plugin, storageUtils);

    // resolver は index を舐めて対象を引く。テストでは対象タスクに固定する。
    (recorder as unknown as { resolver: { resolveTvInline: () => unknown; resolveTvFile: () => unknown } }).resolver = {
        resolveTvInline: () => target,
        resolveTvFile: () => target,
    };

    return { recorder, siblingInserts, childInserts, updates, deletes };
}

function makeTimer(overrides: Partial<TimerInstance> = {}): TimerInstance {
    return {
        id: 'timer-1',
        taskId: TARGET_ID,
        taskName: '設計',
        taskOriginalText: '- [ ] 設計',
        taskFile: 'notes/a.md',
        startTimeMs: 0,
        pausedElapsedTime: 600,
        phase: 'work',
        isRunning: false,
        runState: 'suspended',
        sessionCount: 1,
        recordedElapsedTime: 600,
        isExpanded: true,
        intervalId: null,
        customLabel: '',
        recordMode: 'self',
        parserId: 'tv-inline',
        taskColor: '',
        timerType: 'countup',
        elapsedTime: 0,
        tailRecordBlockId: 'tv-t-old5678',
        recordedChildTaskId: TAIL_ID,
        ...overrides,
    } as TimerInstance;
}

describe('startNextSession: the next record sits beside the last one', () => {
    let h: Harness;
    beforeEach(() => { h = makeHarness(); });

    it('inserts the session as the tail record’s sibling', async () => {
        const timer = makeTimer();
        const sessionId = await h.recorder.startNextSession(timer);

        expect(h.siblingInserts).toHaveLength(1);
        expect(h.siblingInserts[0].taskId).toBe(TAIL_ID);
        // 尻尾の直後に置く。完了済みの連なりを辿らせるのは [x] 起点の「続き」だけ。
        expect(h.siblingInserts[0].opts.afterCompletedRun).toBeUndefined();
        expect(h.childInserts).toHaveLength(0);
        expect(sessionId).toBe(NEW_SESSION_ID);
    });

    it('carries the record name over instead of leaving the line unnamed', async () => {
        await h.recorder.startNextSession(makeTimer());
        expect(h.siblingInserts[0].line).toContain('設計');
    });

    it('moves the tail anchor to the new line and strips it off the old one', async () => {
        const timer = makeTimer();
        await h.recorder.startNextSession(timer);

        expect(timer.tailRecordBlockId).toBe(NEW_BLOCK_ID);
        // ^id は現在の尻尾 1 個。前のレコードからは外れる。
        expect(h.updates).toEqual([{ id: TAIL_ID, updates: { blockId: undefined } }]);
    });

    it('leaves a hand-written block ID alone', async () => {
        const manual = makeHarness({
            tail: makeTask({
                id: TAIL_ID, file: 'notes/a.md', line: 3, content: '⏱️ 設計',
                statusChar: 'x', startTime: '11:05', endTime: '13:02', blockId: 'my-reference',
            }),
        });
        const timer = makeTimer({ tailRecordBlockId: 'my-reference' });

        await manual.recorder.startNextSession(timer);

        expect(manual.siblingInserts).toHaveLength(1);
        expect(manual.updates).toHaveLength(0);   // ユーザーの参照は片付けない
    });

    it('falls back to a child insert when a child-mode timer loses its tail', async () => {
        const orphaned = makeHarness({ tail: undefined });
        const timer = makeTimer({
            recordMode: 'child', tailRecordBlockId: undefined, recordedChildTaskId: undefined,
        });

        await orphaned.recorder.startNextSession(timer);

        // 尻尾を見失っても記録そのものは落とさない。器の**子**として書く —
        // 器を尻尾と見なして隣に置くと、ユーザーのタスクと同じ深さに紛れる。
        expect(orphaned.childInserts).toHaveLength(1);
        expect(orphaned.siblingInserts).toHaveLength(0);
    });

    it('lets a self-mode timer fall back to its own task row', async () => {
        // self は 1 本目のレコードが対象タスク行そのもの。^id を失っていても
        // そこが尻尾なので、隣に並べてよい。
        const h2 = makeHarness({ tail: undefined });
        const timer = makeTimer({ tailRecordBlockId: undefined, recordedChildTaskId: undefined });

        await h2.recorder.startNextSession(timer);

        expect(h2.siblingInserts).toHaveLength(1);
        expect(h2.siblingInserts[0].taskId).toBe(TARGET_ID);
    });

    it('falls back to a child insert when the sibling write cannot resolve the line', async () => {
        const failing = makeHarness({ siblingFails: true });
        await failing.recorder.startNextSession(makeTimer());
        expect(failing.childInserts).toHaveLength(1);
    });
});

describe('startContinuationSession: continuing a completed task', () => {
    it('sends the record past the run of completed siblings', async () => {
        const h = makeHarness();
        const timer = makeTimer({ recordMode: 'sibling', tailRecordBlockId: undefined, recordedChildTaskId: undefined });

        await h.recorder.startContinuationSession(timer);

        expect(h.siblingInserts).toHaveLength(1);
        expect(h.siblingInserts[0].taskId).toBe(TARGET_ID);
        expect(h.siblingInserts[0].opts.afterCompletedRun).toBe(true);
        expect(timer.tailRecordBlockId).toBe(NEW_BLOCK_ID);
    });
});

describe('discardRunningPlaceholder: ✕ leaves no half-open line behind', () => {
    /** 走行中＝開始時に書いた未完了の placeholder が尻尾にいる状態。 */
    function runningTimer(): TimerInstance {
        return makeTimer({
            runState: 'running',
            isRunning: true,
            tailRecordBlockId: NEW_BLOCK_ID,
            recordedChildTaskId: NEW_SESSION_ID,
        });
    }

    it('deletes the line it opened at start', async () => {
        const h = makeHarness();
        await h.recorder.startNextSession(makeTimer());   // placeholder を 1 行書く
        h.updates.length = 0;

        const timer = runningTimer();
        await h.recorder.discardRunningPlaceholder(timer);

        expect(h.deletes).toEqual([NEW_SESSION_ID]);
        expect(timer.tailRecordBlockId).toBeUndefined();
    });

    it('keeps a line the user has since edited, and only takes the marker off', async () => {
        const h = makeHarness();
        await h.recorder.startNextSession(makeTimer());
        // ユーザーが手を入れた（完了にした）ら、それはもう自分の行ではない。
        const written = h.recorder['plugin'].getTaskIndex().getTasks().find(t => t.id === NEW_SESSION_ID)!;
        written.statusChar = 'x';
        h.updates.length = 0;

        await h.recorder.discardRunningPlaceholder(runningTimer());

        expect(h.deletes).toHaveLength(0);
        expect(h.updates).toEqual([{ id: NEW_SESSION_ID, updates: { blockId: undefined } }]);
    });

    it('does nothing when the timer never opened a line (self mode, first session)', async () => {
        const h = makeHarness();
        await h.recorder.discardRunningPlaceholder(makeTimer({
            runState: 'running', tailRecordBlockId: undefined, recordedChildTaskId: undefined,
        }));

        expect(h.deletes).toHaveLength(0);
        expect(h.updates).toHaveLength(0);
    });
});

describe('clearTailRecordId: closing the widget leaves no auto ID in the note', () => {
    it('strips the auto ID off the tail record', async () => {
        const h = makeHarness();
        const timer = makeTimer();

        await h.recorder.clearTailRecordId(timer);

        expect(h.updates).toEqual([{ id: TAIL_ID, updates: { blockId: undefined } }]);
        expect(timer.tailRecordBlockId).toBeUndefined();
    });

    it('keeps a hand-written block ID', async () => {
        const manual = makeHarness({
            tail: makeTask({
                id: TAIL_ID, file: 'notes/a.md', line: 3, content: '⏱️ 設計',
                statusChar: 'x', blockId: 'my-reference',
            }),
        });

        await manual.recorder.clearTailRecordId(makeTimer({ tailRecordBlockId: 'my-reference' }));

        expect(manual.updates).toHaveLength(0);
    });
});
