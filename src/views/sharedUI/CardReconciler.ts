import { TRANSIENT_DRAG_CLASSES } from '../../interaction/drag/constants';
import type { Task } from '../../types';
import { getOriginalTaskId } from '../../services/display/DisplayTaskConverter';
import { heldBy } from '../taskcard/CardHold';

/**
 * Keyed reconciler for `.task-card` elements across a render pass.
 *
 * Pattern (1 instance per render call):
 *   1. `detach(scope)` — index every existing card in `scope` by its
 *      `data-card-instance-id` and remove it from the DOM tree. The element
 *      itself stays alive (with its TaskCardRenderer cardComponents WeakMap
 *      entry, bound listeners, and inner markdown DOM intact).
 *   2. The view rebuilds its scaffolding (week rows / day columns / sections)
 *      and, for each intended card, calls `acquire(key)` to get back the
 *      existing element if one survived. Otherwise the view creates a fresh
 *      element. Either way the element is `appendChild`-ed into the new
 *      parent and re-decorated.
 *   3. `forEachStale(fn)` is called at the end so the caller can
 *      `taskRenderer.dispose(card)` any element that no longer corresponds to
 *      an intended card (filter dropped, segment vanished, etc.).
 *
 * Keys come from `dataset.cardInstanceId` which `TaskCardRenderer.render()`
 * stamps. Each view already builds these with enough scope (`viewId :: scope
 * :: id-or-segmentId`) to be unique within its container, which is exactly the
 * granularity reconciliation needs.
 *
 * A key holds the task's name, and a name lasts one reading of its file: once
 * the file is read again, no key of its cards turns up. A card is then found
 * by what it shows instead (`shownKey`): the key with the name taken out, and
 * the task's file, status and text put in. Twins take the survivors in the
 * order they were drawn. A card found this way may have shown another row
 * with the same text; the draw that follows puts the task in its hold
 * (`CardHold`) and draws it anew if it shows anything else.
 */
export class CardReconciler {
    private survivors = new Map<string, HTMLElement>();
    /** Survivors by what they showed (`shownKey`), in the order they were drawn. */
    private byShown = new Map<string, HTMLElement[]>();

    /**
     * Index existing cards in `scope` by their cardInstanceId and detach them
     * from the DOM. Cards without a `data-card-instance-id` (i.e. not yet
     * passed through `TaskCardRenderer.render`) are left alone — they belong
     * to scaffolding paths the reconciler does not own.
     */
    detach(scope: HTMLElement): void {
        scope.querySelectorAll<HTMLElement>('.task-card[data-card-instance-id]').forEach(card => {
            const key = card.dataset.cardInstanceId;
            if (!key) return;
            this.survivors.set(key, card);
            const held = heldBy(card);
            const shown = held ? shownKey(key, held.task) : null;
            if (shown !== null) {
                const same = this.byShown.get(shown);
                if (same) same.push(card); else this.byShown.set(shown, [card]);
            }
            card.remove();
        });
    }

    /**
     * Return (and consume) the surviving card for `key`, or, when none has
     * it, one that showed what `task` shows under the same key otherwise
     * (`shownKey`); undefined if the caller has to build a new one. Consuming
     * guarantees the same card cannot be acquired twice in a single reconcile
     * pass.
     *
     * @param task the task the card is for, whose name `key` holds
     */
    acquire(key: string, task: Task): HTMLElement | undefined {
        const el = this.survivors.get(key) ?? this.takeShown(key, task);
        if (el) {
            this.survivors.delete(el.dataset.cardInstanceId!);
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

    /** The first survivor not yet taken that showed what `task` shows under `key`. */
    private takeShown(key: string, task: Task): HTMLElement | undefined {
        const shown = shownKey(key, task);
        const same = shown !== null ? this.byShown.get(shown) : undefined;
        while (same && same.length > 0) {
            const card = same.shift()!;
            if (this.survivors.get(card.dataset.cardInstanceId!) === card) return card;
        }
        return undefined;
    }

    /** Number of cards currently waiting to be acquired or marked stale. */
    get pendingCount(): number {
        return this.survivors.size;
    }
}

/**
 * `key` with the task's name taken out and what the card shows of the task
 * put in: its file, status and text. The same for a card and for the card
 * the next reading of its file would give, as long as the row shows the same.
 * Null when `key` does not hold the name.
 */
function shownKey(key: string, task: Task): string | null {
    const name = getOriginalTaskId(task);
    const at = key.indexOf(name);
    if (at < 0) return null;
    return JSON.stringify([key.slice(0, at), key.slice(at + name.length), task.file, task.statusChar, task.content]);
}
