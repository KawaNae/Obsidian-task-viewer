/**
 * A short-lived "this path was just written by us" mark.
 *
 * Mark a path, ask whether it is still marked, and let the mark expire on
 * its own. The index keeps one: the paths the API just wrote (`apiWrites`).
 *
 * The TTL is per instance, so the window's length is stated once, where the
 * window is created, instead of living in a constant next to a `setTimeout`.
 */
export class PathTtlWindow {
    private readonly timers = new Map<string, NodeJS.Timeout>();

    constructor(private readonly ttlMs: number) {}

    /** Mark `path`, restarting the window if it was already marked. */
    mark(path: string): void {
        const existing = this.timers.get(path);
        if (existing) clearTimeout(existing);
        this.timers.set(path, setTimeout(() => {
            this.timers.delete(path);
        }, this.ttlMs));
    }

    has(path: string): boolean {
        return this.timers.has(path);
    }

    /** Drop the mark now, without waiting for the window to close. */
    clear(path: string): void {
        const timer = this.timers.get(path);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(path);
        }
    }

    /** Cancel every pending window. A timer that fires after unload is waste. */
    dispose(): void {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
    }
}
