import { describe, expect, it, vi, afterEach } from 'vitest';
import { TimerContentBinding, CONTENT_WRITE_DEBOUNCE_MS } from '../../../src/timer/TimerContentBinding';
import type { TimerContext } from '../../../src/timer/TimerContext';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import { makeTask } from '../helpers/makeTask';

/**
 * A flush that arrives while the typed name is being written answers with that
 * write's outcome, not with a guess.
 *
 * Stopping a timer flushes the name and records only if it was written
 * (`TimerLifecycle.flushAndRecord`). A flush that answered "written" without
 * waiting would let the stop record past a name that was then refused, and
 * the user would hear twice: the refusal, then the record.
 */

const TAIL_ID = 'tv-inline:notes/a.md:blk:tv-t-1';

function harness() {
    let settle!: (written: boolean) => void;
    const calls: string[] = [];
    const timer = {
        id: 'timer-1',
        taskId: 'tv-inline:notes/a.md:ln:3',
        taskName: '器タスク',
        taskFile: 'notes/a.md',
        recordMode: 'child',
        timerType: 'countup',
        runState: 'running',
    } as unknown as TimerInstance;
    let tail = makeTask({ id: TAIL_ID, file: 'notes/a.md', line: 3, content: '器タスク', blockId: 'tv-t-1' });
    const ctx = {
        timers: new Map([[timer.id, timer]]),
        recorder: { resolveTailRecord: () => tail },
        plugin: {
            getTaskIndex: () => ({
                updateTask: (_id: string, u: Record<string, unknown>) => {
                    calls.push(u.content as string);
                    return new Promise<boolean>((resolve) => {
                        settle = (written) => {
                            // A write that lands is on the line, as the index would read it.
                            if (written) tail = { ...tail, content: u.content as string };
                            resolve(written);
                        };
                    });
                },
            }),
        },
        persistTimersToStorage: () => { /* not measured */ },
    } as unknown as TimerContext;
    const binding = new TimerContentBinding(ctx);
    const input = { value: '器タスク', oninput: null as (() => void) | null, ownerDocument: { activeElement: null } };
    binding.bind(timer, input as unknown as HTMLInputElement);
    return {
        binding, timer, calls,
        type(value: string) { input.value = value; input.oninput?.(); },
        settle: (written: boolean) => settle(written),
    };
}

describe('TimerContentBinding: a flush during a write', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('answers not written when the write in flight is refused, and keeps the name as the draft', async () => {
        vi.useFakeTimers();
        const h = harness();
        h.type('新しい名前');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS + 1);
        expect(h.calls).toEqual(['新しい名前']);

        const flushed = h.binding.flush(h.timer);
        h.settle(false);

        expect(await flushed).toBe(false);
        expect(h.timer.pendingContent).toBe('新しい名前');
    });

    it('answers written when the write in flight lands', async () => {
        vi.useFakeTimers();
        const h = harness();
        h.type('新しい名前');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS + 1);

        const flushed = h.binding.flush(h.timer);
        h.settle(true);

        expect(await flushed).toBe(true);
        expect(h.timer.pendingContent).toBeUndefined();
    });

    it('keeps a later name as the draft when the first lands and the later one is refused', async () => {
        // The name typed during the first write is the draft until that write
        // lands, which clears the draft. The refusal of the later name is then
        // the only thing that can put it back, for the next flush to write.
        vi.useFakeTimers();
        const h = harness();
        h.type('一つ目');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS + 1);
        h.type('二つ目');

        const flushed = h.binding.flush(h.timer);
        h.settle(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(h.calls).toEqual(['一つ目', '二つ目']);
        h.settle(false);

        expect(await flushed).toBe(false);
        expect(h.timer.pendingContent).toBe('二つ目');

        // The next flush writes it again.
        const again = h.binding.flush(h.timer);
        await vi.advanceTimersByTimeAsync(0);
        expect(h.calls).toEqual(['一つ目', '二つ目', '二つ目']);
        h.settle(true);
        expect(await again).toBe(true);
        expect(h.timer.pendingContent).toBeUndefined();
    });

    it('a refused write does not put its name back over a newer one typed on its way', async () => {
        // The draft already holds the newer name; the refusal of the older one
        // must not take it back, or a reload (or the field redrawn) shows the
        // older name and the newer keys are lost.
        vi.useFakeTimers();
        const h = harness();
        h.type('一つ目');
        await vi.advanceTimersByTimeAsync(CONTENT_WRITE_DEBOUNCE_MS + 1);
        expect(h.calls).toEqual(['一つ目']);
        h.type('二つ目');

        const flushed = h.binding.flush(h.timer);
        h.settle(false);

        expect(await flushed).toBe(false);
        expect(h.timer.pendingContent).toBe('二つ目');
        expect(h.binding.displayValue(h.timer)).toBe('二つ目');
        // Nothing but the refused write went out.
        expect(h.calls).toEqual(['一つ目']);

        // The next flush writes the newer name, and only it.
        const again = h.binding.flush(h.timer);
        await vi.advanceTimersByTimeAsync(0);
        expect(h.calls).toEqual(['一つ目', '二つ目']);
        h.settle(true);
        expect(await again).toBe(true);
        expect(h.timer.pendingContent).toBeUndefined();
    });

    it('writes a name flushed after a flush that had nothing to write', async () => {
        const h = harness();
        // A stop flushes whether or not a name was typed.
        expect(await h.binding.flush(h.timer)).toBe(true);
        expect(h.calls).toEqual([]);

        h.timer.pendingContent = 'あとで打った名前';
        const flushed = h.binding.flush(h.timer);
        await Promise.resolve();
        expect(h.calls).toEqual(['あとで打った名前']);
        h.settle(true);
        expect(await flushed).toBe(true);
        expect(h.timer.pendingContent).toBeUndefined();
    });
});
