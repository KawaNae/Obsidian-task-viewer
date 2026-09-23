import { describe, it, expect } from 'vitest';
import { EditorSignal, EDITOR_SIGNAL_LIFETIME_MS } from '../../../../src/services/core/EditorSignal';

/**
 * The editor's signal speaks for the change the editor saves next, and for
 * nothing after it (F6). Unbounded, a hand in the editor whose change never
 * reached a scan — typed and undone, or saved as the same bytes — left the
 * signal up for the next sync to fire on.
 */
describe('EditorSignal', () => {
    function clocked() {
        let now = 1_000_000;
        const signal = new EditorSignal(() => now);
        return { signal, advance: (ms: number) => { now += ms; } };
    }

    it('is taken once', () => {
        const { signal } = clocked();
        signal.mark('a.md');
        expect(signal.take('a.md')).toBe(true);
        expect(signal.take('a.md')).toBe(false);
    });

    it('speaks within its lifetime of the last hand, and not past it', () => {
        const { signal, advance } = clocked();
        signal.mark('a.md');
        advance(EDITOR_SIGNAL_LIFETIME_MS);
        expect(signal.take('a.md')).toBe(true);
        signal.mark('a.md');
        advance(EDITOR_SIGNAL_LIFETIME_MS + 1);
        expect(signal.take('a.md')).toBe(false);
    });

    it('counts the lifetime from the last hand, and keeps files apart', () => {
        const { signal, advance } = clocked();
        signal.mark('a.md');
        advance(EDITOR_SIGNAL_LIFETIME_MS - 1);
        signal.mark('a.md');
        advance(EDITOR_SIGNAL_LIFETIME_MS - 1);
        expect(signal.take('b.md')).toBe(false);
        expect(signal.take('a.md')).toBe(true);
    });
});
