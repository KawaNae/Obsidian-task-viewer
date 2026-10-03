/**
 * The state of one view, held as one value.
 *
 * A change comes in only through `update(patch)`: the patch is merged
 * shallowly into a new value, and every listener hears the patch and the
 * value before it, in the order it subscribed. The value handed out by
 * `get()` is never changed in place, so a reader may keep it.
 *
 * A patch is told even when it changes nothing (Now pressed while the view
 * already follows today): the caller asked for it, and the view's answer to
 * it (draw, scroll to now) is still due.
 */

export type StoreListener<S> = (patch: Readonly<Partial<S>>, prev: Readonly<S>) => void;

/** What a part of the UI needs of a store: read the value, and change it. */
export interface StateSource<S> {
    get(): Readonly<S>;
    update(patch: Partial<S>): void;
}

export class ViewStore<S extends object> implements StateSource<S> {
    private state: Readonly<S>;
    private readonly listeners: StoreListener<S>[] = [];

    constructor(initial: S) {
        this.state = { ...initial };
    }

    get(): Readonly<S> {
        return this.state;
    }

    update(patch: Partial<S>): void {
        const prev = this.state;
        this.state = { ...prev, ...patch };
        for (const listener of [...this.listeners]) listener(patch, prev);
    }

    /** @returns the unsubscriber */
    subscribe(listener: StoreListener<S>): () => void {
        this.listeners.push(listener);
        return () => {
            const i = this.listeners.indexOf(listener);
            if (i >= 0) this.listeners.splice(i, 1);
        };
    }
}
