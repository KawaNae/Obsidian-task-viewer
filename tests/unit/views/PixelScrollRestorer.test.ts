import { describe, it, expect } from 'vitest';
import { PixelScrollRestorer } from '../../../src/views/sharedUI/PixelScrollRestorer';

/**
 * A scroll element whose window has a frame clock we drive by hand.
 * HostFrameScheduler resolves the clock through `ownerDocument.defaultView`,
 * so modelling that plus the two scroll offsets is enough — the "plain object,
 * no jsdom" pattern used in tests/unit/drag/GridMoveGesture.test.ts.
 */
function makeScrollEl(top = 0, left = 0) {
    let nextId = 1;
    const pending = new Map<number, () => void>();
    const win = {
        requestAnimationFrame(cb: () => void): number {
            const id = nextId++;
            pending.set(id, cb);
            return id;
        },
        cancelAnimationFrame(id: number): void { pending.delete(id); },
    };
    const el = {
        nodeType: 1,
        scrollTop: top,
        scrollLeft: left,
        ownerDocument: { defaultView: win },
    };
    return {
        el: el as unknown as HTMLElement,
        raw: el,
        tick(): void {
            const due = [...pending.values()];
            pending.clear();
            for (const cb of due) cb();
        },
        pendingCount: () => pending.size,
    };
}

describe('PixelScrollRestorer', () => {
    it('restores the vertical position across a rebuild', () => {
        const host = makeScrollEl(150, 0);
        const r = new PixelScrollRestorer(() => host.el);

        r.save();
        host.raw.scrollTop = 0;   // the rebuild resets the element
        r.restore();
        expect(host.raw.scrollTop).toBe(150);
    });

    it('leaves the horizontal position alone by default', () => {
        // Calendar and Schedule rely on this: they never scroll sideways, and
        // writing scrollLeft there would be a behaviour change.
        const host = makeScrollEl(150, 90);
        const r = new PixelScrollRestorer(() => host.el);

        r.save();
        host.raw.scrollTop = 0;
        host.raw.scrollLeft = 0;
        r.restore();
        expect(host.raw.scrollTop).toBe(150);
        expect(host.raw.scrollLeft).toBe(0);
    });

    it('restores both axes when asked', () => {
        const host = makeScrollEl(150, 90);
        const r = new PixelScrollRestorer(() => host.el, { axis: 'both' });

        r.save();
        host.raw.scrollTop = 0;
        host.raw.scrollLeft = 0;
        r.restore();
        expect(host.raw.scrollTop).toBe(150);
        expect(host.raw.scrollLeft).toBe(90);
    });

    it('re-applies the position on the next frame', () => {
        // A sync write alone is not enough: views that rebuild their scaffolding
        // settle their layout asynchronously and would drift back.
        const host = makeScrollEl(150, 90);
        const r = new PixelScrollRestorer(() => host.el, { axis: 'both' });

        r.save();
        host.raw.scrollTop = 0;
        host.raw.scrollLeft = 0;
        r.restore();

        host.raw.scrollTop = 7;    // late layout knocks it off
        host.raw.scrollLeft = 7;
        host.tick();
        expect(host.raw.scrollTop).toBe(150);
        expect(host.raw.scrollLeft).toBe(90);
    });

    it('ignores save() while a restore is still being applied', () => {
        // Between the sync write and the next-frame re-apply, scrollTop holds a
        // value the restorer itself put there (or transient layout jitter).
        // Saving it would poison the *next* restore, so the guard is checked on
        // the round after — checking the pending frame's own write would not
        // see the difference, since restore() captured its target beforehand.
        const host = makeScrollEl(150, 90);
        const r = new PixelScrollRestorer(() => host.el, { axis: 'both' });

        r.save();
        host.raw.scrollTop = 0;
        r.restore();

        host.raw.scrollTop = 999;   // mid-restore transient
        r.save();                   // suppressed while the frame is pending
        host.tick();

        host.raw.scrollTop = 0;
        r.restore();
        expect(host.raw.scrollTop).toBe(150);   // not 999
    });

    it('saves again once the restore frame has run', () => {
        const host = makeScrollEl(150, 90);
        const r = new PixelScrollRestorer(() => host.el, { axis: 'both' });

        r.save();
        host.raw.scrollTop = 0;
        r.restore();
        host.tick();

        host.raw.scrollTop = 42;
        r.save();
        host.raw.scrollTop = 0;
        r.restore();
        expect(host.raw.scrollTop).toBe(42);
    });

    it('does nothing when restore() runs before any save()', () => {
        const host = makeScrollEl(0, 0);
        const r = new PixelScrollRestorer(() => host.el, { axis: 'both' });

        host.raw.scrollTop = 33;
        r.restore();
        expect(host.raw.scrollTop).toBe(33);
        expect(host.pendingCount()).toBe(0);
    });

    it('dispose withdraws the queued re-apply', () => {
        const host = makeScrollEl(150, 0);
        const r = new PixelScrollRestorer(() => host.el);

        r.save();
        host.raw.scrollTop = 0;
        r.restore();
        r.dispose();
        expect(host.pendingCount()).toBe(0);
    });
});
