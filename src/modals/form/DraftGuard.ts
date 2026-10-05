/**
 * What a step the user asked for would lose (I#1, 論点G): a draft of a
 * subtree's text that writes something (the send dialog, the hub's source
 * mode: `SubtreeFrame.check` is not `same`), or the values of the hub's form
 * that cannot be saved, by the names of their fields.
 */
export type Loss =
    | { kind: 'draft' }
    | { kind: 'unsaved'; fields: readonly string[] };

export interface DraftGuardHost<After extends string> {
    /** What going on now would lose; null when nothing. */
    loss(): Loss | null;
    /** The question was put, withdrawn or answered: draw it as `asking` says. */
    render(): void;
    /**
     * The question was put, first or again (a close refused while it stands):
     * the focus goes to its answer that keeps. Moved from the field or the
     * editor, it takes a phone's keyboard down with it, and a stray Enter
     * keeps what would be lost.
     */
    asked(): void;
    /** Thrown away, as asked: go on to `after`, asking nothing more. */
    goOn(after: After): void;
}

/**
 * The one place a form asks whether to throw away what a step would lose,
 * and holds the question until it is answered. Nothing the user has not
 * thrown away is lost to a step they asked for (a close, back to the card):
 * the guard asks first, and goes on to the step if the user says so.
 *
 * Asked again while it asks (a close after a switch asked, or a close again),
 * the question is put again, and throwing away now goes on to the step asked
 * last. Every step refused puts the question, so each takes the focus to its
 * answer as the first did. What the user does to what would be lost (an
 * edit, a write) withdraws the question, as keeping it does.
 */
export class DraftGuard<After extends string> {
    private after: After | null = null;
    private lost: Loss | null = null;

    constructor(private readonly host: DraftGuardHost<After>) { }

    /** What the question is about while it is put; null while none is. */
    get asking(): Loss | null {
        return this.after === null ? null : this.lost;
    }

    /**
     * Whether the step `after` may go on now: yes when nothing would be lost
     * and nothing is asked; else the question is put, first or again, and no.
     */
    request(after: After): boolean {
        const loss = this.host.loss();
        if (this.after === null && loss === null) return true;
        const before = this.asking;
        this.lost = loss ?? this.lost ?? { kind: 'draft' };
        this.after = after;
        // Put again as it stands, the question is not drawn again.
        if (!sameLoss(before, this.lost)) this.host.render();
        this.host.asked();
        return false;
    }

    /** Keep what would be lost: the question is withdrawn. Whether one was put. */
    keep(): boolean {
        return this.withdraw();
    }

    /** Throw it away, as asked, and go on to the step asked last. */
    discard(): void {
        const after = this.after;
        if (after === null) return;
        this.after = null;
        this.lost = null;
        this.host.goOn(after);
    }

    /** The user acted on what would be lost (an edit, a write): the question is withdrawn. Whether one was put. */
    withdraw(): boolean {
        if (this.after === null) return false;
        this.after = null;
        this.lost = null;
        this.host.render();
        return true;
    }
}

function sameLoss(a: Loss | null, b: Loss | null): boolean {
    return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
}
