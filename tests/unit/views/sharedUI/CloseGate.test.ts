import { describe, it, expect, vi } from 'vitest';
import { CloseGate, type CloseAnswer } from '../../../../src/views/sharedUI/CloseGate';

/**
 * The closes the user asks for of an overlay, as its body answers them: at
 * once, or after a wait during which a further close asks nothing again.
 * The overlay is a stand-in that records its closes.
 */
function setUp(answer: () => CloseAnswer) {
    const host = {
        open: true,
        asked: 0,
        closes: 0,
        isOpen: () => host.open,
        ask: () => { host.asked++; return answer(); },
        close: () => { host.closes++; host.open = false; },
    };
    const gate = new CloseGate(host);
    return { host, gate };
}

function deferred() {
    let resolve!: (v: 'close' | 'stay') => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<'close' | 'stay'>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describe('CloseGate', () => {
    it('closes on an answer given at once before it returns, the close of the caller\'s choosing', async () => {
        const { host, gate } = setUp(() => 'close');
        const slid = vi.fn();
        const closed = gate.request(slid);
        expect(slid).toHaveBeenCalledTimes(1);
        expect(host.closes).toBe(0);
        expect(await closed).toBe(true);
    });

    it('stays open on stay, and answers true when not open, asking nothing', async () => {
        const { host, gate } = setUp(() => 'stay');
        expect(await gate.request()).toBe(false);
        expect(host.closes).toBe(0);
        host.open = false;
        expect(await gate.request()).toBe(true);
        expect(host.asked).toBe(1);
    });

    it('waits on a promise, the panel staying, and closes as the host does once it answers close', async () => {
        const wait = deferred();
        const { host, gate } = setUp(() => wait.promise);
        const slid = vi.fn();
        const first = gate.request(slid);
        const second = gate.request();
        expect(second).toBe(first);
        expect(host.asked).toBe(1);
        expect(host.closes).toBe(0);
        wait.resolve('close');
        expect(await first).toBe(true);
        expect(slid).not.toHaveBeenCalled();
        expect(host.closes).toBe(1);
    });

    it('stays on a promise that answers stay or fails, and asks again on the next close', async () => {
        const answers = [deferred(), deferred()];
        let i = 0;
        const { host, gate } = setUp(() => answers[i++].promise);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const first = gate.request();
        answers[0].resolve('stay');
        expect(await first).toBe(false);
        const second = gate.request();
        answers[1].reject(new Error('write failed'));
        expect(await second).toBe(false);
        expect(host.asked).toBe(2);
        expect(host.closes).toBe(0);
        error.mockRestore();
    });

    it('does not act on an answer that comes after the overlay closed or opened anew', async () => {
        const wait = deferred();
        const { host, gate } = setUp(() => wait.promise);
        const asked = gate.request();
        // The overlay closed by itself and opened again meanwhile.
        gate.reset();
        wait.resolve('close');
        expect(await asked).toBe(true);
        expect(host.closes).toBe(0);
    });
});
