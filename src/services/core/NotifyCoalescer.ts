/** A listener of the index's changes: a span (a row's name and the fields that moved), or no arguments for everything. */
export type ChangeListener = (taskId?: string, changes?: string[]) => void;

/**
 * The one way the index tells its listeners that what it holds changed, and
 * the listeners themselves: two ports, {@link schedule} and
 * {@link flushNow}, and nothing else calls a listener.
 *
 * Merges the change notifications of one frame into a single emission. A
 * notification is either a change span — one task id plus the fields that
 * moved — or a full invalidation. Merging is what keeps a span a span: two
 * spans for the same task join into one, and anything else (a second task, or
 * a caller that could not name a task) collapses to a full invalidation,
 * because a listener told "task A's start moved" would otherwise never hear
 * about task B.
 *
 * The buffer is separate from the timer on purpose. `flushNow` has to emit the
 * same merged result the timer would have, so both go through {@link merge}
 * and {@link flush} rather than each deciding what to send.
 */
export class NotifyCoalescer {
    /**
     * - `null`: nothing pending
     * - `'full'`: id unknown, or several ids mixed → invalidate everything
     * - `{ taskId, changes }`: one task's change span (changes accumulate)
     */
    private pending: { taskId: string; changes: Set<string> } | 'full' | null = null;
    /** Whether the pending full emission is told each listener in a macrotask of its own. */
    private staggered = false;
    private timer: NodeJS.Timeout | null = null;
    private listeners: ChangeListener[] = [];

    constructor(private readonly debounceMs: number) {}

    /** Listen to what is emitted. @returns the unsubscribe. */
    onChange(listener: ChangeListener): () => void {
        this.listeners.push(listener);
        return () => {
            const at = this.listeners.indexOf(listener);
            if (at !== -1) this.listeners.splice(at, 1);
        };
    }

    /**
     * Take a notification into the buffer and emit after `debounceMs` of quiet.
     * Successive calls restart the wait, so a burst renders once.
     *
     * `staggered`: the full emission this one ends in tells each listener in
     * a macrotask of its own, for a change every view redraws after — the
     * vault read whole, the settings changed — so no one task of the browser
     * runs every redraw (Chrome's Long Task warning). A timer, not a frame: the
     * index has no window of its own, and a popout's views would never hear
     * from the main window's frame clock when that window is hidden.
     */
    schedule(taskId?: string, changes?: string[], opts: { staggered?: boolean } = {}): void {
        this.merge(taskId, changes);
        if (opts.staggered) this.staggered = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush();
        }, this.debounceMs);
    }

    /**
     * Emit the buffer now, cancelling any pending wait, every listener in
     * this task.
     *
     * Used when the DOM has to match the model in this frame — the end of a
     * drag, the clock turning a card overdue.
     */
    flushNow(taskId?: string, changes?: string[]): void {
        this.merge(taskId, changes);
        this.staggered = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.flush();
    }

    /** Drop the pending wait. A notify after unload has nothing left to tell. */
    dispose(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.pending = null;
        this.staggered = false;
    }

    private merge(taskId?: string, changes?: string[]): void {
        if (!taskId || !changes) {
            this.pending = 'full';
            return;
        }
        if (this.pending === null) {
            this.pending = { taskId, changes: new Set(changes) };
            return;
        }
        if (this.pending === 'full') return;
        if (this.pending.taskId === taskId) {
            for (const k of changes) this.pending.changes.add(k);
        } else {
            this.pending = 'full';
        }
    }

    private flush(): void {
        const pending = this.pending;
        const staggered = this.staggered;
        this.pending = null;
        this.staggered = false;
        if (pending === null) return;
        const listeners = [...this.listeners];
        if (pending !== 'full') {
            const changes = [...pending.changes];
            for (const listener of listeners) listener(pending.taskId, changes);
        } else if (staggered) {
            for (const listener of listeners) setTimeout(() => listener(), 0);
        } else {
            for (const listener of listeners) listener();
        }
    }
}
