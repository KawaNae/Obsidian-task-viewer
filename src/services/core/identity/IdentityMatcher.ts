import type { Task } from '../../../types';
import type { Fingerprint } from './IdentityFingerprint';
import { fingerprintOf } from './IdentityFingerprint';
import type { LedgerEntry } from './IdentityLedger';

export interface MatchResult {
    /** Provisional (parse-time) ID → runtime ID. Covers every task passed in. */
    mapping: Map<string, string>;
    /** The file's new ledger rows, in file order (`task.line` ascending). */
    entries: LedgerEntry[];
    /** Runtime IDs handed out in this run, in file order. */
    minted: string[];
    /** Previous runtime IDs nothing matched. They are gone for good. */
    retired: string[];
}

/**
 * Match the previous scan's rows for one file against this scan's tasks and
 * decide which tasks keep their runtime ID.
 *
 * Two passes. The first walks the tree from the roots down, running the ladder
 * inside one scope (the children of one matched parent) at a time, so a group of
 * identically-worded siblings can only collide with its own group — the recurrence
 * writer inserts each new instance at the *head* of its sibling group, and a flat
 * file-wide match would slide every card down by one. The second pass runs the same
 * ladder once over whatever is left, which is how a task whose parent changed (or
 * whose parent's text was merely edited) is rescued instead of being renumbered.
 *
 * Pure and deterministic: no clock, no randomness, no I/O. Minting is the caller's,
 * through `mintRuntimeId`.
 */
export function matchFile(
    previous: LedgerEntry[],
    tasks: Task[],
    mintRuntimeId: (task: Task) => string
): MatchResult {
    const fingerprints = new Map<Task, Fingerprint>();
    for (const task of tasks) {
        fingerprints.set(task, fingerprintOf(task));
    }

    // File order is the only order the matcher trusts on the current side;
    // `ordinal` and the zip in the ladder both read it.
    const ordered = [...tasks].sort((a, b) => a.line - b.line);

    const { parentOf, roots, childrenOf } = buildCurrentTree(tasks, ordered);
    const { prevRoots, prevChildren } = buildPreviousTree(previous);

    const pairedWith = new Map<Task, LedgerEntry>();
    const matchedPrev = new Set<string>();

    // --- 1st pass: scope by scope, from the roots down ---
    const scopes: Array<{ prev: LedgerEntry[]; cur: Task[] }> = [{ prev: prevRoots, cur: roots }];
    while (scopes.length > 0) {
        const scope = scopes.pop()!;
        const { pairs } = runLadder(
            scope.prev.map(entry => ({ item: entry, fingerprint: entry.fingerprint })),
            scope.cur.map(task => ({ item: task, fingerprint: fingerprints.get(task)! }))
        );
        for (const [entry, task] of pairs) {
            pairedWith.set(task, entry);
            matchedPrev.add(entry.runtimeId);
            // Only a matched parent opens its children's scope. An unmatched one
            // takes its whole subtree to the 2nd pass instead of renumbering it.
            scopes.push({
                prev: prevChildren.get(entry.runtimeId) ?? [],
                cur: childrenOf.get(task) ?? [],
            });
        }
    }

    // --- 2nd pass: the leftovers of the whole file, no scoping ---
    const poolPrev = previous.filter(entry => !matchedPrev.has(entry.runtimeId));
    const poolCur = ordered.filter(task => !pairedWith.has(task));
    const rescued = runLadder(
        poolPrev.map(entry => ({ item: entry, fingerprint: entry.fingerprint })),
        poolCur.map(task => ({ item: task, fingerprint: fingerprints.get(task)! }))
    );
    for (const [entry, task] of rescued.pairs) {
        pairedWith.set(task, entry);
    }

    const minted: string[] = [];
    const runtimeIdOf = new Map<Task, string>();
    for (const task of ordered) {
        const entry = pairedWith.get(task);
        if (entry) {
            runtimeIdOf.set(task, entry.runtimeId);
            continue;
        }
        const fresh = mintRuntimeId(task);
        runtimeIdOf.set(task, fresh);
        minted.push(fresh);
    }

    const mapping = new Map<string, string>();
    for (const task of ordered) {
        // A task whose provisional ID is already runtime-shaped (tv-file's
        // `fm-root`) is no special case — it maps to itself and stays in the map,
        // so the applier has one rule and not two.
        mapping.set(task.id, runtimeIdOf.get(task)!);
    }

    const ordinals = buildOrdinals(roots, childrenOf);
    const entries: LedgerEntry[] = ordered.map(task => {
        const parent = parentOf.get(task);
        return {
            runtimeId: runtimeIdOf.get(task)!,
            file: task.file,
            parent: parent ? runtimeIdOf.get(parent)! : null,
            ordinal: ordinals.get(task) ?? 0,
            fingerprint: fingerprints.get(task)!,
        };
    });

    return {
        mapping,
        entries,
        minted,
        retired: rescued.prevLeft.map(entry => entry.runtimeId),
    };
}

interface Rung<T> {
    item: T;
    fingerprint: Fingerprint;
}

interface LadderResult<P, C> {
    pairs: Array<[P, C]>;
    prevLeft: P[];
    curLeft: C[];
}

/**
 * The ladder: strongest evidence first, and never across parsers.
 *
 * 1. `blockId`, and only when it names exactly one row on each side — a `^id`
 *    the user duplicated proves nothing.
 * 2. `originalText` verbatim.
 * 3. content + date tokens, which survives a reformat that left the text alone.
 * 4. one-against-one leftovers that still share either the text or the dates.
 *    Editing the text *or* the dates keeps the ID; editing both is a new task —
 *    the documented price of "when in doubt, mint".
 *
 * Rungs 2 and 3 bucket by key and zip the two sides by ordinal, so an n-against-m
 * bucket resolves to min(n, m) pairs instead of guessing.
 */
function runLadder<P, C>(prev: Array<Rung<P>>, cur: Array<Rung<C>>): LadderResult<P, C> {
    const pairs: Array<[P, C]> = [];
    const takenPrev = new Set<number>();
    const takenCur = new Set<number>();

    const zip = (keyOf: (fingerprint: Fingerprint) => string | null, oneToOneOnly: boolean): void => {
        const prevBuckets = bucket(prev, takenPrev, keyOf);
        const curBuckets = bucket(cur, takenCur, keyOf);

        for (const [key, curIndexes] of curBuckets) {
            const prevIndexes = prevBuckets.get(key);
            if (!prevIndexes) continue;
            if (oneToOneOnly && (prevIndexes.length !== 1 || curIndexes.length !== 1)) continue;

            // Both index lists are built in list order, so index order *is*
            // ordinal order and the zip needs no sort.
            const count = Math.min(prevIndexes.length, curIndexes.length);
            for (let i = 0; i < count; i++) {
                takenPrev.add(prevIndexes[i]);
                takenCur.add(curIndexes[i]);
                pairs.push([prev[prevIndexes[i]].item, cur[curIndexes[i]].item]);
            }
        }
    };

    zip(blockIdKey, true);
    zip(originalTextKey, false);
    zip(contentDateKey, false);

    const prevRest = remaining(prev, takenPrev);
    const curRest = remaining(cur, takenCur);
    if (prevRest.length === 1 && curRest.length === 1) {
        const left = prev[prevRest[0]].fingerprint;
        const right = cur[curRest[0]].fingerprint;
        const sharesSomething = left.contentKey === right.contentKey || left.dateKey === right.dateKey;
        if (left.parserId === right.parserId && sharesSomething) {
            takenPrev.add(prevRest[0]);
            takenCur.add(curRest[0]);
            pairs.push([prev[prevRest[0]].item, cur[curRest[0]].item]);
        }
    }

    return {
        pairs,
        prevLeft: remaining(prev, takenPrev).map(index => prev[index].item),
        curLeft: remaining(cur, takenCur).map(index => cur[index].item),
    };
}

function bucket<T>(
    rungs: Array<Rung<T>>,
    taken: Set<number>,
    keyOf: (fingerprint: Fingerprint) => string | null
): Map<string, number[]> {
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < rungs.length; i++) {
        if (taken.has(i)) continue;
        const key = keyOf(rungs[i].fingerprint);
        if (key === null) continue;
        const list = buckets.get(key);
        if (list) list.push(i);
        else buckets.set(key, [i]);
    }
    return buckets;
}

function remaining<T>(rungs: Array<Rung<T>>, taken: Set<number>): number[] {
    const result: number[] = [];
    for (let i = 0; i < rungs.length; i++) {
        if (!taken.has(i)) result.push(i);
    }
    return result;
}

// Keys are JSON arrays, so no separator can be forged out of a task's own text.
// `parserId` leads every one of them: turning a third-party notation on or off
// renumbers its tasks — the same deal as any settings change — but a Tasks-plugin
// line must never inherit a tv-inline line's ID.
function blockIdKey(fingerprint: Fingerprint): string | null {
    return fingerprint.blockId ? JSON.stringify([fingerprint.parserId, fingerprint.blockId]) : null;
}

function originalTextKey(fingerprint: Fingerprint): string {
    return JSON.stringify([fingerprint.parserId, fingerprint.originalText]);
}

function contentDateKey(fingerprint: Fingerprint): string {
    return JSON.stringify([fingerprint.parserId, fingerprint.contentKey, fingerprint.dateKey]);
}

function buildCurrentTree(tasks: Task[], ordered: Task[]) {
    const byId = new Map<string, Task>();
    for (const task of tasks) {
        if (!byId.has(task.id)) byId.set(task.id, task);
    }

    // `parentId` is the edge the extractor writes; `childIds` only fills gaps, so
    // a half-wired pair still lands in the right scope instead of at the root.
    const parentOf = new Map<Task, Task>();
    for (const task of tasks) {
        const parent = task.parentId ? byId.get(task.parentId) : undefined;
        if (parent && parent !== task) parentOf.set(task, parent);
    }
    for (const task of tasks) {
        for (const childId of task.childIds) {
            const child = byId.get(childId);
            if (child && child !== task && !parentOf.has(child)) parentOf.set(child, task);
        }
    }

    const roots: Task[] = [];
    const childrenOf = new Map<Task, Task[]>();
    for (const task of ordered) {
        const parent = parentOf.get(task);
        if (!parent) {
            roots.push(task);
            continue;
        }
        const siblings = childrenOf.get(parent);
        if (siblings) siblings.push(task);
        else childrenOf.set(parent, [task]);
    }

    return { parentOf, roots, childrenOf };
}

function buildPreviousTree(previous: LedgerEntry[]) {
    const known = new Set(previous.map(entry => entry.runtimeId));

    const prevRoots: LedgerEntry[] = [];
    const prevChildren = new Map<string, LedgerEntry[]>();
    for (const entry of previous) {
        const parent = entry.parent;
        if (parent === null || parent === entry.runtimeId || !known.has(parent)) {
            prevRoots.push(entry);
            continue;
        }
        const siblings = prevChildren.get(parent);
        if (siblings) siblings.push(entry);
        else prevChildren.set(parent, [entry]);
    }

    return { prevRoots, prevChildren };
}

function buildOrdinals(roots: Task[], childrenOf: Map<Task, Task[]>): Map<Task, number> {
    const ordinals = new Map<Task, number>();
    roots.forEach((task, index) => ordinals.set(task, index));
    for (const siblings of childrenOf.values()) {
        siblings.forEach((task, index) => ordinals.set(task, index));
    }
    return ordinals;
}
