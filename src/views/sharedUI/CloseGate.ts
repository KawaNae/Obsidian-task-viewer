/**
 * Whether a close the user asked for may go on: `'close'` closes, `'stay'`
 * keeps the overlay open (the body has said why in its own place), and a
 * promise keeps it open until it answers (a write the close waits for).
 */
export type CloseAnswer = 'close' | 'stay' | Promise<'close' | 'stay'>;

/** What the gate asks of the overlay it stands in. */
export interface CloseGateHost {
    /** Whether the overlay is open and not closing. */
    isOpen(): boolean;
    /** The body's answer (`OverlayOpenOpts.beforeClose`), `'close'` when it has none. */
    ask(): CloseAnswer;
    /** Close now, asking nothing. */
    close(): void;
}

/**
 * The closes the user asks for of one overlay (`OverlayShell.requestClose`,
 * a swipe), answered as the body answers them. An answer given at once
 * closes, or keeps the overlay open, before `request` returns. While an
 * answer is waited for, a further close asked for waits on the same answer
 * and asks nothing again. An answer that comes after the overlay closed
 * otherwise, or opened again, belongs to no one.
 */
export class CloseGate {
    private waiting: Promise<boolean> | null = null;
    /** One per opening: an answer of an earlier one is not acted on. */
    private round = 0;

    constructor(private readonly host: CloseGateHost) { }

    /**
     * Ask, and close: as `closeNow` does on an answer given at once (a swipe
     * slides the panel out), as the host does on one waited for.
     * @returns whether the overlay closed (or was not open)
     */
    request(closeNow: () => void = () => this.host.close()): Promise<boolean> {
        if (!this.host.isOpen()) return Promise.resolve(true);
        if (this.waiting) return this.waiting;
        const answer = this.host.ask();
        if (answer === 'close') {
            closeNow();
            return Promise.resolve(true);
        }
        if (answer === 'stay') return Promise.resolve(false);

        const round = this.round;
        const waiting: Promise<boolean> = answer
            .catch((err: unknown) => {
                console.error('[OverlayShell] beforeClose failed; staying open', err);
                return 'stay' as const;
            })
            .then((settled) => {
                if (this.waiting === waiting) this.waiting = null;
                // Closed meanwhile (the window, the plugin, the body itself), or opened anew.
                if (round !== this.round || !this.host.isOpen()) return true;
                if (settled !== 'close') return false;
                this.host.close();
                return true;
            });
        this.waiting = waiting;
        return waiting;
    }

    /** The overlay opened or closed: what was waited for belongs to no one. */
    reset(): void {
        this.waiting = null;
        this.round++;
    }
}
