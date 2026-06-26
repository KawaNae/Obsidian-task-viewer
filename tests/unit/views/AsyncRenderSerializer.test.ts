import { describe, it, expect, vi } from 'vitest';
import { AsyncRenderSerializer } from '../../../src/views/sharedUI/AsyncRenderSerializer';

describe('AsyncRenderSerializer', () => {
    it('runs a single request exactly once', async () => {
        const run = vi.fn().mockResolvedValue(undefined);
        const s = new AsyncRenderSerializer(run);
        await s.request();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('runs again on a fresh request after the previous one settled', async () => {
        const run = vi.fn().mockResolvedValue(undefined);
        const s = new AsyncRenderSerializer(run);
        await s.request();
        await s.request();
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('coalesces multiple mid-flight requests into a SINGLE trailing run', async () => {
        let resolveFirst!: () => void;
        let n = 0;
        const run = vi.fn(() => {
            const id = ++n;
            return id === 1
                ? new Promise<void>((r) => { resolveFirst = r; })
                : Promise.resolve();
        });
        const s = new AsyncRenderSerializer(run);

        const p1 = s.request();   // starts run #1 (stays pending)
        const p2 = s.request();   // in-flight -> sets renderPending, returns
        const p3 = s.request();   // in-flight -> renderPending already true
        expect(run).toHaveBeenCalledTimes(1);

        resolveFirst();           // run #1 settles -> ONE trailing run #2
        await Promise.all([p1, p2, p3]);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('releases the gate after the run throws (a later request still runs)', async () => {
        const run = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue(undefined);
        const s = new AsyncRenderSerializer(run);

        await expect(s.request()).rejects.toThrow('boom');
        await s.request();
        expect(run).toHaveBeenCalledTimes(2);
    });
});
