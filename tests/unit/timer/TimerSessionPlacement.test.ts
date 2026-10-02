import { describe, expect, it, beforeEach } from 'vitest';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import { targetOf, type TimerState } from '../../../src/timer/TimerState';
import { step, type TimerEvent } from '../../../src/timer/TimerTransitions';
import type TaskViewerPlugin from '../../../src/main';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';
import { opsOver, rowOf } from '../helpers/anchoredRow';
import { timerOn } from '../helpers/timerRig';

/**
 * 記録の置き場。**尻尾（最後に書いたレコード）の兄弟**に並べる、が原則で、
 * 器を作ったり構造を変えたりはしない。
 *
 * ここで押さえるのは 3 点:
 *   - 再開は尻尾の隣に書き、`^id` を新しい行へ引き渡す（尻尾は常に 1 個）
 *   - 外すのは自分の書き込みで付けた id だけ。ユーザーの blockId は触らない
 *   - 尻尾を見失っても記録は落とさない（子として書くフォールバック）
 */

const TARGET_ID = 'tv-inline:notes/a.md:ln:3';
const TAIL_ID = 'tv-inline:notes/a.md:ln:4';
const NEW_SESSION_ID = 'tv-inline:notes/a.md:ln:5';
const NEW_BLOCK_ID = 'tv-t-new1234';
const TARGET_ANCHOR = 'tv-t-target-anchor';
const OLD_TAIL = 'tv-t-old5678';

interface Harness {
    recorder: TimerRecorder;
    siblingInserts: { taskId: string; line: string; opts: { afterCompletedRun?: boolean } }[];
    childInserts: string[];
    updates: { id: string; updates: Record<string, unknown> }[];
    deletes: string[];
    target: Task;
    tasks: Task[];
}

function makeHarness(options: { tail?: Task | undefined; siblingFails?: boolean } = {}): Harness {
    const siblingInserts: Harness['siblingInserts'] = [];
    const childInserts: string[] = [];
    const updates: Harness['updates'] = [];
    const deletes: string[] = [];

    const target = makeTask({
        id: TARGET_ID, file: 'notes/a.md', line: 2, content: '設計', statusChar: ' ',
        blockId: TARGET_ANCHOR, anchor: TARGET_ANCHOR,
    });
    const tail = 'tail' in options
        ? options.tail
        : makeTask({
            id: TAIL_ID, file: 'notes/a.md', line: 3, content: '⏱️ 設計',
            statusChar: 'x', startTime: '11:05', endTime: '13:02', blockId: OLD_TAIL, anchor: OLD_TAIL,
        });

    // 書き込みが成功したら、その行はスキャン後に index から引けるようになる。
    const tasks: Task[] = tail ? [target, tail] : [target];
    const appearWritten = (blockId: string) => {
        tasks.push(makeTask({
            id: NEW_SESSION_ID, file: 'notes/a.md', line: 4, content: '設計',
            statusChar: ' ', startTime: '14:01', blockId, anchor: blockId,
        }));
    };

    const taskIndex = {
        getTask: (id: string) => tasks.find(task => task.id === id),
        getTaskByAnchor: (file: string, anchor: string) => tasks.find(task => task.file === file && task.anchor === anchor),
        getTasks: () => tasks,
        updateTask: async (id: string, u: Record<string, unknown>) => {
            updates.push({ id, updates: u });
            const task = tasks.find(t => t.id === id);
            if (task && 'blockId' in u) task.blockId = u.blockId as string | undefined;
            return true;
        },
        deleteTask: async (id: string) => { deletes.push(id); return true; },
    };

    const plugin = {
        settings: { pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 },
        getIndex: () => taskIndex,
        getOperations: () => ({
            ...opsOver(taskIndex),
            insertLine: async (
                taskId: string,
                line: string,
                place: 'firstChild' | 'afterSubtree' | 'afterCompletedRun',
                rowId?: string | null,
            ) => {
                if (place === 'firstChild') {
                    childInserts.push(line);
                    appearWritten(NEW_BLOCK_ID);
                    return true;
                }
                if (options.siblingFails) return false;
                // `rowId === null` takes the `^id` off the row it names, in the
                // same write as the insert.
                if (rowId === null) {
                    updates.push({ id: taskId, updates: { blockId: undefined } });
                    const released = tasks.find(t => t.id === taskId);
                    if (released) released.blockId = undefined;
                }
                siblingInserts.push({ taskId, line, opts: { afterCompletedRun: place === 'afterCompletedRun' ? true : undefined } });
                appearWritten(NEW_BLOCK_ID);
                return true;
            },
        }),
    } as unknown as TaskViewerPlugin;

    const outlet = {
        dispatch: (timer: TimerState, event: TimerEvent) => { Object.assign(timer, step(timer, event, Date.now())); },
        timers: () => [],
    };
    const recorder = new TimerRecorder(plugin, outlet, () => NEW_BLOCK_ID);

    return { recorder, siblingInserts, childInserts, updates, deletes, target, tasks };
}

/**
 * self のタイマーが 1 本目を記録して中断している: 尻尾はこのタイマーが書いた行
 * （対象の行の兄弟）で、その錨はこのタイマーの書き込みで付けた。
 */
function makeTimer(h: Harness, overrides: Partial<TimerState> = {}): TimerState {
    return {
        ...timerOn(h.target, overrides.mode ?? 'self'),
        session: { kind: 'suspended' },
        recorded: { seconds: 600, count: 1 },
        tail: OLD_TAIL,
        owned: [OLD_TAIL],
        ...overrides,
    };
}

describe('startNextSession: the next record sits beside the last one', () => {
    let h: Harness;
    beforeEach(() => { h = makeHarness(); });

    it('inserts the running line as the tail record’s sibling', async () => {
        const timer = makeTimer(h);
        const written = await h.recorder.startNextSession(timer);

        expect(h.siblingInserts).toHaveLength(1);
        expect(h.siblingInserts[0].taskId).toBe(TAIL_ID);
        // 尻尾の直後に置く。完了済みの連なりを辿らせるのは [x] 起点の「続き」だけ。
        expect(h.siblingInserts[0].opts.afterCompletedRun).toBeUndefined();
        expect(h.childInserts).toHaveLength(0);
        expect(written).toBe(true);
        // 書けた行が尻尾になり、錨で引ける。
        expect(rowOf(await h.recorder.resolveTailRecord(timer))?.id).toBe(NEW_SESSION_ID);
    });

    it('carries the record name over instead of leaving the line unnamed', async () => {
        await h.recorder.startNextSession(makeTimer(h));
        expect(h.siblingInserts[0].line).toContain('設計');
    });

    it('moves the tail anchor to the new line and takes it off the old one', async () => {
        const timer = makeTimer(h);
        await h.recorder.startNextSession(timer);

        expect(timer.tail).toBe(NEW_BLOCK_ID);
        expect(timer.owned).toEqual([NEW_BLOCK_ID]);
        // ^id は今の尻尾の 1 個。前の記録からは外れる。
        expect(h.updates).toEqual([{ id: TAIL_ID, updates: { blockId: undefined } }]);
    });

    it('leaves a hand-written block ID alone', async () => {
        const manual = makeHarness({
            tail: makeTask({
                id: TAIL_ID, file: 'notes/a.md', line: 3, content: '⏱️ 設計',
                statusChar: 'x', startTime: '11:05', endTime: '13:02', blockId: 'my-reference', anchor: 'my-reference',
            }),
        });
        const timer = makeTimer(manual, { tail: 'my-reference', owned: [] });

        await manual.recorder.startNextSession(timer);

        expect(manual.siblingInserts).toHaveLength(1);
        expect(manual.updates).toHaveLength(0);   // ユーザーの参照は片付けない
        expect(timer.owned).toEqual([NEW_BLOCK_ID]);
    });

    it('falls back to a child insert when a child timer loses its tail', async () => {
        const orphaned = makeHarness({ tail: undefined });
        const timer = makeTimer(orphaned, { mode: 'child', tail: null, owned: [] });

        await orphaned.recorder.startNextSession(timer);

        // 尻尾を見失っても記録そのものは落とさない。器の**子**として書く —
        // 器を尻尾と見なして隣に置くと、ユーザーのタスクと同じ深さに紛れる。
        expect(orphaned.childInserts).toHaveLength(1);
        expect(orphaned.siblingInserts).toHaveLength(0);
        expect(timer.tail).toBe(NEW_BLOCK_ID);
    });

    it('self, the second run: beside the target row, whose anchor is its tail, and the target keeps its anchor', async () => {
        // self は 1 本目の記録が対象の行そのもの。開始の書き込みで尻尾を対象の錨に
        // 置くので、その隣に並べる。対象の錨は外さない（走っている間は残る）。
        const h2 = makeHarness({ tail: undefined });
        const timer = makeTimer(h2, { tail: TARGET_ANCHOR, owned: [TARGET_ANCHOR] });

        await h2.recorder.startNextSession(timer);

        expect(h2.siblingInserts).toHaveLength(1);
        expect(h2.siblingInserts[0].taskId).toBe(TARGET_ID);
        expect(h2.updates).toHaveLength(0);
        expect(targetOf(timer)).toBe(TARGET_ANCHOR);
        expect(timer.owned).toEqual([TARGET_ANCHOR, NEW_BLOCK_ID]);
    });

    it('writes nowhere else when the sibling write was not made', async () => {
        // The tail resolved, so the write layer has already said why it was
        // not made. A child written instead would be a second notice for one
        // resume, and, where the sibling had landed after all, a record out
        // of order. The timer stays suspended (TimerLifecycle.resume), so the
        // tail is left as it was: the last record, not a running line.
        const failing = makeHarness({ siblingFails: true });
        const timer = makeTimer(failing);
        expect(await failing.recorder.startNextSession(timer)).toBe(false);
        expect(failing.childInserts).toHaveLength(0);
        expect(timer.tail).toBe(OLD_TAIL);
        expect(timer.owned).toEqual([OLD_TAIL]);
        expect(timer.opening).toBeNull();
    });
});

describe('writeStart, sibling: continuing a completed task', () => {
    it('sends the record past the run of completed siblings', async () => {
        const h = makeHarness();
        const timer = makeTimer(h, { mode: 'sibling', session: { kind: 'running', from: 0 }, tail: null, owned: [] });

        await h.recorder.writeStart(timer, h.target);

        expect(h.siblingInserts).toHaveLength(1);
        expect(h.siblingInserts[0].taskId).toBe(TARGET_ID);
        expect(h.siblingInserts[0].opts.afterCompletedRun).toBe(true);
        expect(timer.tail).toBe(NEW_BLOCK_ID);
    });
});

describe('discardRunningPlaceholder: ✕ leaves no half-open line behind', () => {
    /** 走っている: ▶ で書いた未完了の走行中の行が尻尾。 */
    function runningTimer(h: Harness): TimerState {
        return makeTimer(h, { session: { kind: 'running', from: 0 }, tail: NEW_BLOCK_ID, owned: [NEW_BLOCK_ID] });
    }

    it('deletes the line it opened', async () => {
        const h = makeHarness();
        await h.recorder.startNextSession(makeTimer(h));   // 走行中の行を 1 行書く
        h.updates.length = 0;

        await h.recorder.discardRunningPlaceholder(runningTimer(h));

        expect(h.deletes).toEqual([NEW_SESSION_ID]);
    });

    it('keeps a line the user has since edited, and only takes the anchor off', async () => {
        const h = makeHarness();
        await h.recorder.startNextSession(makeTimer(h));
        // ユーザーが手を入れた（完了にした）ら、それはもう自分の行ではない。
        h.tasks.find(t => t.id === NEW_SESSION_ID)!.statusChar = 'x';
        h.updates.length = 0;

        await h.recorder.discardRunningPlaceholder(runningTimer(h));

        expect(h.deletes).toHaveLength(0);
        expect(h.updates).toEqual([{ id: NEW_SESSION_ID, updates: { blockId: undefined } }]);
    });

    it('does nothing when the timer opened no line (self, the first run: its tail is the target)', async () => {
        const h = makeHarness();
        await h.recorder.discardRunningPlaceholder(makeTimer(h, {
            session: { kind: 'running', from: 0 }, tail: TARGET_ANCHOR, owned: [TARGET_ANCHOR],
        }));

        expect(h.deletes).toHaveLength(0);
        expect(h.updates).toHaveLength(0);
    });
});

describe('releaseAnchors: closing the widget takes off the ids its writes put on', () => {
    it('takes the id off the tail record', async () => {
        const h = makeHarness();

        await h.recorder.releaseAnchors(makeTimer(h));

        expect(h.updates).toEqual([{ id: TAIL_ID, updates: { blockId: undefined } }]);
    });

    it('keeps a hand-written block ID', async () => {
        const manual = makeHarness({
            tail: makeTask({
                id: TAIL_ID, file: 'notes/a.md', line: 3, content: '⏱️ 設計',
                statusChar: 'x', blockId: 'my-reference', anchor: 'my-reference',
            }),
        });

        await manual.recorder.releaseAnchors(makeTimer(manual, { tail: 'my-reference', owned: [] }));

        expect(manual.updates).toHaveLength(0);
    });
});
