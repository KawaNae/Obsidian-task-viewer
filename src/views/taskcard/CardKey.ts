import { mapRow, parseSegmentId } from '../../services/display/SegmentIds';

/**
 * Which card this is in its view: the place it is drawn in and the task it
 * draws. A renderer and a reconciler belong to one view, so the view is not
 * part of the key.
 *
 * On the card's element the two are `data-card-scope` and `data-card-name`.
 */
export interface CardKey {
    /**
     * The place in the view: `lane-<date>`, `allday`, `lane-multi`, `lane`,
     * `pl-<listId>`, `cell-<listId>`, `flow`, `section`, `hub`.
     */
    scope: string;
    /**
     * The name of the task drawn; for a segment of a task split at the day
     * boundary, the segment's ID (`SegmentIds`).
     */
    name: string;
}

/** `key` as one string, for a map: no other pair gives the same string. */
export function cardKeyString(key: CardKey): string {
    return JSON.stringify([key.scope, key.name]);
}

/** Write `key` on the card's element. */
export function stampCardKey(card: HTMLElement, key: CardKey): void {
    card.dataset.cardScope = key.scope;
    card.dataset.cardName = key.name;
}

/** The part of a card's name that is not its row's: a segment's date, or ''. */
export function segmentPartOf(name: string): string {
    return parseSegmentId(name)?.segmentDate ?? '';
}

/** The row a card's name is of: the name, or the row a segment is cut from. */
function rowOf(name: string): string {
    return parseSegmentId(name)?.baseId ?? name;
}

/**
 * The cards whose collapsed children the user opened, by place and by the
 * name of the task each draws.
 *
 * A name lasts one reading of its file. A card is still open when the name it
 * was opened under is followed to its name now (`isOpen`), and an opened name
 * is forgotten when its row's name ends (`forgetRow`).
 */
export class ExpandedCards {
    private byScope = new Map<string, Set<string>>();

    /**
     * Whether the card `key` was left open. A name given before a write of
     * ours is followed to the row's name now (`nowOf`, by the row; a segment
     * keeps its date), and the card takes the opening over. Only the names in
     * the card's own place are followed. One from before a change that was
     * not ours names nothing, and the card is drawn closed.
     */
    isOpen(key: CardKey, nowOf: (row: string) => string | undefined): boolean {
        const names = this.byScope.get(key.scope);
        if (!names) return false;
        if (names.has(key.name)) return true;
        for (const held of names) {
            if (mapRow(held, nowOf) !== key.name) continue;
            names.delete(held);
            names.add(key.name);
            return true;
        }
        return false;
    }

    /** Whether the card `key` is open, as it was last set. */
    has(key: CardKey): boolean {
        return this.byScope.get(key.scope)?.has(key.name) ?? false;
    }

    /** Open or close the card `key`. */
    set(key: CardKey, open: boolean): void {
        if (open) {
            const names = this.byScope.get(key.scope);
            if (names) names.add(key.name); else this.byScope.set(key.scope, new Set([key.name]));
            return;
        }
        const names = this.byScope.get(key.scope);
        if (!names) return;
        names.delete(key.name);
        if (names.size === 0) this.byScope.delete(key.scope);
    }

    /**
     * Forget every card of the row `rowId` — its own and its segments', in
     * every place — whose name ended (the index's delete notification).
     */
    forgetRow(rowId: string): void {
        for (const [scope, names] of this.byScope) {
            for (const name of names) {
                if (rowOf(name) === rowId) names.delete(name);
            }
            if (names.size === 0) this.byScope.delete(scope);
        }
    }

    /** Every open card, for tests. */
    keys(): CardKey[] {
        const out: CardKey[] = [];
        for (const [scope, names] of this.byScope) {
            for (const name of names) out.push({ scope, name });
        }
        return out;
    }
}
