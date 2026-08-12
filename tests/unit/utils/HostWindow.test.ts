import { describe, expect, it } from 'vitest';
import { HostFrameScheduler, hostWindow } from '../../../src/utils/HostWindow';

/**
 * rAF を手動で進められる fake window。popout window の代役。
 * 実 DOM を必要としないため vitest の node environment のままで動く。
 */
class FakeWindow {
    private nextId = 1;
    private frames = new Map<number, () => void>();
    cancelled: number[] = [];

    requestAnimationFrame(cb: () => void): number {
        const id = this.nextId++;
        this.frames.set(id, cb);
        return id;
    }

    cancelAnimationFrame(id: number): void {
        this.cancelled.push(id);
        this.frames.delete(id);
    }

    /** 現在キューに入っているコールバックを 1 フレーム分発火する。 */
    flush(): void {
        const due = [...this.frames.entries()];
        this.frames.clear();
        for (const [, cb] of due) cb();
    }

    get pendingCount(): number {
        return this.frames.size;
    }
}

/** `ownerDocument.defaultView` だけを持つ最小の host ノード。 */
function makeHost(win: FakeWindow): Node {
    return { nodeType: 1, ownerDocument: { defaultView: win } } as unknown as Node;
}

describe('hostWindow', () => {
    it('resolves the window that owns the node', () => {
        const win = new FakeWindow();
        expect(hostWindow(makeHost(win))).toBe(win as unknown as Window);
    });

    it('accepts a Document directly', () => {
        const win = new FakeWindow();
        const doc = { nodeType: 9, defaultView: win } as unknown as Document;
        expect(hostWindow(doc)).toBe(win as unknown as Window);
    });

    it('falls back to the realm window when the node is null', () => {
        expect(hostWindow(null)).toBe(globalThis.window as unknown as Window);
    });
});

describe('HostFrameScheduler', () => {
    it('schedules on the host window, not the global one', () => {
        const win = new FakeWindow();
        const scheduler = new HostFrameScheduler(() => makeHost(win));

        let ran = 0;
        scheduler.request(() => { ran++; });

        expect(win.pendingCount).toBe(1);
        win.flush();
        expect(ran).toBe(1);
    });

    it('re-resolves the host on every hop so a window move is followed', () => {
        const oldWin = new FakeWindow();
        const newWin = new FakeWindow();
        let current = oldWin;
        const scheduler = new HostFrameScheduler(() => makeHost(current));

        let ran = 0;
        scheduler.after(2, () => { ran++; });

        // 1 ホップ目は oldWin。ここで leaf が別 window へ移動する。
        expect(oldWin.pendingCount).toBe(1);
        current = newWin;
        oldWin.flush();

        // 2 ホップ目は移動先のクロックに乗る。
        expect(newWin.pendingCount).toBe(1);
        expect(ran).toBe(0);
        newWin.flush();
        expect(ran).toBe(1);
    });

    it('cancels against the window that scheduled the frame', () => {
        const win = new FakeWindow();
        const scheduler = new HostFrameScheduler(() => makeHost(win));

        let ran = 0;
        const token = scheduler.request(() => { ran++; });
        scheduler.cancel(token);

        expect(win.cancelled).toHaveLength(1);
        win.flush();
        expect(ran).toBe(0);
        expect(scheduler.hasPending()).toBe(false);
    });

    it('dispose cancels every outstanding frame, including mid-chain ones', () => {
        const win = new FakeWindow();
        const scheduler = new HostFrameScheduler(() => makeHost(win));

        let ran = 0;
        scheduler.request(() => { ran++; });
        scheduler.after(3, () => { ran++; });

        // チェーン途中 (残り 2 ホップ) で dispose しても発火しないこと。
        win.flush();
        expect(ran).toBe(1);

        scheduler.dispose();
        win.flush();
        expect(ran).toBe(1);
        expect(scheduler.hasPending()).toBe(false);
    });

    it('does not run a callback cancelled between the rAF and its firing', () => {
        const win = new FakeWindow();
        const scheduler = new HostFrameScheduler(() => makeHost(win));

        let ran = 0;
        const token = scheduler.request(() => { ran++; });
        // fake window 側の queue はそのままに、scheduler だけ cancel された状態を作る。
        win.cancelled.length = 0;
        scheduler.cancel(token);
        // cancel 済みトークンの再 cancel は no-op。
        scheduler.cancel(token);

        win.flush();
        expect(ran).toBe(0);
    });
});
