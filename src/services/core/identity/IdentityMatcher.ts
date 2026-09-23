import type { Task } from '../../../types';
import type { Fingerprint } from './IdentityFingerprint';
import { fingerprintOf } from './IdentityFingerprint';
import type { Reading } from './IdentityHints';
import { reproduces } from './IdentityHints';
import type { LedgerEntry } from './IdentityLedger';

export interface MatchResult {
    /** Provisional (parse-time) ID → runtime ID. Covers every task passed in. */
    mapping: Map<string, string>;
    /** The file's new ledger rows, in file order (`task.line` ascending). */
    entries: LedgerEntry[];
    /** Runtime IDs this run gave rows that the previous rows did not hold, in file order. */
    minted: string[];
    /** Previous runtime IDs nothing matched. They are gone for good. */
    retired: string[];
    /**
     * Previous rows whose fate position decided, each with how many rows it
     * was one of: every previous row of a bucket that held more than one row
     * on either side, where nearest ordinal is what decided. The row position
     * left unpaired is in here too — that it was the one to go is as much a
     * guess as which line the other one got. So is a row paired later — by
     * a weaker rung, or in the second pass — with a line position left over in
     * such a bucket: that the line was left over is where the guess went.
     * And so is every row paired inside the children of a row position
     * decided: which parent's scope a child was looked for in is the guess
     * again, however unique the child is there.
     *
     * A scan does not read this to decide identity — for identity, a guess by
     * position is the documented best it can do. A write does (see
     * `TaskScanner.locate`): writing on a line chosen by position is writing
     * on a guess, and a write would rather not write at all. The ledger keeps
     * what a committing scan guessed (`IdentityLedger.guessedFor`) for the
     * consumers that must know which rows were guessed after the fact.
     */
    guessed: Map<string, number>;
    /**
     * Names the readings of the lines disagreed about: some reading gave the
     * name to a row, another gave that row another name or put the name
     * elsewhere, so no row carries it now. A write that asks for one is
     * asking for a row that cannot be told (`ambiguous`).
     */
    disputed: Set<string>;
}

/**
 * Match the previous scan's rows for one file against this scan's tasks and
 * decide which tasks keep their runtime ID.
 *
 * `reading` says every way the lines may be told (see `WriteClaims.reading`):
 * as one of the known states whose content they are — the ledger's, a write's
 * of ours — and, when a change nobody reported may have come after the newest
 * of them, as that change, which the ladder pairs against `reading.partner`.
 *
 * A known state that reproduces the read decides every row outright: line i
 * is whatever the state says line i is, and a row it no longer holds is one
 * that went. The ladder is the fallback, for lines no known state has, and it
 * answers by evidence, strongest first:
 *
 * Two passes. The first walks the tree from the roots down, running the ladder
 * inside one scope (the children of one matched parent) at a time, so a group of
 * identically-worded siblings can only collide with its own group — the recurrence
 * writer inserts each new instance at the *head* of its sibling group, and a flat
 * file-wide match would slide every card down by one. The second pass runs the same
 * ladder once over whatever is left, which is how a task whose parent changed (or
 * whose parent's text was merely edited) is rescued instead of being renumbered.
 *
 * With one reading open, its answer is the answer. With more than one — two
 * known states with the same content, or a known state and a change after
 * the newest one — which of them the read is cannot be told from the lines,
 * and a row keeps a name only where every reading that names the row gives it
 * that name, and none puts that name on another row. Everywhere else the row
 * is new. A reading that leaves a row unnamed (the ladder found no evidence)
 * has nothing to say about it and does not stand in the way; one that names
 * the row otherwise does. This is the rule a claim was always held to — a
 * decision is taken only when no candidate decides differently — kept row by
 * row: rows the readings agree on are right whichever reading is true.
 *
 * `reading` is not optional. A caller that could leave it out would be one
 * that forgot the writes it knows of, and the ladder would pair against a
 * state older than the file without anyone noticing.
 *
 * Pure and deterministic: no clock, no randomness, no I/O. Minting is the caller's,
 * through `mintRuntimeId`.
 */
export function matchFile(
    previous: LedgerEntry[],
    tasks: Task[],
    mintRuntimeId: (task: Task) => string,
    reading: Reading,
): MatchResult {
    const fingerprints = new Map<Task, Fingerprint>();
    for (const task of tasks) {
        fingerprints.set(task, fingerprintOf(task));
    }

    // File order is the only order the matcher trusts on the current side;
    // `ordinal` and the zip in the ladder both read it.
    const ordered = [...tasks].sort((a, b) => a.line - b.line);
    const tree = buildCurrentTree(tasks, ordered);

    const byRuntimeId = new Map(previous.map(entry => [entry.runtimeId, entry]));
    const views: View[] = [];
    for (const state of reading.states) {
        if (!reproduces(state, ordered, byRuntimeId)) continue;
        const names = new Map<Task, string>();
        ordered.forEach((task, i) => names.set(task, state.rows[i].runtimeId));
        views.push({ names, guessed: new Map() });
    }
    // A state whose content was read but whose rows were not (a parser that
    // reads the lines otherwise now) tells nothing, and the ladder answers.
    if (reading.after || views.length === 0) {
        views.push(pairByLadder(ordered, tree, fingerprints, reading.partner));
    }

    const runtimeIdOf = new Map<Task, string>();
    const guessed = new Map<string, number>();
    const disputed = new Set<string>();
    if (views.length === 1) {
        const [only] = views;
        for (const [task, name] of only.names) runtimeIdOf.set(task, name);
        for (const [name, among] of only.guessed) guessed.set(name, among);
    } else {
        const placed = views.map(view => {
            const at = new Map<string, Task>();
            for (const [task, name] of view.names) at.set(name, task);
            return at;
        });
        for (const task of ordered) {
            const said = views.map(view => view.names.get(task)).filter((name): name is string => name !== undefined);
            const name = said[0];
            const agreed = name !== undefined
                && said.every(other => other === name)
                && placed.every(at => { const there = at.get(name); return there === undefined || there === task; });
            for (const other of said) if (!agreed || other !== name) disputed.add(other);
            if (!agreed) continue;
            runtimeIdOf.set(task, name);
        }
        // What position decided in any reading is a guess, whichever is true.
        for (const view of views) {
            for (const [name, among] of view.guessed) guessed.set(name, Math.max(guessed.get(name) ?? 0, among));
        }
        for (const task of ordered) {
            const name = runtimeIdOf.get(task);
            if (name !== undefined) disputed.delete(name);
        }
    }

    const minted: string[] = [];
    for (const task of ordered) {
        let name = runtimeIdOf.get(task);
        if (name === undefined) {
            name = mintRuntimeId(task);
            runtimeIdOf.set(task, name);
        }
        if (!byRuntimeId.has(name)) minted.push(name);
    }
    const kept = new Set(runtimeIdOf.values());

    const mapping = new Map<string, string>();
    for (const task of ordered) {
        mapping.set(task.id, runtimeIdOf.get(task)!);
    }

    return {
        mapping,
        entries: rowsOfTree(ordered, tree, task => runtimeIdOf.get(task)!, task => fingerprints.get(task)!),
        minted,
        retired: previous.filter(entry => !kept.has(entry.runtimeId)).map(entry => entry.runtimeId),
        guessed,
        disputed,
    };
}

/** One reading of the lines: the name it gives each row it names, and which of those position decided. */
interface View {
    names: Map<Task, string>;
    guessed: Map<string, number>;
}

/**
 * The ladder's reading of the lines against `partner`: the two passes, and
 * nothing else. Rows it finds no evidence for are left unnamed.
 */
function pairByLadder(
    ordered: Task[],
    tree: ReturnType<typeof buildCurrentTree>,
    fingerprints: Map<Task, Fingerprint>,
    partner: readonly LedgerEntry[],
): View {
    const { roots, childrenOf } = tree;
    const pairedWith = new Map<Task, LedgerEntry>();
    const matchedPrev = new Set<string>();
    const guessed = new Map<string, number>();
    // Current lines a position-decided bucket held, across both passes.
    const leftByPosition = new Map<Task, number>();

    const { prevRoots, prevChildren } = buildPreviousTree(partner);

    // --- 1st pass: scope by scope, from the roots down ---
    // `among` is carried down from a parent pair position decided.
    const scopes: Array<{ prev: LedgerEntry[]; cur: Task[]; among?: number }> = [{ prev: prevRoots, cur: roots }];
    const pair = (entry: LedgerEntry, task: Task, among: number | undefined): void => {
        if (among !== undefined && !guessed.has(entry.runtimeId)) guessed.set(entry.runtimeId, among);
        pairedWith.set(task, entry);
        matchedPrev.add(entry.runtimeId);
        // Only a matched parent opens its children's scope. An unmatched one
        // takes its whole subtree to the 2nd pass instead of renumbering it.
        scopes.push({
            prev: prevChildren.get(entry.runtimeId) ?? [],
            cur: childrenOf.get(task) ?? [],
            among: guessed.get(entry.runtimeId),
        });
    };

    // Rung 4 is not decided inside a scope. "The one row left on each side"
    // is true of the scope, not of the file: a row cut off from its parent by
    // an outside edit, or given a new one, is left over under a parent of the
    // other side, and pairing it there on a shared date hands it a name its
    // text says is someone else's (the root a card deleted, or a root the new
    // parent takes the place of). So each scope hands its rung-4 pair back,
    // and once no scope is left to run, a pair is made only where neither
    // side has a stronger candidate among the rows the file has not paired
    // yet. Rows another handed-back pair holds are not candidates against
    // it: they have a scope of their own, and counting them would break two
    // scopes whose rows were rewritten into each other's words, each blocking
    // the other. A pair made opens its children's scope and the pass goes on.
    //
    // A pair still blocked when nothing more can be decided is a place where
    // the evidence disagrees: the scope says the two rows are one, the text
    // elsewhere says one of them is another row. Which is right is not in the
    // lines — a row cut off from its parent, and a row typed elsewhere in the
    // words of one a card renamed, read the same. Neither is taken: both rows
    // of the pair stay out of the 2nd pass, the previous one goes and the
    // current one is new, and the row whose text pointed at them is left to
    // what else the 2nd pass finds for it.
    const deferred: Array<{ entry: LedgerEntry; task: Task; among: number | undefined }> = [];
    const run = (): void => {
        while (scopes.length > 0) {
            const scope = scopes.pop()!;
            const { pairs, byPosition, weak } = runLadder(
                scope.prev
                    .filter(entry => !matchedPrev.has(entry.runtimeId))
                    .map(entry => ({ item: entry, fingerprint: entry.fingerprint })),
                scope.cur
                    .filter(task => !pairedWith.has(task))
                    .map(task => ({ item: task, fingerprint: fingerprints.get(task)! })),
                leftByPosition,
                'defer',
            );
            for (const [entry, among] of byPosition) guessed.set(entry.runtimeId, among);
            for (const [entry, task] of pairs) pair(entry, task, scope.among);
            if (weak) deferred.push({ entry: weak[0], task: weak[1], among: scope.among });
        }
    };
    const stronger = strongerCandidates(partner, ordered, fingerprints);
    const below = <T>(root: T, childrenOf: (at: T) => readonly T[]): Set<T> => {
        const found = new Set<T>();
        const walk = (at: T): void => {
            for (const child of childrenOf(at)) {
                if (child === root || found.has(child)) continue;
                found.add(child);
                walk(child);
            }
        };
        walk(root);
        return found;
    };
    run();
    for (let decided = true; decided && deferred.length > 0;) {
        decided = false;
        const held = new Set<LedgerEntry | Task>();
        for (const { entry, task } of deferred) { held.add(entry); held.add(task); }
        const free = (row: LedgerEntry | Task): boolean => !held.has(row)
            && ('runtimeId' in row ? !matchedPrev.has(row.runtimeId) : !pairedWith.has(row));
        for (let i = 0; i < deferred.length; i++) {
            const { entry, task, among } = deferred[i];
            if (matchedPrev.has(entry.runtimeId) || pairedWith.has(task)) {
                deferred.splice(i--, 1);
                continue;
            }
            // A row below the pair is not evidence against it when its stronger
            // key points below the other side of the same pair: a root rewritten
            // into its child's words would otherwise be blocked by that child,
            // whose own scope — unopened while the pair is held — pairs it with
            // its twin below. Both subtrees move with the pair, so that evidence
            // agrees with it. A row below one side whose key points anywhere
            // else still blocks (the child a card's delete cut off, the root a
            // new parent took in).
            const underEntry = below<LedgerEntry>(entry, at => prevChildren.get(at.runtimeId) ?? []);
            const underTask = below<Task>(task, at => childrenOf.get(at) ?? []);
            const against = (row: LedgerEntry | Task): boolean => {
                if (!free(row)) return false;
                return 'runtimeId' in row
                    ? !(underEntry.has(row) && stronger.forPrevious(row).some(twin => underTask.has(twin)))
                    : !(underTask.has(row) && stronger.forCurrent(row).some(twin => underEntry.has(twin)));
            };
            if (stronger.forPrevious(entry).some(against) || stronger.forCurrent(task).some(against)) continue;
            deferred.splice(i--, 1);
            // A line a bucket left over by position hands that on, as in the ladder.
            const left = leftByPosition.get(task);
            if (left !== undefined) guessed.set(entry.runtimeId, left);
            pair(entry, task, among);
            decided = true;
        }
        run();
    }

    const barred = new Set<LedgerEntry | Task>();
    for (const { entry, task } of deferred) {
        barred.add(entry);
        barred.add(task);
    }

    // --- 2nd pass: the leftovers of the whole file, no scoping ---
    const poolPrev = partner.filter(entry => !matchedPrev.has(entry.runtimeId) && !barred.has(entry));
    const poolCur = ordered.filter(task => !pairedWith.has(task) && !barred.has(task));
    const rescued = runLadder(
        poolPrev.map(entry => ({ item: entry, fingerprint: entry.fingerprint })),
        poolCur.map(task => ({ item: task, fingerprint: fingerprints.get(task)! })),
        leftByPosition,
    );
    for (const [entry, task] of rescued.pairs) {
        pairedWith.set(task, entry);
    }
    for (const [entry, among] of rescued.byPosition) guessed.set(entry.runtimeId, among);

    const names = new Map<Task, string>();
    for (const [task, entry] of pairedWith) names.set(task, entry.runtimeId);
    return { names, guessed };
}


/**
 * A file's rows as the ladder reads its previous side: each task under the
 * name it is given, with its parent, its ordinal and its fingerprint, in file
 * order.
 *
 * The one definition of that shape. A scan builds the ledger with it, and a
 * write builds the record of what it left with it (`WriteClaims`), so the two
 * cannot read the same lines into different previous sides — a ladder paired
 * against a write's record has to see exactly what it would have seen had a
 * scan read those lines.
 */
export function ledgerRowsOf(tasks: Task[], runtimeIdOf: (task: Task) => string): LedgerEntry[] {
    const ordered = [...tasks].sort((a, b) => a.line - b.line);
    return rowsOfTree(ordered, buildCurrentTree(tasks, ordered), runtimeIdOf, fingerprintOf);
}

function rowsOfTree(
    ordered: Task[],
    tree: ReturnType<typeof buildCurrentTree>,
    runtimeIdOf: (task: Task) => string,
    fingerprintOfTask: (task: Task) => Fingerprint,
): LedgerEntry[] {
    const ordinals = buildOrdinals(tree.roots, tree.childrenOf);
    return ordered.map(task => {
        const parent = tree.parentOf.get(task);
        return {
            runtimeId: runtimeIdOf(task),
            file: task.file,
            parent: parent ? runtimeIdOf(parent) : null,
            ordinal: ordinals.get(task) ?? 0,
            line: task.line,
            fingerprint: fingerprintOfTask(task),
        };
    });
}


interface Rung<T> {
    item: T;
    fingerprint: Fingerprint;
}

interface LadderResult<P, C> {
    pairs: Array<[P, C]>;
    /** Previous rows of the buckets position decided, with the size of their bucket. */
    byPosition: Array<[P, number]>;
    prevLeft: P[];
    curLeft: C[];
    /**
     * The pair rung 4 would make, when the caller asked for it to be handed
     * back rather than made (`weak: 'defer'`). Not in `pairs`, and both of
     * its items are in the leftovers.
     */
    weak: [P, C] | null;
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
 * Rungs 2 and 3 bucket by key and pair the two sides by nearest ordinal
 * (`pairByOrdinal`), so an n-against-m bucket resolves to min(n, m) pairs
 * instead of guessing.
 *
 * Rung 4 is the weakest evidence the ladder takes, and "one against one" is
 * only true of the rows handed in. Inside one scope that says nothing of the
 * rest of the file, so a caller running scope by scope asks for the pair to be
 * handed back (`weak: 'defer'`) and decides it with the file in view (see
 * `pairByLadder`).
 */
function runLadder<P, C>(
    prev: Array<Rung<P>>,
    cur: Array<Rung<C>>,
    /**
     * Current items a position-decided bucket held, with its size. Filled here
     * and read here, and shared across calls, so a line left over by position
     * in one pass carries that into whatever pairs it later.
     */
    byPositionCur: Map<C, number>,
    weak: 'decide' | 'defer' = 'decide',
): LadderResult<P, C> {
    let handedBack: [P, C] | null = null;
    const pairs: Array<[P, C]> = [];
    const byPosition: Array<[P, number]> = [];
    const takenPrev = new Set<number>();
    const takenCur = new Set<number>();
    // A line an earlier bucket left over by position hands that on to the row
    // it is paired with now.
    const inherit = (p: number, c: number): void => {
        const among = byPositionCur.get(cur[c].item);
        if (among !== undefined) byPosition.push([prev[p].item, among]);
    };

    const zip = (keyOf: (fingerprint: Fingerprint) => string | null, oneToOneOnly: boolean): void => {
        const prevBuckets = bucket(prev, takenPrev, keyOf);
        const curBuckets = bucket(cur, takenCur, keyOf);

        for (const [key, curIndexes] of curBuckets) {
            const prevIndexes = prevBuckets.get(key);
            if (!prevIndexes) continue;
            if (oneToOneOnly && (prevIndexes.length !== 1 || curIndexes.length !== 1)) continue;

            // One against one is decided by the key. Anything larger is
            // decided by nearest ordinal, which is position.
            const among = Math.max(prevIndexes.length, curIndexes.length);
            if (among > 1) {
                for (const p of prevIndexes) byPosition.push([prev[p].item, among]);
            }
            for (const [p, c] of pairByOrdinal(prevIndexes, curIndexes)) {
                takenPrev.add(p);
                takenCur.add(c);
                pairs.push([prev[p].item, cur[c].item]);
                inherit(p, c);
            }
            if (among > 1) {
                for (const c of curIndexes) byPositionCur.set(cur[c].item, among);
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
        if (left.parserId === right.parserId && sharesSomething && weak === 'defer') {
            handedBack = [prev[prevRest[0]].item, cur[curRest[0]].item];
        } else if (left.parserId === right.parserId && sharesSomething) {
            takenPrev.add(prevRest[0]);
            takenCur.add(curRest[0]);
            pairs.push([prev[prevRest[0]].item, cur[curRest[0]].item]);
            inherit(prevRest[0], curRest[0]);
        }
    }

    return {
        pairs,
        byPosition,
        prevLeft: remaining(prev, takenPrev).map(index => prev[index].item),
        curLeft: remaining(cur, takenCur).map(index => cur[index].item),
        weak: handedBack,
    };
}

/**
 * For each row of either side, the rows of the other side that share a key a
 * rung stronger than 4 would pair on — `^id`, the text, the content and the
 * dates — under the same parser.
 */
function strongerCandidates(
    partner: readonly LedgerEntry[],
    ordered: readonly Task[],
    fingerprints: Map<Task, Fingerprint>,
): { forPrevious: (entry: LedgerEntry) => Task[]; forCurrent: (task: Task) => LedgerEntry[] } {
    const keysOf = (fingerprint: Fingerprint): string[] =>
        [blockIdKey(fingerprint), originalTextKey(fingerprint), contentDateKey(fingerprint)]
            .filter((key): key is string => key !== null);
    const add = <T>(into: Map<string, T[]>, key: string, item: T): void => {
        const list = into.get(key);
        if (list) list.push(item);
        else into.set(key, [item]);
    };
    const tasksBy = new Map<string, Task[]>();
    for (const task of ordered) {
        for (const key of keysOf(fingerprints.get(task)!)) add(tasksBy, key, task);
    }
    const entriesBy = new Map<string, LedgerEntry[]>();
    for (const entry of partner) {
        for (const key of keysOf(entry.fingerprint)) add(entriesBy, key, entry);
    }
    return {
        forPrevious: entry => keysOf(entry.fingerprint).flatMap(key => tasksBy.get(key) ?? []),
        forCurrent: task => keysOf(fingerprints.get(task)!).flatMap(key => entriesBy.get(key) ?? []),
    };
}

/** Past this many candidate pairs a bucket is zipped instead of searched. */
const NEAREST_PAIR_LIMIT = 1_000_000;

/**
 * Pair a bucket's two sides by nearest ordinal. Indexes are positions in the
 * lists handed to the ladder — the ordinal within the scope on the 1st pass, file
 * order within the leftover pool on the 2nd — and each side comes in ascending.
 *
 * Equal sizes zip in order, which on a contiguous run is the nearest pairing
 * anyway. Unequal sizes are where a zip goes wrong: checking the third of four
 * identical lines leaves "[ ]" three against four, and a zip slides the fourth
 * line onto the third's ID. There, pairs are taken greedily by the smallest
 * ordinal gap, ties to the smaller previous then current ordinal, so the answer
 * is deterministic.
 */
function pairByOrdinal(prevIndexes: number[], curIndexes: number[]): Array<[number, number]> {
    const count = Math.min(prevIndexes.length, curIndexes.length);
    if (prevIndexes.length === curIndexes.length
        || prevIndexes.length * curIndexes.length > NEAREST_PAIR_LIMIT) {
        return prevIndexes.slice(0, count).map((p, i): [number, number] => [p, curIndexes[i]]);
    }

    const candidates: Array<[number, number]> = [];
    for (const p of prevIndexes) {
        for (const c of curIndexes) candidates.push([p, c]);
    }
    candidates.sort((a, b) => Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]) || a[0] - b[0] || a[1] - b[1]);

    const usedPrev = new Set<number>();
    const usedCur = new Set<number>();
    const result: Array<[number, number]> = [];
    for (const [p, c] of candidates) {
        if (usedPrev.has(p) || usedCur.has(c)) continue;
        usedPrev.add(p);
        usedCur.add(c);
        result.push([p, c]);
        if (result.length === count) break;
    }
    return result;
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

function buildPreviousTree(previous: readonly LedgerEntry[]) {
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

export interface GuardedMatch {
    result: MatchResult;
    /** Whether the known states were thrown out and the file matched again without them. */
    withoutClaims: boolean;
}

/**
 * Match, and if the answer would give one runtime ID to two rows, match again
 * with no known state at all.
 *
 * A duplicate is the one answer that does lasting damage. The store is keyed by
 * ID, so the second row overwrites the first and the file comes out a task
 * short of its lines; the ledger keeps both positions and one entry, and since
 * that ledger is what the next scan compares against, the state is stable and
 * wrong. The task whose ID went missing then refuses every write as "not
 * found" while its line sits there in plain sight. Nothing recovers it.
 *
 * So the answer is checked before it is used, and the fallback is the ladder on
 * its own: it takes each previous row at most once, which is the property that
 * makes a duplicate impossible. What that costs is the precision of one scan.
 *
 * Only a known state can bring this about (a record whose rows repeat a name
 * is refused by `reproduces`, and readings that disagree keep no name twice),
 * which is why matching again without them is the whole remedy — and why the second run is not checked again here. A
 * dev-build assertion at the store's threshold covers the case where the ladder
 * itself learns to repeat an ID.
 */
export function matchWithoutRepeatedIds(
    run: (reading: Reading) => MatchResult,
    reading: Reading,
): GuardedMatch {
    const result = run(reading);
    if (reading.states.length === 0 || !repeatsAnId(result.entries)) {
        return { result, withoutClaims: false };
    }
    return { result: run({ states: [], after: true, partner: reading.partner }), withoutClaims: true };
}

function repeatsAnId(entries: readonly LedgerEntry[]): boolean {
    const seen = new Set<string>();
    for (const entry of entries) {
        if (seen.has(entry.runtimeId)) return true;
        seen.add(entry.runtimeId);
    }
    return false;
}
