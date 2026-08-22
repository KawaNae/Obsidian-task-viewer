import { describe, it, expect } from 'vitest';
import { RenderScheduler, shouldRenderForChanges } from '../../../src/views/sharedUI/RenderScheduler';

/**
 * A host node whose window has a frame clock we drive by hand.
 * HostFrameScheduler resolves the clock through `ownerDocument.defaultView`,
 * so modelling those two properties is enough — the "plain object, no jsdom"
 * pattern used in tests/unit/drag/GridMoveGesture.test.ts.
 */
function makeHost() {
    let nextId = 1;
    const pending = new Map<number, () => void>();
    const win = {
        requestAnimationFrame(cb: () => void): number {
            const id = nextId++;
            pending.set(id, cb);
            return id;
        },
        cancelAnimationFrame(id: number): void {
            pending.delete(id);
        },
    };
    const node = { nodeType: 1, ownerDocument: { defaultView: win } } as unknown as Node;
    return {
        node,
        /** Run every frame currently queued (callbacks queued during the tick wait for the next one). */
        tick(): void {
            const due = [...pending.entries()];
            pending.clear();
            for (const [, cb] of due) cb();
        },
        pendingCount: () => pending.size,
    };
}

describe('RenderScheduler coalescing', () => {
    it('renders once for a burst of requests inside one frame', () => {
        const host = makeHost();
        let renders = 0;
        const s = new RenderScheduler({ performFull: () => { renders++; }, getHost: () => host.node });

        s.scheduleRender();
        s.scheduleRender();
        s.scheduleRender();
        expect(renders).toBe(0);   // nothing runs before the frame
        // One frame for the whole burst, not one per request. Asserted
        // separately from the render count because the dirty flag would keep
        // that at 1 even if every request queued its own frame.
        expect(host.pendingCount()).toBe(1);

        host.tick();
        expect(renders).toBe(1);
    });

    it('renders again for a request made after the frame ran', () => {
        const host = makeHost();
        let renders = 0;
        const s = new RenderScheduler({ performFull: () => { renders++; }, getHost: () => host.node });

        s.scheduleRender();
        host.tick();
        s.scheduleRender();
        host.tick();
        expect(renders).toBe(2);
    });

    it('coalesces onChange notifications and drops the ones with no visual effect', () => {
        const host = makeHost();
        let renders = 0;
        const s = new RenderScheduler({ performFull: () => { renders++; }, getHost: () => host.node });

        s.handleChange('t1', ['blockId']);
        s.handleChange('t2', ['timerTargetId']);
        expect(host.pendingCount()).toBe(0);   // no frame was even requested

        s.handleChange('t3', ['statusChar']);
        s.handleChange('t4', ['startDate']);
        host.tick();
        expect(renders).toBe(1);
    });

    it('performImmediate renders synchronously and consumes the pending frame', () => {
        const host = makeHost();
        let renders = 0;
        const s = new RenderScheduler({ performFull: () => { renders++; }, getHost: () => host.node });

        s.scheduleRender();
        s.performImmediate();
        expect(renders).toBe(1);

        host.tick();
        expect(renders).toBe(1);   // the queued frame must not render a second time
    });

    it('cancelPending drops a queued render without running it', () => {
        const host = makeHost();
        let renders = 0;
        const s = new RenderScheduler({ performFull: () => { renders++; }, getHost: () => host.node });

        s.scheduleRender();
        s.cancelPending();
        expect(host.pendingCount()).toBe(0);
        host.tick();
        expect(renders).toBe(0);
    });

    it('dispose stops a queued render from firing after the view is gone', () => {
        const host = makeHost();
        let renders = 0;
        const s = new RenderScheduler({ performFull: () => { renders++; }, getHost: () => host.node });

        s.scheduleRender();
        s.dispose();
        // The queued frame must be withdrawn, not merely made a no-op: after
        // the view unloads its callback would touch detached DOM.
        expect(host.pendingCount()).toBe(0);
        host.tick();
        expect(renders).toBe(0);
    });
});

describe('shouldRenderForChanges', () => {
    it('skips render when every changed key is internal (blockId / timerTargetId)', () => {
        expect(shouldRenderForChanges(['blockId'])).toBe(false);
        expect(shouldRenderForChanges(['timerTargetId'])).toBe(false);
        expect(shouldRenderForChanges(['blockId', 'timerTargetId'])).toBe(false);
    });

    it('renders when any changed key has visual effect', () => {
        expect(shouldRenderForChanges(['statusChar'])).toBe(true);
        expect(shouldRenderForChanges(['startDate'])).toBe(true);
        // mixed: a visual key alongside an internal one still renders
        expect(shouldRenderForChanges(['timerTargetId', 'statusChar'])).toBe(true);
    });

    it('renders when change info is absent (undefined / empty) — cannot prove it is a no-op', () => {
        expect(shouldRenderForChanges(undefined)).toBe(true);
        expect(shouldRenderForChanges([])).toBe(true);
    });
});
