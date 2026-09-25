import type { DisplayTask } from '../../types';
import { getOriginalTaskId } from '../../services/display/DisplayTaskConverter';

/**
 * What a card acts on: the task it was last drawn from.
 *
 * A name lasts one reading of its file, and a card outlives a reading: it is
 * kept while what it shows stays the same (`computeContentSignature` leaves
 * the name out, and `CardReconciler` finds a card by what it shows). So
 * nothing a card binds holds a name itself. A handler reads the hold when it
 * acts, and every draw of the card puts the task it draws in the hold
 * (`TaskCardRenderer.render`).
 *
 * After a draw the hold names the task the card shows. Between a change and
 * the draw that shows it, the hold names the task as it was: a write by that
 * name is refused when the file changed under it, and followed to the row's
 * name now when the change was a write of ours (`getTask`).
 */
export class CardHold {
    constructor(
        /** The task the card was last drawn from (a segment of a split task, as drawn). */
        public task: DisplayTask,
        /** The card's key in its view; an expanded card is kept by it. */
        public cardInstanceId: string,
        /**
         * The names of the tasks behind the card's child items, in the order
         * the items are drawn; null for an item that is not a task.
         */
        public children: readonly (string | null)[],
    ) {}

    /** The name of the task the card acts on (the original of a segment). */
    get name(): string {
        return getOriginalTaskId(this.task);
    }

    /** The name behind the child item at `index`, if that item is a task. */
    childAt(index: number): string | undefined {
        return this.children[index] ?? undefined;
    }
}

const holds = new WeakMap<HTMLElement, CardHold>();

/**
 * Put `task` in the hold of `card`, making one on the card's first draw. The
 * hold stays the same object for the card's life, so what reads it reads the
 * task of the latest draw.
 */
export function holdCard(
    card: HTMLElement,
    task: DisplayTask,
    cardInstanceId: string,
    children: readonly (string | null)[],
): CardHold {
    const held = holds.get(card);
    if (!held) {
        const made = new CardHold(task, cardInstanceId, children);
        holds.set(card, made);
        return made;
    }
    held.task = task;
    held.cardInstanceId = cardInstanceId;
    held.children = children;
    return held;
}

/** The hold of `card`, or undefined for an element no draw has passed. */
export function heldBy(card: HTMLElement): CardHold | undefined {
    return holds.get(card);
}
