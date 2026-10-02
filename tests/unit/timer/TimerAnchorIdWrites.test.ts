import { describe, expect, it, vi } from 'vitest';
import { TimerRecorder } from '../../../src/timer/TimerRecorder';
import type { TimerState } from '../../../src/timer/TimerState';
import { step, type TimerEvent } from '../../../src/timer/TimerTransitions';
import type TaskViewerPlugin from '../../../src/main';
import { makeTask } from '../helpers/makeTask';
import { opsOver } from '../helpers/anchoredRow';
import { timerOn } from '../helpers/timerRig';

/**
 * A timer takes a `^id` off only when its own write put it on (`owned`), and
 * only when no other open timer in the note looks a row up by it — as its
 * target, its tail, or the line it is in the middle of writing
 * (`opening.tail`; `TimerRecorder.mayTakeOff`, `anchorsOf`). The id's shape
 * says nothing: a `tv-t-` id the timer did not put on stays. A row is found
 * by its anchor (`getTaskByAnchor`); a row the user deleted is found by nothing.
 */

const FILE = 'notes/a.md';
const TARGET_ID = 'tv-inline:notes/a.md:ln:3';
const TAIL_ID = 'tv-inline:notes/a.md:ln:5';
const ANCHOR = 'tv-t-anchor';
const TAIL_BLOCK_ID = 'tv-t-tail';

/** An open timer on a row of `file` anchored `subject`, with `over` on top. */
function openTimer(subject: string, over: Partial<TimerState> = {}, file = FILE): TimerState {
    return { ...timerOn(makeTask({ file, content: 'target', anchor: subject }), 'child'), ...over };
}

// `tailIsTarget`: the tail line carries the target's own anchor (self, the
// first run). `found`: whether `getTaskByAnchor` finds the rows.
// `owned`: the anchors the timer's writes put on. `others`: the other open timers.
function harness(opts: { tailIsTarget: boolean; found: boolean; owned: string[]; others?: TimerState[] }) {
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
        deleteTask: vi.fn(async () => true),
    };
    const plugin = {
        settings: {},
        getIndex: () => taskIndex,
        getOperations: () => ({ ...opsOver(taskIndex) }),
    } as unknown as TaskViewerPlugin;
    const timer = openTimer(ANCHOR, { mode: opts.tailIsTarget ? 'self' : 'child', tail: tailBlockId, owned: opts.owned });
    const others = opts.others ?? [];
    const recorder = new TimerRecorder(plugin, {
        dispatch: (t: TimerState, event: TimerEvent) => { Object.assign(t, step(t, event, Date.now())); },
        timers: () => [timer, ...others],
    }, () => 'tv-t-new');
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
            others: [openTimer(TAIL_BLOCK_ID)],
        });

        await h.recorder.discardRunningPlaceholder(h.timer);

        expect(h.updateTask).not.toHaveBeenCalled();
    });

    it('a tail another open timer is writing as its next line is not touched', async () => {
        const h = harness({
            tailIsTarget: false, found: true, owned: [ANCHOR, TAIL_BLOCK_ID],
            others: [openTimer('tv-t-other', { opening: { tail: TAIL_BLOCK_ID, owned: [TAIL_BLOCK_ID] } })],
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
            others: [openTimer(TAIL_BLOCK_ID), openTimer('tv-t-other', { tail: ANCHOR })],
        });

        await h.recorder.releaseAnchors(h.timer);

        expect(h.updateTask).not.toHaveBeenCalled();
    });

    it('an anchor another open timer is in the middle of a write on (its opening\'s tail) stays', async () => {
        // The other timer's write lands with that anchor as its tail: taken off
        // now, the timer could not find its line once its write is back.
        const h = harness({
            tailIsTarget: false, found: true, owned: [ANCHOR, TAIL_BLOCK_ID],
            others: [openTimer('tv-t-other', { opening: { tail: TAIL_BLOCK_ID, owned: [TAIL_BLOCK_ID] } })],
        });

        await h.recorder.releaseAnchors(h.timer);

        expect(h.updateTask).toHaveBeenCalledTimes(1);
        expect(h.updateTask).toHaveBeenCalledWith(TARGET_ID, { blockId: undefined });
    });

    it('a timer in another note does not hold an anchor of this one', async () => {
        const h = harness({
            tailIsTarget: false, found: true, owned: [ANCHOR, TAIL_BLOCK_ID],
            others: [openTimer(TAIL_BLOCK_ID, { opening: { tail: ANCHOR, owned: [] } }, 'notes/b.md')],
        });

        await h.recorder.releaseAnchors(h.timer);

        expect(h.updateTask).toHaveBeenCalledTimes(2);
    });

    it('a row not found by its anchor is not touched', async () => {
        const h = harness({ tailIsTarget: false, found: false, owned: [ANCHOR, TAIL_BLOCK_ID] });

        await h.recorder.releaseAnchors(h.timer);

        expect(h.updateTask).not.toHaveBeenCalled();
    });
});
