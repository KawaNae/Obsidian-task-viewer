import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import type { TimerStorageUtils } from '../../../src/timer/TimerStorageUtils';
import type TaskViewerPlugin from '../../../src/main';
import { makeTask } from '../helpers/makeTask';

/**
 * A timer takes a `^id` off only when its own write put it on
 * (`ownedAnchors`), and only when no open timer holds it as its target or its
 * tail (`TimerRecorder.mayTakeOff`). The id's shape says nothing: a `tv-t-` id
 * the timer did not put on stays. A row is found by its anchor
 * (`getTaskByAnchor`); a row the user deleted is found by nothing.
 */

const FILE = 'notes/a.md';
const TARGET_ID = 'tv-inline:notes/a.md:ln:3';
const TAIL_ID = 'tv-inline:notes/a.md:ln:5';
const ANCHOR = 'tv-t-anchor';
const TAIL_BLOCK_ID = 'tv-t-tail';

function makeTimer(overrides: Partial<TimerInstance> = {}): TimerInstance {
    return {
        id: 'timer-1',
        taskId: TARGET_ID,
        taskName: 'target',
        taskOriginalText: '- [ ] target',
        taskFile: FILE,
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
        pendingRecord: null,
        opening: null,
        ownedAnchors: [],
        ...overrides,
    } as TimerInstance;
}

// `tailIsTarget`: the tail line carries the target's own anchor (self mode,
// first session). `found`: whether `getTaskByAnchor` finds the rows.
// `owned`: the anchors the timer's writes put on. `others`: the other open timers.
function harness(opts: { tailIsTarget: boolean; found: boolean; owned: string[]; others?: Partial<TimerInstance>[] }) {
    const tailBlockId = opts.tailIsTarget ? ANCHOR : TAIL_BLOCK_ID;
    const target = makeTask({ id: TARGET_ID, file: FILE, line: 3, content: 'target', blockId: ANCHOR });
    const tail = opts.tailIsTarget
        ? target
        : makeTask({ id: TAIL_ID, file: FILE, line: 5, content: 'record', blockId: TAIL_BLOCK_ID, statusChar: 'x', endTime: '10:00' });
    const rows = new Map([[ANCHOR, target], [TAIL_BLOCK_ID, tail]]);
    const updateTask = vi.fn(async () => true);
    const getTaskByAnchor = vi.fn((file: string, anchor: string) =>
        (opts.found && file === FILE) ? rows.get(anchor) : undefined);
    const taskIndex = {
        getTasks: () => [target, tail],
        getTask: (id: string) => [target, tail].find(t => t.id === id),
        getTaskByAnchor,
        updateTask,
        waitForScan: vi.fn(async () => { /* the scan is done */ }),
        deleteTask: vi.fn(async () => true),
    };
    const plugin = { settings: {}, getTaskIndex: () => taskIndex } as unknown as TaskViewerPlugin;
    const timer = makeTimer({ tailRecordBlockId: tailBlockId, timerTargetId: ANCHOR, ownedAnchors: opts.owned });
    const others = (opts.others ?? []).map((o, i) => makeTimer({ id: `other-${i}`, ...o }));
    const recorder = new TimerRecorder({} as App, plugin, {} as TimerStorageUtils, () => { /* unused */ }, () => [timer, ...others]);
    return { recorder, timer, updateTask, getTaskByAnchor };
}

describe('✕ on a running timer: the tail line is taken away by the one rule', () => {
    it('a tail equal to the target\'s anchor is not touched (the target keeps it until close)', async () => {
        const h = harness({ tailIsTarget: true, found: true, owned: [ANCHOR] });

        await h.recorder.discardRunningPlaceholder(h.timer);

        expect(h.updateTask).not.toHaveBeenCalled();
    });

    it('a tail of its own, found by its anchor and since edited, has its anchor taken off', async () => {
        const h = harness({ tailIsTarget: false, found: true, owned: [ANCHOR, TAIL_BLOCK_ID] });

        await h.recorder.discardRunningPlaceholder(h.timer);

        expect(h.getTaskByAnchor).toHaveBeenCalledWith(FILE, TAIL_BLOCK_ID);
        expect(h.updateTask).toHaveBeenCalledTimes(1);
        expect(h.updateTask).toHaveBeenCalledWith(TAIL_ID, { blockId: undefined });
    });

    it('a tail not found by its anchor is not touched', async () => {
        const h = harness({ tailIsTarget: false, found: false, owned: [ANCHOR, TAIL_BLOCK_ID] });

        await h.recorder.discardRunningPlaceholder(h.timer);

        expect(h.updateTask).not.toHaveBeenCalled();
    });

    it('a tail another open timer runs on as its target is not touched', async () => {
        const h = harness({
            tailIsTarget: false, found: true, owned: [ANCHOR, TAIL_BLOCK_ID],
            others: [{ taskFile: FILE, timerTargetId: TAIL_BLOCK_ID }],
        });

        await h.recorder.discardRunningPlaceholder(h.timer);

        expect(h.updateTask).not.toHaveBeenCalled();
    });
});

describe('close: the timer takes off what it put on, and nothing else', () => {
    it('takes off the target\'s and the tail\'s anchors it put on', async () => {
        const h = harness({ tailIsTarget: false, found: true, owned: [ANCHOR, TAIL_BLOCK_ID] });

        await h.recorder.releaseAnchors(h.timer);

        expect(h.updateTask).toHaveBeenCalledWith(TARGET_ID, { blockId: undefined });
        expect(h.updateTask).toHaveBeenCalledWith(TAIL_ID, { blockId: undefined });
    });

    it('self: the target\'s anchor is the tail too, and is taken off once', async () => {
        const h = harness({ tailIsTarget: true, found: true, owned: [ANCHOR] });

        await h.recorder.releaseAnchors(h.timer);

        expect(h.updateTask).toHaveBeenCalledTimes(1);
        expect(h.updateTask).toHaveBeenCalledWith(TARGET_ID, { blockId: undefined });
    });

    it('an anchor of the timer\'s shape that its writes did not put on stays', async () => {
        const h = harness({ tailIsTarget: false, found: true, owned: [TAIL_BLOCK_ID] });

        await h.recorder.releaseAnchors(h.timer);

        expect(h.updateTask).toHaveBeenCalledTimes(1);
        expect(h.updateTask).toHaveBeenCalledWith(TAIL_ID, { blockId: undefined });
    });

    it('an anchor another open timer holds as its target or its tail stays', async () => {
        const h = harness({
            tailIsTarget: false, found: true, owned: [ANCHOR, TAIL_BLOCK_ID],
            others: [{ taskFile: FILE, timerTargetId: TAIL_BLOCK_ID }, { taskFile: FILE, tailRecordBlockId: ANCHOR }],
        });

        await h.recorder.releaseAnchors(h.timer);

        expect(h.updateTask).not.toHaveBeenCalled();
    });

    it('a row not found by its anchor is not touched', async () => {
        const h = harness({ tailIsTarget: false, found: false, owned: [ANCHOR, TAIL_BLOCK_ID] });

        await h.recorder.releaseAnchors(h.timer);

        expect(h.updateTask).not.toHaveBeenCalled();
    });
});
