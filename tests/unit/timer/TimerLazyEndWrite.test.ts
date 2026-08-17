import { describe, expect, it } from 'vitest';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import type TaskViewerPlugin from '../../../src/main';
import type { App } from 'obsidian';
import { makeTask } from '../helpers/makeTask';

/**
 * 書き足しの宛先は「今どの行に走っているか」で決まる。child モードなら
 * 自分が書いたセッション行で、器であるタスク行ではない。実効 end の内側では
 * 1 バイトも書かない（常時書き込みではない、が仕様の核）。
 */

const PARENT_ID = 'tv-inline:notes/a.md:ln:3';
const CHILD_ID = 'tv-inline:notes/a.md:blk:tv-timer-1';

const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function makeHarness(effectiveEnd: Date) {
    const updates: { id: string; updates: Record<string, unknown> }[] = [];

    const parent = makeTask({ id: PARENT_ID, file: 'notes/a.md', content: 'parent' });
    const child = makeTask({ id: CHILD_ID, file: 'notes/a.md', content: 'parent', blockId: 'tv-timer-1' });

    const taskIndex = {
        getTask: (id: string) => (id === CHILD_ID ? child : id === PARENT_ID ? parent : undefined),
        getTasks: () => [parent, child],
        updateTask: async (id: string, u: Record<string, unknown>) => { updates.push({ id, updates: u }); },
        waitForScan: async () => { /* unused */ },
    };

    const plugin = {
        settings: {},
        getTaskIndex: () => taskIndex,
        getTaskReadService: () => ({
            getDisplayTask: (id: string) => (id === CHILD_ID
                ? {
                    ...child,
                    effectiveEndDate: dateOf(effectiveEnd),
                    effectiveEndTime: timeOf(effectiveEnd),
                }
                : undefined),
        }),
    } as unknown as TaskViewerPlugin;

    const recorder = new TimerRecorder(
        {} as App, plugin,
        { generateTimerTargetId: () => 'tv-timer-2' } as unknown as TimerStorageUtils
    );
    (recorder as unknown as { resolver: { resolveTvInline: () => unknown; resolveTvFile: () => unknown } }).resolver = {
        resolveTvInline: () => parent,
        resolveTvFile: () => parent,
    };

    return { recorder, updates };
}

function runningTimer(): TimerInstance {
    return {
        id: 'timer-1',
        taskId: PARENT_ID,
        taskName: 'parent',
        taskFile: 'notes/a.md',
        taskOriginalText: '- [ ] parent',
        tailRecordBlockId: 'tv-timer-1',
        recordedChildTaskId: CHILD_ID,
        startTimeMs: Date.now(),
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
    } as TimerInstance;
}

describe('extendRunningSession', () => {
    it('実効 end の内側では書かない', async () => {
        const h = makeHarness(new Date(Date.now() + 30 * 60_000));
        const floor = await h.recorder.extendRunningSession(runningTimer());

        expect(h.updates).toHaveLength(0);
        expect(floor).toBeGreaterThan(Date.now());
    });

    it('実効 end を過ぎたら走行中の行の end を書き足す', async () => {
        const h = makeHarness(new Date(Date.now() - 60_000));
        const floor = await h.recorder.extendRunningSession(runningTimer());

        expect(h.updates).toHaveLength(1);
        // 器のタスク行ではなく、走行中のセッション行に書く。
        expect(h.updates[0].id).toBe(CHILD_ID);
        expect(h.updates[0].updates).toHaveProperty('endDate');
        expect(h.updates[0].updates).toHaveProperty('endTime');
        expect(floor).toBeGreaterThan(Date.now());
    });

    it('書き足す end は現在より未来', async () => {
        const h = makeHarness(new Date(Date.now() - 60_000));
        await h.recorder.extendRunningSession(runningTimer());

        const { endDate, endTime } = h.updates[0].updates as { endDate: string; endTime: string };
        expect(new Date(`${endDate}T${endTime}`).getTime()).toBeGreaterThan(Date.now());
    });
});
