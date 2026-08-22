/**
 * Merges the change notifications of one frame into a single emission.
 *
 * A notification is either a change span — one task id plus the fields that
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
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly emit: (taskId?: string, changes?: string[]) => void,
        private readonly debounceMs: number,
    ) {}

    /**
     * Take a notification into the buffer and emit after `debounceMs` of quiet.
     * Successive calls restart the wait, so a burst renders once.
     */
    schedule(taskId?: string, changes?: string[]): void {
        this.merge(taskId, changes);
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush();
        }, this.debounceMs);
    }

    /**
     * Emit the buffer now, cancelling any pending wait.
     *
     * Used when the DOM has to match the model in this frame — the end of a
     * drag, or an API write whose caller is about to hand control back.
     */
    flushNow(taskId?: string, changes?: string[]): void {
        this.merge(taskId, changes);
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
        this.pending = null;
        if (pending === null) return;
        if (pending === 'full') {
            this.emit();
        } else {
            this.emit(pending.taskId, [...pending.changes]);
        }
    }
}
