import { TRANSIENT_DRAG_CLASSES } from '../../interaction/drag/constants';
import type { Task } from '../../types';
import { heldBy } from '../taskcard/CardHold';
import { cardKeyString, segmentPartOf, type CardKey } from '../taskcard/CardKey';

/**
 * Keyed reconciler for `.task-card` elements across a render pass.
 *
 * Pattern (1 instance per render call):
 *   1. `detach(container)` — index every existing card in `container` by its
 *      key (`CardKey`, which its hold carries) and remove it from the DOM
 *      tree. The element itself stays alive (with its TaskCardRenderer
 *      cardComponents WeakMap entry, bound listeners, and inner markdown DOM
 *      intact).
 *   2. The view rebuilds its scaffolding (week rows / day columns / sections)
 *      and, for each intended card, calls `acquire(key)` to get back the
 *      existing element if one survived. Otherwise the view creates a fresh
 *      element. Either way the element is `appendChild`-ed into the new
 *      parent and re-decorated.
 *   3. `forEachStale(fn)` is called at the end so the caller can
 *      `taskRenderer.dispose(card)` any element that no longer corresponds to
 *      an intended card (filter dropped, segment vanished, etc.).
 *
 * Keys are those `TaskCardRenderer.render()` was given. Each view gives a
 * card a place (`CardKey.scope`) that, with the task's name, is unique within
 * its container, which is exactly the granularity reconciliation needs.
 *
 * A key holds the task's name, and a name lasts one reading of its file: once
 * the file is read again, no key of its cards turns up. A card is then found
 * by what it shows instead (`shownKey`): its place, the segment part of its
 * name, and the task's file, status and text. Twins take the survivors in the
 * order they were drawn. A card found this way may have shown another row
 * with the same text; the draw that follows puts the task in its hold
 * (`CardHold`) and draws it anew if it shows anything else.
 */
export class CardReconciler {
    /** Survivors by their key (`cardKeyString`). */
    private survivors = new Map<string, HTMLElement>();
    /** Survivors by what they showed (`shownKey`), in the order they were drawn. */
    private byShown = new Map<string, HTMLElement[]>();

    /**
     * Index existing cards in `container` by their key and detach them from
     * the DOM. Cards no draw has passed (without a hold) are left alone — they
     * belong to scaffolding paths the reconciler does not own.
     */
    detach(container: HTMLElement): void {
        container.querySelectorAll<HTMLElement>('.task-card[data-card-scope]').forEach(card => {
            const held = heldBy(card);
            if (!held) return;
            this.survivors.set(cardKeyString(held.key), card);
            const shown = shownKey(held.key, held.task);
            const same = this.byShown.get(shown);
            if (same) same.push(card); else this.byShown.set(shown, [card]);
            card.remove();
        });
    }

    /**
     * Return (and consume) the surviving card for `key`, or, when none has
     * it, one that showed what `task` shows in the same place
     * (`shownKey`); undefined if the caller has to build a new one. Consuming
     * guarantees the same card cannot be acquired twice in a single reconcile
     * pass.
     *
     * @param task the task the card is for, whose name `key` holds
     */
    acquire(key: CardKey, task: Task): HTMLElement | undefined {
        const el = this.survivors.get(cardKeyString(key)) ?? this.takeShown(key, task);
        if (el) {
            this.survivors.delete(cardKeyString(heldBy(el)!.key));
            // Render never owns transient drag state — the active gesture
            // re-applies it on the next onDown/onMove. Stripping it from reused
            // cards means a missed gesture-end (e.g. pointercancel) cannot leave
            // a card stuck invisible across re-renders.
            el.classList.remove(...TRANSIENT_DRAG_CLASSES);
        }
        return el;
    }

    /**
     * Walk every card that was detached but never re-acquired. The caller is
     * expected to dispose Component lifecycles and leave the element to GC
     * (the element is already detached from the DOM).
     */
    forEachStale(fn: (card: HTMLElement) => void): void {
        this.survivors.forEach(fn);
        this.survivors.clear();
        this.byShown.clear();
    }

    /** The first survivor not yet taken that showed what `task` shows in the place of `key`. */
    private takeShown(key: CardKey, task: Task): HTMLElement | undefined {
        const same = this.byShown.get(shownKey(key, task));
        while (same && same.length > 0) {
            const card = same.shift()!;
            if (this.survivors.get(cardKeyString(heldBy(card)!.key)) === card) return card;
        }
        return undefined;
    }

    /** Number of cards currently waiting to be acquired or marked stale. */
    get pendingCount(): number {
        return this.survivors.size;
    }
}

/**
 * What a card in the place of `key` shows of `task`, without the task's name:
 * the place, the segment part of the name, and the task's file, status and
 * text. The same for a card and for the card the next reading of its file
 * would give, as long as the row shows the same.
 */
function shownKey(key: CardKey, task: Task): string {
    return JSON.stringify([key.scope, segmentPartOf(key.name), task.file, task.statusChar, task.content]);
}
