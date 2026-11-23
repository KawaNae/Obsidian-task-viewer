/**
 * The answer to the last of a form's askings, asked again whenever its
 * fields change: an answer that comes after a later asking is not taken,
 * so what the form holds is never read off fields it no longer holds.
 */
export class LastAnswer<A> {
    private asked = 0;
    private taken: { seq: number; value: A } | null = null;

    /** The answer last taken; null before any. It may be to an asking a later one has not caught up with ({@link caughtUp}). */
    get value(): A | null {
        return this.taken?.value ?? null;
    }

    /** Whether the answer taken is to the last asking: what the fields hold now. */
    get caughtUp(): boolean {
        return this.taken !== null && this.taken.seq === this.asked;
    }

    /**
     * Ask, the asking counted at once (so {@link caughtUp} is false until it
     * is answered). Whether its answer was taken: false when a later asking
     * came first. A throw of `asking` is the caller's, nothing taken.
     */
    async ask(asking: () => Promise<A>): Promise<boolean> {
        const seq = ++this.asked;
        const value = await asking();
        if (seq !== this.asked) return false;
        this.taken = { seq, value };
        return true;
    }
}
